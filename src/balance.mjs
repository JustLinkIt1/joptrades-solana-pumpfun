// Quick wallet balance check:  npm run balance
import { loadKeypair, getSolBalance } from './wallet.mjs';

const kp = loadKeypair();
const bal = await getSolBalance(kp.publicKey);
console.log(`${kp.publicKey.toBase58()} — ${bal.toFixed(4)} SOL`);
