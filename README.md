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

## Setup

```bash
cd solana-pumpfun
npm install
cp .env.example .env      # then edit .env
```

Fill in `.env`:
- **`SOLANA_PRIVATE_KEY`** — a **dedicated burner** wallet, funded with only what you can lose.
- **`SOLANA_RPC_URL`** — a paid RPC (Helius/QuickNode). The public one is too slow for sniping.
- Sizing caps are already set conservatively — review them.

Make sure you're logged into Claude Code on this machine (the proxy uses that session).

## Run

Two terminals:

```bash
npm run proxy    # terminal 1 — Claude Code proxy
```

```bash
npm run bot      # terminal 2 — the trader
```

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
