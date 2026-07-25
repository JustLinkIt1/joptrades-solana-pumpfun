// CLI entry point for the bot (no UI). See start.mjs / server for the app.
import { TradingBot } from './tradingBot.mjs';

new TradingBot().start().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
