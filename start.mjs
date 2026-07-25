// One command to run everything: starts the Claude Code proxy, waits for it,
// then runs the bot in the same terminal.
//   npm start        → dry run (safe, no real trades)
//   npm run start:live → real trading
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const LIVE = process.argv.includes('--live');

// When --live, set the two guard flags before anything imports config.mjs.
// dotenv won't override vars already present in process.env, so these win.
if (LIVE) {
  process.env.DRY_RUN = 'false';
  process.env.I_UNDERSTAND_LIVE_TRADING = 'true';
  console.log('🔴 LIVE mode requested — real SOL will be spent.\n');
} else {
  console.log('🧪 DRY RUN — analyzing real launches, sending nothing on-chain.');
  console.log('   (use `npm run start:live` when you are ready to trade for real)\n');
}

const PORT = Number(process.env.CLAUDE_PROXY_PORT || 8787);

// 1) Start the proxy as a child process.
const proxy = spawn(process.execPath, [path.join(dir, 'claude-proxy', 'server.mjs')], {
  stdio: 'inherit',
  env: process.env,
});

function shutdown() {
  try { proxy.kill(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
proxy.on('exit', (code) => {
  console.error(`\n❌ proxy exited (code ${code}). Are you logged into Claude Code? Shutting down.`);
  process.exit(1);
});

// 2) Wait for the proxy to answer /health, then start the bot in-process.
async function waitForProxy(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/health`);
      if (r.ok) return true;
    } catch {}
    await new Promise((res) => setTimeout(res, 500));
  }
  return false;
}

const ok = await waitForProxy();
if (!ok) {
  console.error('❌ proxy did not come up in time. Shutting down.');
  shutdown();
}
console.log('✅ proxy ready — starting the trader.\n');
await import('./src/bot.mjs');
