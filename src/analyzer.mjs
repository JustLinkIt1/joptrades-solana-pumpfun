// Claude-powered trade analysis. This is the pump.fun analogue of the old
// Abstract-chain gemini-service.ts — same job (data in, decision out), but the
// analyst is Claude (via the Claude Code proxy) and the asset is a pump.fun coin.
import { claudeComplete } from './claudeClient.mjs';

const SYSTEM = `You are a pump.fun launch scout on Solana. You are shown the single
strongest new launch of the last window — the one whose creator committed the most SOL.
Every pump.fun buy is high-risk speculation and many go to zero, but your job is to pick
the launches worth a SMALL speculative punt, not to avoid all risk.

Decide BUY vs HOLD:
- BUY (confidence 0.6-0.8) when the launch has genuine positives: real creator commitment,
  a coherent/memorable name or theme, sensible market cap, and no glaring rug signals.
  You do NOT need certainty — a promising speculative launch is a BUY.
- HOLD only when there are clear red flags (creator dumping, obvious copy/spam, contradictory
  data) or nothing at all distinguishes it.

Do not reflexively HOLD. If this is a reasonable speculative launch, say BUY.

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
  const prompt = `This is the strongest new pump.fun launch of the last window (biggest creator buy-in).
Decide: BUY a small speculative position, or HOLD (skip)?

TOKEN DATA:
${JSON.stringify(token, null, 2)}

Weigh: creator buy-in size (conviction) vs. how much of supply they hold (dump risk),
implied market cap, and name/theme quality. This launch already cleared a spam filter, so
judge it as a real candidate — if it's a reasonable speculative punt, say BUY. Respond with the JSON object only.`;

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
