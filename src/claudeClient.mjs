// Thin HTTP client to the Claude Code proxy.
import { config } from './config.mjs';

export async function claudeComplete({ system, prompt }) {
  const res = await fetch(`${config.proxyUrl}/v1/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ system, prompt }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`proxy ${res.status}: ${body}`);
  }
  const { text } = await res.json();
  return text;
}
