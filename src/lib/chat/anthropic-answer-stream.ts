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

export const ANSWER_STEP_RULE = 'ANSWER STEP: you have no tools in this step and must not write tool calls, XML tags such as <invoke> or <function_calls>, or JSON tool requests. Write the reply to the customer now, from the tool results above. If a fact is missing, say what is missing and what you would look up next, in plain words.';


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
  // This is the ANSWER step: no tools are attached. Without this line Claude imitated the tool turns above and
  // printed tool-call markup as the reply (preview, 2026-11-25).
  system.push(ANSWER_STEP_RULE);
  return { system: system.join('\n\n'), messages: out };
}

/** Claude models that take adaptive thinking (the current families). Older models get no thinking parameter. */
export function supportsAdaptiveThinking(model: string): boolean {
  return /(opus-5|sonnet-5|fable-5|mythos-5|opus-4-[678])/i.test(model);
}

const MARKUP_OPEN = ['<function_calls', '<invoke', '<parameter'];
const MARKUP_CLOSE: Record<string, string> = { '<function_calls': '</function_calls>', '<invoke': '</invoke>', '<parameter': '</parameter>' };

/**
 * Streaming filter: text passes through as it arrives, except tool-call markup, which is held from its first '<'
 * only until it can be told apart from ordinary text, then dropped through its closing tag.
 */
export function createMarkupFilter(): { push(t: string): string; end(): string } {
  let held = '';
  const drain = (final: boolean): string => {
    let out = '';
    for (;;) {
      const i = held.indexOf('<');
      if (i === -1) { out += held; held = ''; return out; }
      out += held.slice(0, i); held = held.slice(i);
      const tag = MARKUP_OPEN.find((t) => held.startsWith(t));
      if (tag) {
        const close = held.indexOf(MARKUP_CLOSE[tag]);
        if (close === -1) { if (final) held = ''; return out; } // wait for the close (or drop an unclosed tail)
        held = held.slice(close + MARKUP_CLOSE[tag].length);
        continue;
      }
      if (!final && MARKUP_OPEN.some((t) => t.startsWith(held))) return out; // could still become markup
      out += '<'; held = held.slice(1);
    }
  };
  return { push: (t: string) => { held += t; return drain(false); }, end: () => drain(true) };
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
        const filter = createMarkupFilter();
        const emit = (t: string) => { if (t) ctrl.enqueue(frame({ choices: [{ index: 0, delta: { content: t }, finish_reason: null }] })); };
        while (!r.done) {
          const ev = r.value as { type?: string; delta?: { type?: string; text?: string } };
          if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) emit(filter.push(ev.delta.text));
          r = await iter.next();
        }
        emit(filter.end());
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
