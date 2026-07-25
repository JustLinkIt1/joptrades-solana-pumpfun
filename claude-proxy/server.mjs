// Claude Code proxy
// -----------------
// A tiny HTTP server that wraps the Claude Agent SDK. The Agent SDK bundles
// the Claude Code binary and authenticates with your existing Claude Code
// login / subscription — so this is how "Claude Code is the AI" without an
// API key. The bot POSTs a system+prompt here and gets back Claude's text.
//
// Run:  npm run proxy   (keep it running in its own terminal)

import express from 'express';
import { query } from '@anthropic-ai/claude-agent-sdk';
import dotenv from 'dotenv';

dotenv.config();

const PORT = Number(process.env.CLAUDE_PROXY_PORT || 8787);
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';

const app = express();
app.use(express.json({ limit: '1mb' }));

/**
 * Run one headless Claude Code turn and return the concatenated assistant text.
 * No tools are allowed — this is a pure "read data, return a decision" call.
 */
async function complete({ system, prompt }) {
  let text = '';

  for await (const message of query({
    prompt,
    options: {
      model: MODEL,
      maxTurns: 1,
      allowedTools: [], // analysis only — never let it touch the filesystem/shell
      systemPrompt: system,
    },
  })) {
    // Assistant text blocks carry the answer.
    if (message.type === 'assistant' && message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === 'text') text += block.text;
      }
    }
    // Some SDK versions surface a final "result" message with the full text.
    if (message.type === 'result' && typeof message.result === 'string' && !text) {
      text = message.result;
    }
  }

  return text.trim();
}

app.get('/health', (_req, res) => res.json({ ok: true, model: MODEL }));

app.post('/v1/complete', async (req, res) => {
  const { system, prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  try {
    const text = await complete({ system, prompt });
    res.json({ text });
  } catch (err) {
    console.error('[proxy] completion failed:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`🧠 Claude Code proxy listening on http://localhost:${PORT} (model: ${MODEL})`);
  console.log('   Auth: uses your local Claude Code login. Make sure you are logged in.');
});
