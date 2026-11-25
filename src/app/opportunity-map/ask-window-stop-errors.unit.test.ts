/**
 * Map Ask Mindy window: Stop and customer-safe errors (2026-11-22). Parity gaps with the old /app chat.
 * Runs the REAL drawer script (ASK_MINDY_JS) in jsdom.
 *
 * Before:
 * - A long answer in the map-view chat could not be stopped (the old chat had a Stop button).
 * - A stream `error` event's `message` was shown as is, while the old chat shows only the fixed
 *   customer-safe table (B2, src/lib/chat/customer-errors.ts).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'node:util';
import { JSDOM } from 'jsdom';
import { CUSTOMER_ERROR_MESSAGES } from '@/lib/chat/customer-errors';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
function drawerScript(): string {
  const a = MAP.indexOf('const ASK_MINDY_JS = `<script>');
  const b = MAP.indexOf('</script>`;', a);
  return MAP.slice(a + 'const ASK_MINDY_JS = `<script>'.length, b).replace(/\\\\/g, '\\');
}
const token = (email: string) => Buffer.from(JSON.stringify({ email, exp: Date.now() + 3_600_000 })).toString('base64').replace(/=+$/, '') + '.sig';
const sse = (evs: Array<Record<string, unknown>>) => evs.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

/** reply 'hold': sends `first` events, then keeps the stream open until the request is aborted. */
type Reply = { events: Array<Record<string, unknown>>; hold?: boolean };

function boot(replies: Reply[]) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="amkOv"></div><aside id="amk" aria-hidden="true"><div class="amk-hd"><div id="amkCtx"></div><button id="amkX"></button></div>'
    + '<div id="amkBody"></div><div class="amk-foot"><div class="amk-in"><textarea id="amkIn"></textarea><button id="amkSend"></button></div></div></aside></body></html>',
    { url: 'https://getmindy.ai/opportunity-map', runScripts: 'outside-only' },
  );
  const w = dom.window as unknown as Record<string, unknown> & Window & { eval: (s: string) => unknown };
  const store: Record<string, string> = { mi_beta_auth_token: token('pro@example.com') };
  Object.defineProperty(w, 'localStorage', { value: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } });
  w.TextDecoder = NodeTextDecoder as never;
  w.__mindyViewCtx = () => ({ count: 3, scope: 'all' });
  const chatBodies: Array<Record<string, unknown>> = [];
  const pending: Promise<unknown>[] = [];
  let i = 0;
  w.fetch = vi.fn((url: string, init: { body?: string; signal?: AbortSignal }) => {
    let p: Promise<unknown>;
    if (url.startsWith('/api/app/vault/doc-access')) p = Promise.resolve({ ok: true, status: 200, json: async () => ({ uploads: false, generate: false }) });
    else if (url.startsWith('/api/app/connected-apps')) p = Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'not_enabled' }) });
    else if (url.startsWith('/api/app/chat/suggestions')) p = Promise.resolve({ ok: true, status: 200, json: async () => ({ suggestions: [] }) });
    else {
      chatBodies.push(JSON.parse(init.body || '{}'));
      const r = replies[Math.min(i++, replies.length - 1)];
      const enc = new NodeTextEncoder();
      const signal = init.signal;
      if (signal?.aborted) p = Promise.reject(new Error('AbortError'));
      else {
        const stream = new ReadableStream({
          start(c) {
            c.enqueue(enc.encode(sse(r.events)));
            if (!r.hold) c.close();
            else signal?.addEventListener('abort', () => c.error(new Error('AbortError')));
          },
        });
        p = Promise.resolve({ ok: true, status: 200, body: stream, json: async () => ({}) });
      }
    }
    pending.push(p.catch(() => undefined));
    return p;
  }) as never;
  w.eval(drawerScript());
  const settle = async () => { for (let k = 0; k < 12; k++) { await Promise.all(pending); await new Promise((res) => setTimeout(res, 0)); } };
  const doc = w.document;
  const send = (q: string) => { (doc.getElementById('amkIn') as HTMLTextAreaElement).value = q; (doc.getElementById('amkSend') as HTMLButtonElement).click(); };
  (w as unknown as { openAskMindy: () => void }).openAskMindy();
  return { w, doc, chatBodies, settle, send };
}

