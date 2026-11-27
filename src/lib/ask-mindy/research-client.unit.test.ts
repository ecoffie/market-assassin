import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { researchClient } from './research-client';
import { REPORT_STEP_MAX_TOKENS } from './research-mode';

// A stub network layer: records that a request was SENT and returns a minimal message.
function stubFetch(sent: string[]): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    sent.push(String(url));
    return new Response(JSON.stringify({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const reportStep = (c: Anthropic) => c.messages.create(
  { model: 'claude-opus-5-5', max_tokens: REPORT_STEP_MAX_TOKENS, messages: [{ role: 'user', content: 'x' }] },
  { timeout: 60_000, maxRetries: 0 },
);

describe('research client: the report step is sent, not refused by the SDK', () => {
  it('a bare client refuses the 32K non-streaming report step before sending (the production failure)', async () => {
    const sent: string[] = [];
    // The SDK throws synchronously, before any request exists.
    await expect(Promise.resolve().then(() => reportStep(new Anthropic({ apiKey: 'test', fetch: stubFetch(sent) })))).rejects.toThrow(/Streaming is required/);
    expect(sent).toHaveLength(0);
  });

  it('researchClient() sends the 32K report step', async () => {
    const sent: string[] = [];
    const res = await reportStep(researchClient({ apiKey: 'test', fetch: stubFetch(sent) }));
    expect(sent).toHaveLength(1);
    expect(res.content[0]).toMatchObject({ type: 'text', text: 'ok' });
  });
});
