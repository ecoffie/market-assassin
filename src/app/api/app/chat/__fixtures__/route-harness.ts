/**
 * Shared, mock-free helpers for the Ask Mindy route tests (src/app/api/app/chat/*.route.unit.test.ts).
 *
 * The vi.mock() calls live in each test file (they are hoisted per file). This module only builds
 * fake provider responses and reads the SSE stream the route returns, so every chat reliability test
 * drives the REAL route handler end to end: planner → tool executor → answer stream → events.
 */

export interface SseEvent { type: string; [k: string]: unknown }

/** A fetch Response whose body never produces a byte, but which honors the abort signal like real fetch. */
export function hangingFetch(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) { reject(abortError(signal)); return; }
    signal?.addEventListener?.('abort', () => reject(abortError(signal)), { once: true });
  });
}

function abortError(signal: AbortSignal): Error {
  const reason = (signal as { reason?: unknown }).reason;
  if (reason instanceof Error) return reason;
  const e = new Error('The operation was aborted.');
  e.name = 'AbortError';
  return e;
}

/** OpenAI-shaped non-streamed planner response. */
export function plannerResponse(toolCalls: Array<{ name: string; args: unknown; id?: string }>): Response {
  return new Response(JSON.stringify({
    choices: [{
      message: {
        content: null,
        tool_calls: toolCalls.length ? toolCalls.map((c, i) => ({
          id: c.id ?? `call_${i}`,
          type: 'function',
          function: { name: c.name, arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args) },
        })) : undefined,
      },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** OpenAI-shaped streamed answer: one delta per chunk, then finish_reason, usage and [DONE]. */
export function answerStream(chunks: string[], finishReason = 'stop'): Response {
  const enc = new TextEncoder();
  const frames = [
    ...chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 } })}\n\n`,
    'data: [DONE]\n\n',
  ];
  return new Response(new ReadableStream({
    start(c) { for (const f of frames) c.enqueue(enc.encode(f)); c.close(); },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** A streamed answer that sends its first chunks and then stalls forever (until aborted/cancelled). */
export function stallingAnswerStream(chunks: string[]): Response {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`)); },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

export function isPlannerCall(body: Record<string, unknown>): boolean {
  return Array.isArray(body.tools) && body.stream !== true;
}

/** Read every SSE event the route emits; resolves when the stream closes. */
export async function readSse(res: Response): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const p of parts) {
      const line = p.trim();
      if (!line.startsWith('data:')) continue;
      try { out.push(JSON.parse(line.slice(5).trim())); } catch { /* ignore */ }
    }
  }
  return out;
}

export function answerText(events: SseEvent[]): string {
  return events.filter((e) => e.type === 'token').map((e) => String(e.content ?? '')).join('');
}

export function chatRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/app/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'erika@example.com', ...body }),
  });
}

/** Fails (rather than hanging the suite) if the route never closes its stream. */
export async function withinMs<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_r, reject) => { t = setTimeout(() => reject(new Error(`${label}: did not finish within ${ms} ms`)), ms); }),
    ]);
  } finally { if (t) clearTimeout(t); }
}
