/**
 * Map Ask Mindy window: server status lines and less repetitive next steps (2026-11-22). Parity gaps with
 * the old /app chat, using the contracts Ask Mindy confirmed. Runs the REAL drawer script in jsdom.
 *
 * Before:
 * - `notice` and `progress` events were ignored, so long research showed only typing dots.
 * - /api/app/chat/suggestions got no `earlier`, so a suggested next step could ask for something the
 *   customer had already said. The old panel sends their last 6 messages.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'node:util';
import { JSDOM } from 'jsdom';

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
  const suggestionBodies: Array<Record<string, unknown>> = [];
  const pending: Promise<unknown>[] = [];
  let i = 0;
  w.fetch = vi.fn((url: string, init: { body?: string; signal?: AbortSignal }) => {
    let p: Promise<unknown>;
    if (url.startsWith('/api/app/vault/doc-access')) p = Promise.resolve({ ok: true, status: 200, json: async () => ({ uploads: false, generate: false }) });
    else if (url.startsWith('/api/app/chat/suggestions')) { suggestionBodies.push(JSON.parse(init.body || '{}')); p = Promise.resolve({ ok: true, status: 200, json: async () => ({ suggestions: [] }) }); }
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
  return { w, doc, chatBodies, suggestionBodies, settle, send };
}

const LONG = 'A long enough answer to earn suggestions, with more than eighty characters of content in it for sure.';
const notices = (doc: Document) => [...doc.querySelectorAll('[data-testid="amk-notices"] .amk-notice')].map((n) => n.textContent);

describe('Map Ask Mindy window: server status lines', () => {
  it('notice and progress events appear under the answer, as text, in order', async () => {
    const t = boot([{ events: [
      { type: 'progress', message: 'Searching federal awards…' },
      { type: 'notice', message: 'Forecast data is temporarily unavailable, so Coming soon may be incomplete.' },
      { type: 'token', content: 'Answer.' }, { type: 'done' },
    ] }]);
    t.send('Who buys drones?');
    await t.settle();
    expect(notices(t.doc)).toEqual(['Searching federal awards…', 'Forecast data is temporarily unavailable, so Coming soon may be incomplete.']);
    expect(t.doc.querySelector('[data-testid="amk-notices"]')?.getAttribute('role')).toBe('status');
  });

  it('status text is inserted as text, never HTML', async () => {
    const t = boot([{ events: [{ type: 'notice', message: '<img src=x onerror=alert(1)>' }, { type: 'token', content: 'A' }, { type: 'done' }] }]);
    t.send('q');
    await t.settle();
    expect(t.doc.querySelector('.amk-notice img')).toBeNull();
    expect(notices(t.doc)).toEqual(['<img src=x onerror=alert(1)>']);
  });

  it('a runaway stream shows at most 6 status lines; empty ones are skipped', async () => {
    const evs = Array.from({ length: 10 }, (_, i) => ({ type: 'progress', message: `step ${i}` }));
    const t = boot([{ events: [...evs, { type: 'notice', message: '  ' }, { type: 'token', content: 'A' }, { type: 'done' }] }]);
    t.send('q');
    await t.settle();
    expect(notices(t.doc)).toHaveLength(6);
  });
});

describe('Map Ask Mindy window: suggested next steps know what was already asked', () => {
  it('sends the earlier questions (not the current one) as `earlier`, most recent 6', async () => {
    const replies = Array.from({ length: 8 }, () => ({ events: [{ type: 'token', content: LONG }, { type: 'done' }] }));
    const t = boot(replies);
    for (let i = 1; i <= 8; i++) { t.send(`question ${i}`); await t.settle(); }
    expect(t.suggestionBodies[0]).toMatchObject({ message: 'question 1', earlier: [] });
    expect(t.suggestionBodies[1].earlier).toEqual(['question 1']);
    expect(t.suggestionBodies[7].message).toBe('question 8');
    expect(t.suggestionBodies[7].earlier).toEqual(['question 2', 'question 3', 'question 4', 'question 5', 'question 6', 'question 7']);
  });
});
