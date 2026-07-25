// Main trading loop.
//   new token launches  → Claude analyzes → maybe BUY a capped position
//   held positions      → watch trades → take-profit / stop-loss → SELL
import { config, liveTradingEnabled, modeBanner, checkBuyAllowed } from './config.mjs';
import { analyzeNewToken } from './analyzer.mjs';
import { executeTrade } from './executor.mjs';
import { PumpPortalFeed } from './pumpportal.mjs';
import { store } from './positions.mjs';
import { loadKeypair, getSolBalance } from './wallet.mjs';

const feed = new PumpPortalFeed();
let analyzing = false; // process one Claude call at a time

async function main() {
  console.log('=== JopTrades — Solana / pump.fun ===');
  console.log(modeBanner());
  console.log(
    `caps: buy ${config.buyAmountSol} SOL | maxPos ${config.maxPositionSol} | ` +
    `openMax ${config.maxOpenPositions} | dailyMax ${config.maxDailySpendSol} | ` +
    `minConf ${config.minConfidence} | TP +${config.takeProfitPct * 100}% | SL -${config.stopLossPct * 100}%`,
  );

  // Wallet is only strictly required for live trading; in dry run we can run without one.
  try {
    const kp = loadKeypair();
    const bal = await getSolBalance(kp.publicKey);
    console.log(`👛 wallet ${kp.publicKey.toBase58()} — ${bal.toFixed(4)} SOL`);
  } catch (e) {
    if (liveTradingEnabled()) throw e;
    console.log(`👛 no wallet loaded (${e.message}) — fine for dry run`);
  }

  // Re-watch any positions we still hold from a previous run.
  for (const p of store.open()) feed.watchMint(p.mint);

  feed.onNewToken(handleNewToken);
  feed.onTokenTrade(handleTokenTrade);
  feed.connect();
}

async function handleNewToken(token) {
  // Cheap pre-filters before spending a Claude call.
  if (analyzing) return;
  if (store.openCount() >= config.maxOpenPositions) return;
  if (store.spentToday() + config.buyAmountSol > config.maxDailySpendSol) return;

  analyzing = true;
  try {
    const decision = await analyzeNewToken(token);
    const tag = `${token.symbol || '?'} (${short(token.mint)})`;
    console.log(
      `🔎 ${tag}: ${decision.action} conf=${decision.confidence.toFixed(2)} ` +
      `risk=${decision.riskScore.toFixed(2)} — ${decision.reasoning}`,
    );

    if (decision.action !== 'BUY' || decision.confidence < config.minConfidence) return;

    const gate = checkBuyAllowed({
      amountSol: config.buyAmountSol,
      spentToday: store.spentToday(),
      openPositions: store.openCount(),
    });
    if (!gate.ok) {
      console.log(`   ⛔ buy blocked: ${gate.reason}`);
      return;
    }

    const result = await executeTrade('buy', token.mint, config.buyAmountSol, true);
    if (!result.ok) return;

    store.recordSpend(config.buyAmountSol);
    store.add(token.mint, {
      symbol: token.symbol,
      entryMcapSol: token.marketCapSol ?? null,
      spentSol: config.buyAmountSol,
      confidence: decision.confidence,
      signature: result.signature || null,
    });
    feed.watchMint(token.mint);
    console.log(`   📈 opened ${tag} for ${config.buyAmountSol} SOL`);
  } catch (e) {
    console.error('handleNewToken error:', e.message);
  } finally {
    analyzing = false;
  }
}

async function handleTokenTrade(ev) {
  const pos = store.get(ev.mint);
  if (!pos || pos.entryMcapSol == null || ev.marketCapSol == null) return;

  const pnl = (ev.marketCapSol - pos.entryMcapSol) / pos.entryMcapSol;

  const hitTP = pnl >= config.takeProfitPct;
  const hitSL = pnl <= -config.stopLossPct;
  if (!hitTP && !hitSL) return;

  const reason = hitTP ? `take-profit +${(pnl * 100).toFixed(0)}%` : `stop-loss ${(pnl * 100).toFixed(0)}%`;
  console.log(`🚪 exiting ${pos.symbol || short(ev.mint)}: ${reason}`);

  // Sell the entire position (100% of held tokens).
  const result = await executeTrade('sell', ev.mint, '100%', false);
  if (result.ok) {
    store.remove(ev.mint);
    feed.unwatchMint(ev.mint);
    console.log(`   ✅ closed ${short(ev.mint)} (${reason})`);
  }
}

const short = (s) => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : '?');

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
