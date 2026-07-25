// pump.fun trade execution via PumpPortal.
//   local     -> we build the tx (POST /api/trade-local), sign with our keypair,
//                and broadcast through our own RPC. Non-custodial. (default)
//   lightning -> PumpPortal signs/sends from a wallet you funded. Needs API key.
//
// Every path respects DRY_RUN / live guards — see config.liveTradingEnabled().
import { VersionedTransaction } from '@solana/web3.js';
import { config, liveTradingEnabled } from './config.mjs';
import { connection, loadKeypair } from './wallet.mjs';

/**
 * Execute a buy or sell.
 * @param {'buy'|'sell'} action
 * @param {string} mint
 * @param {number|string} amount  SOL amount for buys; token amount or "100%" for sells
 * @param {boolean} denominatedInSol  true for buys (amount is SOL)
 * @returns {Promise<{ok:boolean, signature?:string, dryRun?:boolean, error?:string}>}
 */
export async function executeTrade(action, mint, amount, denominatedInSol) {
  const label = `${action.toUpperCase()} ${amount}${denominatedInSol ? ' SOL' : ' tokens'} of ${mint}`;

  if (!liveTradingEnabled()) {
    console.log(`   🧪 [DRY RUN] would ${label}`);
    return { ok: true, dryRun: true };
  }

  try {
    if (config.executionMode === 'lightning') {
      return await lightningTrade(action, mint, amount, denominatedInSol);
    }
    return await localTrade(action, mint, amount, denominatedInSol);
  } catch (err) {
    console.error(`   ❌ trade failed: ${err?.message || err}`);
    return { ok: false, error: String(err?.message || err) };
  }
}

async function localTrade(action, mint, amount, denominatedInSol) {
  const keypair = loadKeypair();

  const res = await fetch('https://pumpportal.fun/api/trade-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: keypair.publicKey.toBase58(),
      action,
      mint,
      amount,
      denominatedInSol: String(denominatedInSol),
      slippage: config.slippagePercent,
      priorityFee: config.priorityFeeSol,
      pool: 'auto',
    }),
  });

  if (res.status !== 200) {
    throw new Error(`trade-local ${res.status}: ${await res.text()}`);
  }

  const data = await res.arrayBuffer();
  const tx = VersionedTransaction.deserialize(new Uint8Array(data));
  tx.sign([keypair]);
  const signature = await connection.sendTransaction(tx);
  console.log(`   ✅ sent: https://solscan.io/tx/${signature}`);
  return { ok: true, signature };
}

async function lightningTrade(action, mint, amount, denominatedInSol) {
  if (!config.pumpportalApiKey) throw new Error('lightning mode needs PUMPPORTAL_API_KEY');

  const res = await fetch(`https://pumpportal.fun/api/trade?api-key=${config.pumpportalApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      mint,
      amount,
      denominatedInSol: String(denominatedInSol),
      slippage: config.slippagePercent,
      priorityFee: config.priorityFeeSol,
      pool: 'auto',
    }),
  });

  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`lightning: ${JSON.stringify(json)}`);
  console.log(`   ✅ sent: https://solscan.io/tx/${json.signature}`);
  return { ok: true, signature: json.signature };
}
