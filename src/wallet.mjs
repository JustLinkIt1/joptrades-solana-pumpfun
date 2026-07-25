// Solana wallet loading + balance + withdraw.
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey,
  SystemProgram, Transaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from './config.mjs';

export const connection = new Connection(config.rpcUrl, 'confirmed');

/** Load the trading keypair from SOLANA_PRIVATE_KEY (base58 or JSON byte array). */
export function loadKeypair() {
  const raw = config.privateKey?.trim();
  if (!raw) throw new Error('SOLANA_PRIVATE_KEY is not set');
  if (raw.startsWith('[')) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  }
  return Keypair.fromSecretKey(bs58.decode(raw));
}

export async function getSolBalance(pubkey) {
  const lamports = await connection.getBalance(pubkey);
  return lamports / LAMPORTS_PER_SOL;
}

/** Withdraw SOL from the bot wallet to `toAddress`. Returns the tx signature. */
export async function withdrawSol(toAddress, amountSol) {
  const from = loadKeypair();
  const to = new PublicKey(toAddress);
  const lamports = Math.floor(Number(amountSol) * LAMPORTS_PER_SOL);
  if (!Number.isFinite(lamports) || lamports <= 0) throw new Error('invalid amount');

  const balance = await connection.getBalance(from.publicKey);
  const feeReserve = 5000; // leave a little for the tx fee
  if (lamports + feeReserve > balance) throw new Error('insufficient balance for that amount + fee');

  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports }),
  );
  const sig = await connection.sendTransaction(tx, [from]);
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

/** Latest blockhash — used by the browser to build a deposit transfer. */
export async function getLatestBlockhash() {
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  return blockhash;
}