const stopBtn = (doc: Document) => doc.querySelector('[data-testid="amk-stop"]') as HTMLButtonElement | null;
const lastAnswer = (doc: Document) => [...doc.querySelectorAll('.amk-msg.a .bub')].pop()?.textContent ?? '';

describe('Map Ask Mindy window: Stop', () => {
  it('Stop mid-answer keeps what arrived, says it may be incomplete, and frees the input', async () => {
    const t = boot([
      { events: [{ type: 'session', sessionId: 's1' }, { type: 'token', content: 'The first part of a long answer' }], hold: true },
      { events: [{ type: 'token', content: 'Next answer.' }, { type: 'done' }] },
    ]);
    t.send('Explain the market');
    await t.settle();
    expect(stopBtn(t.doc)).not.toBeNull();
    expect((t.doc.getElementById('amkSend') as HTMLButtonElement).disabled).toBe(true);
    stopBtn(t.doc)!.click();
    await t.settle();
    expect(lastAnswer(t.doc)).toContain('The first part of a long answer');
    expect(t.doc.querySelector('[data-testid="amk-stopped"]')?.textContent).toBe('You stopped this answer, so it may be incomplete.');
    expect(stopBtn(t.doc)).toBeNull();
    expect((t.doc.getElementById('amkSend') as HTMLButtonElement).disabled).toBe(false);
    expect(t.doc.body.textContent).not.toMatch(/Connection failed/);
    // The partial answer is part of the conversation the next question carries.
    t.send('And next?');
    await t.settle();
    const hist = t.chatBodies[1].history as Array<{ role: string; content: string }>;
    expect(hist.map((h) => h.role)).toEqual(['user', 'assistant']);
    expect(hist[1].content).toBe('The first part of a long answer');
    expect(t.chatBodies[1].sessionId).toBe('s1');
  });

  it('Stop before any text arrives says so plainly (no error, no typing dots)', async () => {
    const t = boot([{ events: [{ type: 'session', sessionId: 's1' }], hold: true }]);
    t.send('Explain the market');
    await t.settle();
    stopBtn(t.doc)!.click();
    await t.settle();
    expect(t.doc.querySelector('[data-testid="amk-stopped"]')?.textContent).toBe('You stopped this answer.');
    expect(t.doc.querySelector('.amk-typing')).toBeNull();
  });

  it('a normal answer removes the Stop button when it finishes', async () => {
    const t = boot([{ events: [{ type: 'token', content: 'Done.' }, { type: 'done' }] }]);
    t.send('Hello');
    await t.settle();
    expect(stopBtn(t.doc)).toBeNull();
    expect(t.doc.querySelector('[data-testid="amk-stopped"]')).toBeNull();
  });

  it('card chat (one opportunity, charged once per question) keeps its own retry flow, with no Stop', () => {
    expect(MAP).toContain("var ctrl=(!oppCtx&&typeof AbortController==='function')?new AbortController():null");
  });
});

describe('Map Ask Mindy window: only customer-safe error text is shown', () => {
  it('an unknown error message becomes the generic customer message', async () => {
    const t = boot([{ events: [{ type: 'error', message: 'OpenAI 429: quota exceeded for org-abc req_123' }, { type: 'done' }] }]);
    t.send('Hello');
    await t.settle();
    expect(lastAnswer(t.doc)).toBe(CUSTOMER_ERROR_MESSAGES[0]);
    expect(t.doc.body.textContent).not.toMatch(/429|quota|req_123/);
  });

  it('a message from the customer-safe table is shown as is', async () => {
    const msg = CUSTOMER_ERROR_MESSAGES[CUSTOMER_ERROR_MESSAGES.length - 1];
    const t = boot([{ events: [{ type: 'error', message: msg }, { type: 'done' }] }]);
    t.send('Hello');
    await t.settle();
    expect(lastAnswer(t.doc)).toBe(msg);
  });

  it('the browser copy of the table equals src/lib/chat/customer-errors.ts', () => {
    const m = MAP.match(/var SAFE_ERR=(\[[^\]]+\]);/);
    expect(m).toBeTruthy();
    expect(JSON.parse(m![1])).toEqual([...CUSTOMER_ERROR_MESSAGES]);
  });
});
