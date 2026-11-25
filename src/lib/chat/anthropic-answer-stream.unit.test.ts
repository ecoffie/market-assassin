import { describe, it, expect } from 'vitest';
import { anthropicAnswerResponse, supportsAdaptiveThinking, toAnthropicMessages } from './anthropic-answer-stream';
import { claudeAnswerTarget, resolveAnswerChain } from './planner-config';

describe('toAnthropicMessages', () => {
  it('system notes become the system prompt in order; tool calls and results become plain turns; same roles merge', () => {
    const r = toAnthropicMessages([
      { role: 'system', content: 'You are Mindy.' },
      { role: 'user', content: 'Should we pursue 36C24823P1623?' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'get_award_detail', arguments: '{"piid":"36C24823P1623"}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '{"incumbent":"Citadel"}' },
      { role: 'system', content: 'VERIFIED RECORD LIST ...' },
    ]);
    expect(r.system).toBe('You are Mindy.\n\nVERIFIED RECORD LIST ...');
    expect(r.messages).toEqual([
      { role: 'user', content: 'Should we pursue 36C24823P1623?' },
      { role: 'assistant', content: '[Called get_award_detail with {"piid":"36C24823P1623"}]' },
      { role: 'user', content: 'TOOL RESULT (get_award_detail):\n{"incumbent":"Citadel"}' },
    ]);
  });

  it('always starts with a user turn and ends with one', () => {
    const r = toAnthropicMessages([{ role: 'assistant', content: 'Earlier answer.' }]);
    expect(r.messages[0].role).toBe('user');
    expect(r.messages[r.messages.length - 1].role).toBe('user');
  });
});

describe('supportsAdaptiveThinking', () => {
  it('current Claude families only', () => {
    expect(supportsAdaptiveThinking('claude-opus-5-5')).toBe(true);
    expect(supportsAdaptiveThinking('claude-sonnet-5-5')).toBe(true);
    expect(supportsAdaptiveThinking('claude-haiku-5-5')).toBe(false);
  });
});

/** A fake SDK client: yields the given events, then a final message with usage. */
function fakeClient(events: unknown[], opts: { connectError?: { status: number; message: string } } = {}) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    messages: {
      stream(params: Record<string, unknown>) {
        calls.push(params);
        let i = 0;
        return {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                if (opts.connectError) throw Object.assign(new Error(opts.connectError.message), { status: opts.connectError.status });
                return i < events.length ? { done: false, value: events[i++] } : { done: true, value: undefined };
              },
            };
          },
          async finalMessage() { return { stop_reason: 'end_turn', usage: { input_tokens: 1200, output_tokens: 340 } }; },
        };
      },
    },
  };
}

async function readAll(r: Response): Promise<string> { return await r.text(); }

describe('anthropicAnswerResponse', () => {
  it('re-emits Claude text as OpenAI-style SSE with a usage frame and [DONE]', async () => {
    const client = fakeClient([
      { type: 'message_start' },
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'private' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Pursue it ' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'if you are an SDVOSB.' } },
    ]);
    const r = await anthropicAnswerResponse({ apiKey: 'k', model: 'claude-opus-5-5', messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'Q' }], maxTokens: 2048, signal: new AbortController().signal, client: client as never });
    expect(r.ok).toBe(true);
    const body = await readAll(r);
    const frames = body.split('\n\n').filter(Boolean).map((l) => l.replace(/^data: /, ''));
    expect(frames.at(-1)).toBe('[DONE]');
    const parsed = frames.slice(0, -1).map((f) => JSON.parse(f));
    const text = parsed.map((p) => p.choices?.[0]?.delta?.content || '').join('');
    expect(text).toBe('Pursue it if you are an SDVOSB.');
    expect(body).not.toContain('private'); // thinking is never shown
    expect(parsed.find((p) => p.usage)?.usage).toEqual({ prompt_tokens: 1200, completion_tokens: 340, total_tokens: 1540 });
    expect(client.calls[0]).toMatchObject({ model: 'claude-opus-5-5', system: 'S', thinking: { type: 'adaptive' }, max_tokens: 2048 + 8000 });
  });

  it('a connect error is a non-OK Response, so the route falls back to the next answer model', async () => {
    const client = fakeClient([], { connectError: { status: 401, message: 'invalid x-api-key' } });
    const r = await anthropicAnswerResponse({ apiKey: 'bad', model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'Q' }], maxTokens: 2048, signal: new AbortController().signal, client: client as never });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
});

describe('answer chain with Claude', () => {
  const KEYS = { OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' };
  it('off by default: OpenAI primary as before', () => {
    expect(resolveAnswerChain(KEYS, { primaryModel: 'gpt-6.1-terra' })[0]).toEqual({ provider: 'openai', model: 'gpt-6.1-terra' });
  });
  it('CHAT_CLAUDE_ANSWER=true: Claude first, OpenAI kept as fallback', () => {
    const chain = resolveAnswerChain({ ...KEYS, CHAT_CLAUDE_ANSWER: 'true' }, { primaryModel: 'gpt-6.1-terra' });
    expect(chain.slice(0, 2)).toEqual([{ provider: 'anthropic', model: 'claude-opus-5-5' }, { provider: 'openai', model: 'gpt-6.1-terra' }]);
  });
  it('no Claude without the key, or for a downgraded over-budget user', () => {
    expect(claudeAnswerTarget({ CHAT_CLAUDE_ANSWER: 'true' })).toBeNull();
    expect(claudeAnswerTarget({ ...KEYS, CHAT_CLAUDE_ANSWER: 'true' }, { downgrade: true })).toBeNull();
    expect(claudeAnswerTarget({ ...KEYS, CHAT_CLAUDE_ANSWER: 'true', CHAT_CLAUDE_ANSWER_MODEL: 'claude-sonnet-5-5' })).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
  });
});
