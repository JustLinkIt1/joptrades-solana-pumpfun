/* global solanaWeb3 */
const web3 = window.solanaWeb3;
const provider = () => window.phantom?.solana || window.solana;

let owner = null, token = null, botAddress = null;
const $ = (id) => document.getElementById(id);
const short = (s) => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : '—');
const imgCache = new Map();       // uri -> image url ('' if none)
const analyzedTimes = [];         // for analyzed/min

// ---- view toggle -----------------------------------------------------
let walletOpen = false;
$('walletBtn').onclick = () => {
  walletOpen = !walletOpen;
  $('signalsView').hidden = walletOpen;
  $('walletView').hidden = !walletOpen;
  $('walletBtn').textContent = walletOpen ? 'Signals' : 'Wallet';
};

// ---- token image (server resolves from pump.fun metadata) -----------
async function resolveImage(uri) {
  if (!uri) return '';
  if (imgCache.has(uri)) return imgCache.get(uri);
  try {
    const r = await (await fetch('/api/token-meta?uri=' + encodeURIComponent(uri))).json();
    imgCache.set(uri, r.image || '');
    return r.image || '';
  } catch { imgCache.set(uri, ''); return ''; }
}
function imgOrPlaceholder(uri, symbol, size) {
  const wrap = document.createElement('div');
  const ph = document.createElement('div');
  ph.className = 'ph'; ph.textContent = (symbol || '?')[0].toUpperCase();
  wrap.appendChild(ph);
  resolveImage(uri).then((url) => {
    if (!url) return;
    const im = new Image(); im.src = url; im.alt = symbol || '';
    im.onload = () => { ph.replaceWith(im); };
  });
  return wrap.firstChild;
}

// ---- render signals --------------------------------------------------
function addSignal(ev) {
  analyzedTimes.push(Date.now());
  addRecentRow(ev);
  if (ev.action === 'BUY') addBuyCard(ev);
}

function addBuyCard(ev) {
  $('buysEmpty')?.remove();
  const card = document.createElement('div');
  card.className = 'buycard';
  card.onclick = () => openDetail(ev);
  const top = document.createElement('div'); top.className = 'top';
  top.appendChild(imgOrPlaceholder(ev.uri, ev.symbol));
  const meta = document.createElement('div');
  meta.innerHTML = `<div class="sym">$${escapeHtml(ev.symbol || '?')}</div>
    <div class="conf">BUY · ${(ev.confidence * 100).toFixed(0)}% confidence</div>`;
  top.appendChild(meta);
  card.appendChild(top);
  const why = document.createElement('div'); why.className = 'why'; why.textContent = ev.reasoning || '';
  card.appendChild(why);
  const tag = document.createElement('div'); tag.className = 'tag'; tag.textContent = 'BUY';
  card.appendChild(tag);
  const grid = $('buys');
  grid.insertBefore(card, grid.firstChild);
  while (grid.children.length > 12) grid.removeChild(grid.lastChild);
}

