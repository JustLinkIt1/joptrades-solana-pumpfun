// Central config + safety layer. Everything money-touching reads from here.
import dotenv from 'dotenv';
dotenv.config();

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v) => String(v).toLowerCase() === 'true';

export const config = {
  // Claude proxy
  proxyUrl: process.env.CLAUDE_PROXY_URL || 'http://localhost:8787',

  // Solana
  privateKey: process.env.SOLANA_PRIVATE_KEY || '',
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',

  // pump.fun execution
  executionMode: (process.env.EXECUTION_MODE || 'local').toLowerCase(), // 'local' | 'lightning'
  pumpportalApiKey: process.env.PUMPPORTAL_API_KEY || '',
  wsApiKey: process.env.PUMPPORTAL_WS_API_KEY || '',

  // Sizing & caps (SOL)
  buyAmountSol: num(process.env.BUY_AMOUNT_SOL, 0.05),
  maxPositionSol: num(process.env.MAX_POSITION_SOL, 0.1),
  maxOpenPositions: num(process.env.MAX_OPEN_POSITIONS, 3),
  maxDailySpendSol: num(process.env.MAX_DAILY_SPEND_SOL, 0.5),
  slippagePercent: num(process.env.SLIPPAGE_PERCENT, 10),
  priorityFeeSol: num(process.env.PRIORITY_FEE_SOL, 0.00005),
  minConfidence: num(process.env.MIN_CONFIDENCE, 0.65),

  // Exits (fraction of entry)
  takeProfitPct: num(process.env.TAKE_PROFIT_PCT, 0.5),
  stopLossPct: num(process.env.STOP_LOSS_PCT, 0.3),

  // Guards
  dryRun: process.env.DRY_RUN === undefined ? true : bool(process.env.DRY_RUN),
  liveAck: bool(process.env.I_UNDERSTAND_LIVE_TRADING),
  killSwitch: bool(process.env.KILL_SWITCH),
};

/** True only when we are actually allowed to send real, on-chain trades. */
export function liveTradingEnabled() {
  return !config.dryRun && config.liveAck && !config.killSwitch;
}

/** Human-readable summary of the current mode, printed at startup. */
export function modeBanner() {
  if (config.killSwitch) return '🛑 KILL SWITCH ON — analysis only, no buys';
  if (config.dryRun) return '🧪 DRY RUN — logging trades, sending nothing on-chain';
  if (!config.liveAck) return '🔒 LIVE blocked — set I_UNDERSTAND_LIVE_TRADING=true to enable';
  return '🔴 LIVE TRADING — real SOL will be spent';
}

/**
 * Enforce hard caps before any buy. Returns { ok, reason }.
 * `spentToday` and `openPositions` are supplied by the caller (position store).
 */
export function checkBuyAllowed({ amountSol, spentToday, openPositions }) {
  if (config.killSwitch) return { ok: false, reason: 'kill switch on' };
  if (amountSol > config.maxPositionSol)
    return { ok: false, reason: `amount ${amountSol} > MAX_POSITION_SOL ${config.maxPositionSol}` };
  if (openPositions >= config.maxOpenPositions)
    return { ok: false, reason: `already holding ${openPositions} (max ${config.maxOpenPositions})` };
  if (spentToday + amountSol > config.maxDailySpendSol)
    return { ok: false, reason: `daily spend cap ${config.maxDailySpendSol} SOL would be exceeded` };
  return { ok: true };
}
