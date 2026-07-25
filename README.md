# JopTrades — Solana / pump.fun auto-trader

The Abstract-chain bot, ported to **Solana + pump.fun**, with **Claude as the analyst**
(via a local Claude Code subscription proxy — no API key).

```
new pump.fun launch ──▶ PumpPortal websocket ──▶ Claude Code proxy (analysis)
                                                        │
                                                   BUY / HOLD
                                                        │
                                          PumpPortal trade-local ──▶ your RPC ──▶ Solana
                                                        │
                              held positions ──▶ trade stream ──▶ take-profit / stop-loss ──▶ SELL
```

## Pieces

| File | Role |
|---|---|
| `claude-proxy/server.mjs` | Wraps the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`). Uses your local Claude Code login for auth. Exposes `POST /v1/complete`. |
| `src/analyzer.mjs` | Builds the trading prompt, calls the proxy, parses Claude's BUY/HOLD JSON. |
| `src/pumpportal.mjs` | One PumpPortal websocket: new-token + trade streams. |
| `src/executor.mjs` | Buys/sells on pump.fun via PumpPortal (`local` non-custodial by default, or `lightning`). |
| `src/config.mjs` | All safety caps + the live-trading guards. |
| `src/bot.mjs` | The loop. |

## Quick start (3 commands)

```bash
cd solana-pumpfun
npm install
npm run setup    # makes the bot a wallet and writes .env for you
```

`setup` prints a Solana address — **send SOL to it from Phantom** to fund the bot
(start small; treat it as fully at-risk). Check it landed with `npm run balance`.

Then run everything with one command (starts the Claude proxy + the trader):

```bash
npm start          # dry run — analyzes real launches, sends nothing on-chain
npm run start:live # real trading with the SOL you funded
```

Make sure you're logged into Claude Code on this machine — the proxy uses that session.

> **Why not "connect Phantom" directly?** Phantom asks you to approve every
> transaction in a popup and needs the browser open — impossible for a bot that
> must fire on launches in milliseconds. So the bot uses its own wallet that you
> fund from Phantom, and you can sweep SOL back to Phantom anytime.

## Going live (deliberate friction)

Out of the box the bot is in **dry run**: it analyzes real launches and logs the trades
it *would* make, but sends nothing on-chain. To trade real SOL you must set **both**:

```
DRY_RUN=false
I_UNDERSTAND_LIVE_TRADING=true
```

`KILL_SWITCH=true` instantly stops all buys (analysis continues). Hard caps
(`MAX_POSITION_SOL`, `MAX_OPEN_POSITIONS`, `MAX_DAILY_SPEND_SOL`) are enforced on every
buy regardless of what Claude says.

## Reality check

pump.fun launch-sniping is one of the highest-variance activities in crypto — most tokens
go to zero, and many are rugs or bundled. The caps and guards limit how fast a bad run (or
a bug) can drain the wallet; they do not make this safe. Run in dry run first, size small,
and treat the whole balance as at-risk.
