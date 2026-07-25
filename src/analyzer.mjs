// Claude-powered trade analysis. This is the pump.fun analogue of the old
// Abstract-chain gemini-service.ts — same job (data in, decision out), but the
// analyst is Claude (via the Claude Code proxy) and the asset is a pump.fun coin.
import { claudeComplete } from './claudeClient.mjs';

const SYSTEM = `You are a disciplined memecoin trading analyst for pump.fun tokens on Solana.
You are ruthless about risk: the vast majority of pump.fun launches go to zero, are
rug pulls, or are bundled/sniped. Your default stance is HOLD (do nothing). Only
recommend BUY when the specific data in front of you is unusually favorable.

Return ONLY a JSON object, no prose, in exactly this shape:
{
  "action": "BUY" | "HOLD",
  "confidence": 0.0-1.0,
  "reasoning": "one or two sentences",
  "riskScore": 0.0-1.0,
  "redFlags": ["..."]
}`;

/**
 * @param {object} token  { mint, name, symbol, marketCapSol, solInPool, creator, ... }
 * @returns {Promise<{action:'BUY'|'HOLD', confidence:number, reasoning:string, riskScore:number, redFlags:string[]}>}
 */
export async function analyzeNewToken(token) {
  const prompt = `A new pump.fun token just launched. Decide whether to BUY a small position or HOLD (skip).

TOKEN DATA:
${JSON.stringify(token, null, 2)}

Consider: how much SOL is in the bonding curve, the implied market cap, whether the
creator dumped their initial allocation, name/symbol quality, and how many red flags
you can identify. When in doubt, HOLD. Respond with the JSON object only.`;

  const text = await claudeComplete({ system: SYSTEM, prompt });
  return parseDecision(text);
}

function parseDecision(text) {
  const fallback = {
    action: 'HOLD',
    confidence: 0,
    reasoning: 'Could not parse analyst response; defaulting to HOLD.',
    riskScore: 1,
    redFlags: ['unparseable-response'],
  };
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const p = JSON.parse(match[0]);
    const action = p.action === 'BUY' ? 'BUY' : 'HOLD';
    return {
      action,
      confidence: clamp01(p.confidence),
      reasoning: String(p.reasoning || '').slice(0, 400),
      riskScore: clamp01(p.riskScore ?? 0.5),
      redFlags: Array.isArray(p.redFlags) ? p.redFlags.slice(0, 8) : [],
    };
  } catch {
    return fallback;
  }
}

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
