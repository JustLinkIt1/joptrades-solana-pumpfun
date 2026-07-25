// Solana wallet loading + balance.
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
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
