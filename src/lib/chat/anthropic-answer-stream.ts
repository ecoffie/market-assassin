/**
 * Claude as the Ask Mindy ANSWER model (CHAT_CLAUDE_ANSWER=true).
 *
 * Eric, 2026-11-25: Ask Mindy must match Claude + the Mindy MCP. The answer step was OpenAI-only; a blind
 * side-by-side on a bid/no-bid question scored Ask Mindy 4/10 and Claude + MCP 9/10 with the same tool evidence.
 *
 * The chat route's answer loop reads an OpenAI-style SSE body (choices[0].delta.content, a final usage frame,
 * [DONE]). This adapter calls Claude through the official SDK (streaming) and re-emits exactly that shape, so the
 * route's parser, guards, rewrites and billing stay unchanged.
 *
 * Message mapping (the route builds OpenAI chat messages):
 *   - every `system` message, in order, becomes the system prompt. Notes added after the customer's question
 *     (record lists, fit notes, evidence guards) are instructions/evidence, so their place in the system prompt
 *     keeps their meaning; the route already labels each one.
 *   - an assistant turn with tool_calls becomes assistant text naming the calls; a `tool` message becomes a user
 *     turn "TOOL RESULT (<name>)" with its (already bounded, fenced where needed) content.
 *   - consecutive turns of the same role are merged; the conversation always starts with a user turn.
 * A connect failure (bad key, 4xx/5xx, network) returns a non-OK Response so the route falls back to the next
 * answer model exactly as it does for OpenAI.
 */
import Anthropic from '@anthropic-ai/sdk';

type OaMsg = { role: string; content?: unknown; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>; tool_call_id?: string; name?: string };

const text = (c: unknown): string => {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text ?? '') : ''))).join('');
  return c == null ? '' : String(c);
};

export function toAnthropicMessages(msgs: OaMsg[]): { system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> } {
  const system: string[] = [];
  const toolNames = new Map<string, string>();
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const push = (role: 'user' | 'assistant', content: string) => {
    if (!content.trim()) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n\n${content}`;
    else out.push({ role, content });
  };
  for (const m of msgs) {
    if (m.role === 'system') { const t = text(m.content); if (t.trim()) system.push(t); continue; }
    if (m.role === 'assistant') {
      const parts: string[] = [];
      const t = text(m.content); if (t.trim()) parts.push(t);
      for (const tc of m.tool_calls || []) {
        const name = tc.function?.name || 'tool';
        if (tc.id) toolNames.set(tc.id, name);
        parts.push(`[Called ${name} with ${tc.function?.arguments || '{}'}]`);
      }
      push('assistant', parts.join('\n'));
      continue;
    }
    if (m.role === 'tool') {
      const name = (m.tool_call_id && toolNames.get(m.tool_call_id)) || m.name || 'tool';
      push('user', `TOOL RESULT (${name}):\n${text(m.content)}`);
      continue;
    }
    push('user', text(m.content));
  }
  if (!out.length || out[0].role !== 'user') out.unshift({ role: 'user', content: '(conversation start)' });
  // The answer is the assistant's next turn: the last message must be the user's.
  if (out[out.length - 1].role !== 'user') out.push({ role: 'user', content: 'Answer my last question using the results above.' });
  return { system: system.join('\n\n'), messages: out };
}

/** Claude models that take adaptive thinking (the current families). Older models get no thinking parameter. */
export function supportsAdaptiveThinking(model: string): boolean {
  return /(opus-5|sonnet-5|fable-5|mythos-5|opus-4-[678])/i.test(model);
}

const enc = new TextEncoder();
const frame = (o: unknown) => enc.encode(`data: ${JSON.stringify(o)}\n\n`);

export async function anthropicAnswerResponse(opts: {
  apiKey: string;
  model: string;
  messages: OaMsg[];
  maxTokens: number;
  signal: AbortSignal;
  client?: Pick<Anthropic, 'messages'>;
}): Promise<Response> {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
  const { system, messages } = toAnthropicMessages(opts.messages);
  const thinking = supportsAdaptiveThinking(opts.model);
  let stream: ReturnType<Anthropic['messages']['stream']>;
  let iter: AsyncIterator<unknown>;
  let first: IteratorResult<unknown>;
  try {
    stream = client.messages.stream({
      model: opts.model,
      // Thinking shares the output budget; the visible answer keeps the route's cap.
      max_tokens: opts.maxTokens + (thinking ? 8_000 : 0),
      ...(system ? { system } : {}),
      ...(thinking ? { thinking: { type: 'adaptive' as const } } : {}),
      messages,
    }, { signal: opts.signal });
    iter = (stream as unknown as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    first = await iter.next(); // connect: auth / 4xx / 5xx surface here, before any byte reaches the customer
  } catch (e) {
    const status = (e as { status?: number })?.status;
    return new Response(String((e as Error)?.message || e).slice(0, 300), { status: typeof status === 'number' && status >= 400 ? status : 502 });
  }
  const body = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      try {
        let r: IteratorResult<unknown> = first;
        while (!r.done) {
          const ev = r.value as { type?: string; delta?: { type?: string; text?: string } };
          if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
            ctrl.enqueue(frame({ choices: [{ index: 0, delta: { content: ev.delta.text }, finish_reason: null }] }));
          }
          r = await iter.next();
        }
        const final = await stream.finalMessage();
        const stop = final.stop_reason === 'max_tokens' ? 'length' : 'stop';
        ctrl.enqueue(frame({ choices: [{ index: 0, delta: {}, finish_reason: stop }] }));
        const u = final.usage;
        ctrl.enqueue(frame({ choices: [], usage: { prompt_tokens: u.input_tokens, completion_tokens: u.output_tokens, total_tokens: u.input_tokens + u.output_tokens } }));
        ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
        ctrl.close();
      } catch (e) {
        ctrl.error(e);
      }
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
