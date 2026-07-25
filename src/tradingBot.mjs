// The trading bot as an EventEmitter, so both the CLI and the web server can
// run it and watch what it does. Emits a single 'event' stream of typed items:
//   { type:'log',      level, msg }
//   { type:'analysis', mint, symbol, action, confidence, risk, reasoning }
//   { type:'trade',    side, mint, symbol, amountSol, signature, dryRun }
//   { type:'position', action:'open'|'close', mint, symbol, reason }
import { EventEmitter } from 'events';
import { config, liveTradingEnabled, modeBanner, checkBuyAllowed } from './config.mjs';
import { analyzeNewToken } from './analyzer.mjs';
import { executeTrade } from './executor.mjs';
import { PumpPortalFeed } from './pumpportal.mjs';
import { store } from './positions.mjs';
import { loadKeypair, getSolBalance } from './wallet.mjs';

export class TradingBot extends EventEmitter {
  constructor() {
    super();
    this.feed = new PumpPortalFeed();
    this.analyzing = false;
    this.started = false;
    this.lastAnalyzeAt = 0;
    this.watched = 0;    // launches seen since last heartbeat
    this.analyzed = 0;   // Claude calls since last heartbeat
    this.skipped = 0;    // filtered out (no Claude call) since last heartbeat
  }

  emitEvent(ev) {
    this.emit('event', { ts: Date.now(), ...ev });
  }
  log(msg, level = 'info') {
    console.log(msg);
    this.emitEvent({ type: 'log', level, msg });
  }

  async start() {
    if (this.started) return;
    this.started = true;

    this.log('=== JopTrades — Solana / pump.fun ===');
    this.log(modeBanner());
    this.log(
      `caps: buy ${config.buyAmountSol} SOL | maxPos ${config.maxPositionSol} | ` +
      `openMax ${config.maxOpenPositions} | dailyMax ${config.maxDailySpendSol} | ` +
      `minConf ${config.minConfidence} | TP +${config.takeProfitPct * 100}% | SL -${config.stopLossPct * 100}%`,
    );

    try {
      const kp = loadKeypair();
      const bal = await getSolBalance(kp.publicKey);
      this.log(`👛 wallet ${kp.publicKey.toBase58()} — ${bal.toFixed(4)} SOL`);
    } catch (e) {
      if (liveTradingEnabled()) throw e;
      this.log(`👛 no wallet loaded (${e.message}) — fine for dry run`, 'warn');
    }

    for (const p of store.open()) this.feed.watchMint(p.mint);
    this.feed.onNewToken((t) => this.handleNewToken(t));
    this.feed.onTokenTrade((ev) => this.handleTokenTrade(ev));
    this.feed.connect();

    // Heartbeat: show it's alive + how many Claude calls we're actually making.
    setInterval(() => {
      if (this.watched === 0) return;
      this.log(
        `⏱  last min: ${this.watched} launches seen · ${this.analyzed} analyzed by Claude · ${this.skipped} pre-filtered`,
      );
      this.watched = this.analyzed = this.skipped = 0;
    }, 60_000);
  }

  async handleNewToken(token) {
    this.watched++;

    // --- cheap local gates first (no Claude call) ---------------------
    if (this.analyzing) return;
    if (store.openCount() >= config.maxOpenPositions) return;
    if (store.spentToday() + config.buyAmountSol > config.maxDailySpendSol) return;

    // Rate limit: at most one Claude call per cooldown window.
    if (Date.now() - this.lastAnalyzeAt < config.analyzeCooldownMs) { this.skipped++; return; }

    // Skip obvious low-effort launches before spending a Claude call.
    const creatorBuySol = Number(token.solAmount) || 0;
    if (creatorBuySol < config.minCreatorBuySol) { this.skipped++; return; }

    this.lastAnalyzeAt = Date.now();
    this.analyzed++;
    this.analyzing = true;
    try {
      const decision = await analyzeNewToken(token);
      const tag = `${token.symbol || '?'} (${short(token.mint)})`;
      this.log(
        `🔎 ${tag}: ${decision.action} conf=${decision.confidence.toFixed(2)} ` +
        `risk=${decision.riskScore.toFixed(2)} — ${decision.reasoning}`,
      );
      this.emitEvent({
        type: 'analysis', mint: token.mint, symbol: token.symbol, name: token.name,
        uri: token.uri, marketCapSol: token.marketCapSol, creator: token.traderPublicKey,
        action: decision.action, confidence: decision.confidence,
        risk: decision.riskScore, reasoning: decision.reasoning, redFlags: decision.redFlags,
      });

      if (decision.action !== 'BUY' || decision.confidence < config.minConfidence) return;

      const gate = checkBuyAllowed({
        amountSol: config.buyAmountSol,
        spentToday: store.spentToday(),
        openPositions: store.openCount(),
      });
      if (!gate.ok) {
        this.log(`   ⛔ buy blocked: ${gate.reason}`, 'warn');
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
      this.feed.watchMint(token.mint);
      this.log(`   📈 opened ${tag} for ${config.buyAmountSol} SOL`);
      this.emitEvent({
        type: 'trade', side: 'buy', mint: token.mint, symbol: token.symbol,
        amountSol: config.buyAmountSol, signature: result.signature || null, dryRun: !!result.dryRun,
      });
      this.emitEvent({ type: 'position', action: 'open', mint: token.mint, symbol: token.symbol });
    } catch (e) {
      this.log(`handleNewToken error: ${e.message}`, 'error');
    } finally {
      this.analyzing = false;
    }
  }

  async handleTokenTrade(ev) {
    const pos = store.get(ev.mint);
    if (!pos || pos.entryMcapSol == null || ev.marketCapSol == null) return;

    const pnl = (ev.marketCapSol - pos.entryMcapSol) / pos.entryMcapSol;
    const hitTP = pnl >= config.takeProfitPct;
    const hitSL = pnl <= -config.stopLossPct;
    if (!hitTP && !hitSL) return;

    const reason = hitTP ? `take-profit +${(pnl * 100).toFixed(0)}%` : `stop-loss ${(pnl * 100).toFixed(0)}%`;
    this.log(`🚪 exiting ${pos.symbol || short(ev.mint)}: ${reason}`);

    const result = await executeTrade('sell', ev.mint, '100%', false);
    if (result.ok) {
      store.remove(ev.mint);
      this.feed.unwatchMint(ev.mint);
      this.log(`   ✅ closed ${short(ev.mint)} (${reason})`);
      this.emitEvent({
        type: 'trade', side: 'sell', mint: ev.mint, symbol: pos.symbol,
        amountSol: null, signature: result.signature || null, dryRun: !!result.dryRun,
      });
      this.emitEvent({ type: 'position', action: 'close', mint: ev.mint, symbol: pos.symbol, reason });
    }
  }
}

export const short = (s) => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : '?');