function addRecentRow(ev) {
  const row = document.createElement('div');
  row.className = 'frow';
  row.onclick = () => openDetail(ev);
  row.appendChild(imgOrPlaceholder(ev.uri, ev.symbol));
  const isBuy = ev.action === 'BUY';
  const time = new Date(ev.ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sym = document.createElement('div'); sym.className = 'sym'; sym.textContent = '$' + (ev.symbol || '?');
  const v = document.createElement('span'); v.className = 'verdict ' + (isBuy ? 'buy' : 'hold'); v.textContent = ev.action;
  const r = document.createElement('div'); r.className = 'r'; r.textContent = ev.reasoning || '';
  const t = document.createElement('div'); t.className = 't'; t.textContent = time;
  row.append(sym, v, r, t);
  const feed = $('feed');
  feed.insertBefore(row, feed.firstChild);
  while (feed.children.length > 60) feed.removeChild(feed.lastChild);
}

// ---- detail modal ----------------------------------------------------
function openDetail(ev) {
  const isBuy = ev.action === 'BUY';
  $('dSym').textContent = '$' + (ev.symbol || '?');
  $('dName').textContent = ev.name || '';
  const badge = $('dBadge'); badge.textContent = ev.action; badge.className = 'detail-badge ' + (isBuy ? 'buy' : 'hold');
  $('dConf').textContent = (ev.confidence * 100).toFixed(0) + '%';
  $('dRisk').textContent = (ev.risk * 100).toFixed(0) + '%';
  $('dMcap').textContent = ev.marketCapSol != null ? ev.marketCapSol.toFixed(1) + ' SOL' : '—';
  $('dReason').textContent = ev.reasoning || '';
  $('dMint').textContent = ev.mint || '';
  const flags = $('dFlags'); flags.innerHTML = '';
  (ev.redFlags || []).forEach((f) => { const li = document.createElement('li'); li.textContent = f; flags.appendChild(li); });
  const pumpUrl = `https://pump.fun/coin/${ev.mint}`;
  $('dPump').href = pumpUrl;
  $('dCopy').onclick = () => navigator.clipboard?.writeText(ev.mint);
  const dImg = $('dImg'); dImg.src = ''; resolveImage(ev.uri).then((u) => { if (u) dImg.src = u; });
  // DexScreener embeds cleanly (pump.fun frame-busts); indexes pump tokens.
  $('dChart').src = `https://dexscreener.com/solana/${ev.mint}?embed=1&theme=dark&info=0&trades=0`;
  $('detail').hidden = false;
}
$('detailClose').onclick = () => { $('detail').hidden = true; $('dChart').src = 'about:blank'; };
$('detail').onclick = (e) => { if (e.target.id === 'detail') { $('detail').hidden = true; $('dChart').src = 'about:blank'; } };

function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// ---- status ----------------------------------------------------------
async function refreshStatus() {
  try {
    const s = await (await fetch('/api/status')).json();
    botAddress = s.botAddress;
    $('balance').textContent = s.balanceSol == null ? '—' : `${s.balanceSol.toFixed(3)} SOL`;
    $('posCount').textContent = s.positions.length;
    $('depAddr').textContent = s.botAddress || 'run `npm run setup`';
    const cutoff = Date.now() - 60_000;
    while (analyzedTimes.length && analyzedTimes[0] < cutoff) analyzedTimes.shift();
    $('rate').textContent = analyzedTimes.length;
    const badge = $('modeBadge');
    badge.textContent = s.killSwitch ? 'KILL SWITCH' : s.live ? 'LIVE' : 'DRY RUN';
    badge.className = 'badge ' + (s.live ? 'live' : 'dry');
  } catch {}
}

// ---- live stream -----------------------------------------------------
const es = new EventSource('/api/events');
es.onmessage = (m) => {
  try { const ev = JSON.parse(m.data); if (ev.type === 'analysis') addSignal(ev); } catch {}
};

// ---- Phantom connect + login ----------------------------------------
$('connectBtn').onclick = async () => {
  const p = provider();
  if (!p) { alert('Phantom not found. Install the Phantom browser extension.'); return; }
  try {
    const resp = await p.connect();
    owner = resp.publicKey.toString();
    $('connectBtn').textContent = short(owner);
    const { message } = await (await fetch('/api/nonce')).json();
    const nonce = message.split('nonce: ')[1];
    const signed = await p.signMessage(new TextEncoder().encode(message), 'utf8');
    const sigB64 = btoa(String.fromCharCode(...signed.signature));
    const r = await (await fetch('/api/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pubkey: owner, signature: sigB64, nonce }),
    })).json();
    if (r.token) { token = r.token; $('ownerChip').textContent = '✓ ' + short(owner); $('ownerChip').classList.remove('muted'); }
  } catch (e) { $('ownerChip').textContent = 'connect failed'; }
};

// ---- deposit / withdraw ---------------------------------------------
$('depositBtn').onclick = async () => {
  const msg = $('depositMsg'); const p = provider();
  if (!p || !owner) { msg.className = 'msg err'; msg.textContent = 'Connect Phantom first.'; return; }
  const amt = parseFloat($('depositAmt').value);
  if (!(amt > 0)) { msg.className = 'msg err'; msg.textContent = 'Enter an amount.'; return; }
  try {
    msg.className = 'msg'; msg.textContent = 'building transaction…';
    const { blockhash, botAddress: addr } = await (await fetch('/api/blockhash')).json();
    const tx = new web3.Transaction().add(web3.SystemProgram.transfer({
      fromPubkey: new web3.PublicKey(owner), toPubkey: new web3.PublicKey(addr),
      lamports: Math.floor(amt * web3.LAMPORTS_PER_SOL),
    }));
    tx.feePayer = new web3.PublicKey(owner); tx.recentBlockhash = blockhash;
    const { signature } = await p.signAndSendTransaction(tx);
    msg.className = 'msg ok'; msg.innerHTML = `✓ sent — <a href="https://solscan.io/tx/${signature}" target="_blank">view</a>`;
    setTimeout(refreshStatus, 4000);
  } catch (e) { msg.className = 'msg err'; msg.textContent = 'deposit failed: ' + (e.message || e); }
};
$('withdrawBtn').onclick = async () => {
  const msg = $('withdrawMsg');
  if (!token) { msg.className = 'msg err'; msg.textContent = 'Connect + sign in with Phantom first.'; return; }
  const amt = parseFloat($('withdrawAmt').value);
  if (!(amt > 0)) { msg.className = 'msg err'; msg.textContent = 'Enter an amount.'; return; }
  try {
    msg.className = 'msg'; msg.textContent = 'withdrawing…';
    const r = await (await fetch('/api/withdraw', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ amountSol: amt }),
    })).json();
    if (r.ok) { msg.className = 'msg ok'; msg.innerHTML = `✓ sent — <a href="https://solscan.io/tx/${r.signature}" target="_blank">view</a>`; setTimeout(refreshStatus, 4000); }
    else { msg.className = 'msg err'; msg.textContent = 'withdraw failed: ' + (r.error || ''); }
  } catch (e) { msg.className = 'msg err'; msg.textContent = 'withdraw failed: ' + (e.message || e); }
};

refreshStatus();
setInterval(refreshStatus, 6000);
