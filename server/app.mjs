// Web app: serves the UI, runs the bot, streams its events, and handles
// Phantom login + deposit/withdraw. One command:  npm run ui  (or ui:live)
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const require = createRequire(import.meta.url);
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, '..');

const LIVE = process.argv.includes('--live');
if (LIVE) {
  process.env.DRY_RUN = 'false';
  process.env.I_UNDERSTAND_LIVE_TRADING = 'true';
}

// Import config/bot AFTER setting env above.
const { config, liveTradingEnabled } = await import('../src/config.mjs');
const { loadKeypair, getSolBalance, withdrawSol, getLatestBlockhash, connection } = await import('../src/wallet.mjs');
const { store } = await import('../src/positions.mjs');
const { TradingBot } = await import('../src/tradingBot.mjs');

const PORT = Number(process.env.UI_PORT || 3000);
const PROXY_PORT = Number(process.env.CLAUDE_PROXY_PORT || 8787);

// --- bot wallet address (public only; key never leaves the server) ----
let BOT_ADDRESS = null;
try { BOT_ADDRESS = loadKeypair().publicKey.toBase58(); }
catch { /* no wallet yet — run `npm run setup` */ }

// --- in-memory event ring buffer + SSE subscribers --------------------
const events = [];
const sseClients = new Set();
function pushEvent(ev) {
  events.push(ev);
  if (events.length > 500) events.shift();
  const data = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of sseClients) res.write(data);
}

// --- start the Claude proxy as a child --------------------------------
const proxy = spawn(process.execPath, [path.join(root, 'claude-proxy', 'server.mjs')], {
  stdio: 'inherit', env: process.env,
});
proxy.on('exit', (c) => console.error(`[proxy] exited (code ${c}) — are you logged into Claude Code?`));
process.on('SIGINT', () => { proxy.kill(); process.exit(0); });

async function waitForProxy(n = 30) {
  for (let i = 0; i < n; i++) {
    try { if ((await fetch(`http://localhost:${PROXY_PORT}/health`)).ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// --- run the bot, forward its events ----------------------------------
const bot = new TradingBot();
bot.on('event', pushEvent);

// --- Phantom login state ----------------------------------------------
const nonces = new Map();  // nonce -> expiry
const tokens = new Map();  // token -> owner pubkey
const loginMessage = (nonce) => `JopTrades login\nSign to authorize withdrawals.\nnonce: ${nonce}`;

// ---------------------------- HTTP ------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(path.join(root, 'web')));

// Serve the browser build of @solana/web3.js locally (no CDN).
app.get('/vendor/web3.iife.js', (_req, res) => {
  res.sendFile(require.resolve('@solana/web3.js/lib/index.iife.min.js'));
});

app.get('/api/status', async (_req, res) => {
  let balanceSol = null;
  try { if (BOT_ADDRESS) balanceSol = await getSolBalance(loadKeypair().publicKey); } catch {}
  res.json({
    botAddress: BOT_ADDRESS,
    live: liveTradingEnabled(),
    dryRun: config.dryRun,
    killSwitch: config.killSwitch,
    balanceSol,
    spentToday: store.spentToday(),
    positions: store.open(),
    caps: {
      buyAmountSol: config.buyAmountSol,
      maxPositionSol: config.maxPositionSol,
      maxOpenPositions: config.maxOpenPositions,
      maxDailySpendSol: config.maxDailySpendSol,
      minConfidence: config.minConfidence,
      takeProfitPct: config.takeProfitPct,
      stopLossPct: config.stopLossPct,
    },
  });
});

// Resolve a token's image (+ description) from its metadata URI. Cached.
const metaCache = new Map();
app.get('/api/token-meta', async (req, res) => {
  const uri = req.query.uri;
  if (!uri || !/^https?:\/\//.test(uri)) return res.status(400).json({ error: 'bad uri' });
  if (metaCache.has(uri)) return res.json(metaCache.get(uri));
  try {
    const ctrl = AbortSignal.timeout(6000);
    const meta = await (await fetch(uri, { signal: ctrl })).json();
    // pump.fun metadata gateways sometimes return ipfs:// — normalize to a gateway.
    let image = meta.image || '';
    if (image.startsWith('ipfs://')) image = 'https://ipfs.io/ipfs/' + image.slice(7);
    const out = { image, description: meta.description || '', name: meta.name, symbol: meta.symbol };
    metaCache.set(uri, out);
    res.json(out);
  } catch (e) {
    const out = { image: '', description: '', error: String(e.message) };
    metaCache.set(uri, out);
    res.json(out);
  }
});

app.get('/api/blockhash', async (_req, res) => {
  try { res.json({ blockhash: await getLatestBlockhash(), botAddress: BOT_ADDRESS }); }
  catch (e) { res.status(500).json({ error: String(e.message) }); }
});

// live event stream
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders?.();
  for (const ev of events.slice(-100)) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// --- login: nonce -> signed message -> token --------------------------
app.get('/api/nonce', (_req, res) => {
  const nonce = crypto.randomBytes(16).toString('hex');
  nonces.set(nonce, Date.now() + 5 * 60_000);
  res.json({ nonce, message: loginMessage(nonce) });
});

app.post('/api/login', (req, res) => {
  const { pubkey, signature, nonce } = req.body || {};
  const exp = nonces.get(nonce);
  if (!exp || exp < Date.now()) return res.status(400).json({ error: 'bad or expired nonce' });
  nonces.delete(nonce);
  try {
    const ok = nacl.sign.detached.verify(
      new TextEncoder().encode(loginMessage(nonce)),
      Buffer.from(signature, 'base64'), // Phantom signature, base64 from the browser
      bs58.decode(pubkey),
    );
    if (!ok) return res.status(401).json({ error: 'signature check failed' });
  } catch {
    return res.status(400).json({ error: 'malformed signature/pubkey' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, pubkey);
  res.json({ token, owner: pubkey });
});

function owner(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  return tokens.get(t) || null;
}

// --- withdraw: server signs from bot wallet -> logged-in owner --------
app.post('/api/withdraw', async (req, res) => {
  const own = owner(req);
  if (!own) return res.status(401).json({ error: 'log in with Phantom first' });
  const { amountSol } = req.body || {};
  try {
    const sig = await withdrawSol(own, amountSol); // always sends to the logged-in wallet
    pushEvent({ ts: Date.now(), type: 'log', level: 'info', msg: `💸 withdrew ${amountSol} SOL to ${own.slice(0, 6)}…` });
    res.json({ ok: true, signature: sig });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

// ------------------------------ boot ----------------------------------
app.listen(PORT, async () => {
  console.log(`\n🌐 UI:    http://localhost:${PORT}`);
  console.log(`   mode:  ${LIVE ? '🔴 LIVE' : '🧪 DRY RUN'}   wallet: ${BOT_ADDRESS || '(run npm run setup)'}\n`);
  const ok = await waitForProxy();
  if (!ok) {
    console.error('❌ Claude proxy did not start. The UI runs, but analysis will fail until Claude Code is available.');
    return;
  }
  console.log('✅ Claude proxy ready — starting the trader.');
  bot.start().catch((e) => console.error('bot failed:', e.message));
});
