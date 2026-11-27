/**
 * Map Ask Mindy window, research mode (Mindy Day 11/28) — the REAL drawer script in jsdom.
 * A research turn can run for minutes with dozens of tool calls. 'progress' events are STEPS in one calm panel
 * (timer, current step, count, Show steps, "still working" after 20 s of quiet) — before this they were amber
 * warning boxes capped at 6, so a long run froze after six tools. The answer collapses the panel to a summary;
 * every other end of the turn (Stop, error) collapses it too and stops its timer.
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

function boot() {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="amkOv"></div><aside id="amk" aria-hidden="true"><div class="amk-hd"><div id="amkCtx"></div><button id="amkX"></button></div>'
    + '<div id="amkBody"></div><div class="amk-foot"><div class="amk-in"><textarea id="amkIn"></textarea><button id="amkSend"></button></div></div></aside></body></html>',
    { url: 'https://getmindy.ai/opportunity-map', runScripts: 'outside-only' },
  );
  const w = dom.window as unknown as Record<string, unknown> & Window & { eval: (s: string) => unknown; Date: DateConstructor };
  const store: Record<string, string> = { mi_beta_auth_token: token('pro@example.com') };
  Object.defineProperty(w, 'localStorage', { value: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } });
  w.TextDecoder = NodeTextDecoder as never;
  w.__mindyViewCtx = () => ({ count: 3, scope: 'all' });
  let clock = 5_000_000;
  w.Date.now = () => clock;
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
  const enc = new NodeTextEncoder();
  w.fetch = vi.fn((url: string, init: { signal?: AbortSignal }) => {
    if (url.startsWith('/api/app/chat/suggestions') || url.startsWith('/api/app/vault/') || url.startsWith('/api/app/chat/capabilities')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ suggestions: [], uploads: false, screenshots: false }) });
    }
    const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; init.signal?.addEventListener('abort', () => c.error(new Error('AbortError'))); } });
    return Promise.resolve({ ok: true, status: 200, body: stream, json: async () => ({}) });
  }) as never;
  w.eval(drawerScript());
  const doc = w.document;
  const tick = () => new Promise((r) => setTimeout(r, 15));
  const push = async (e: Record<string, unknown>) => { ctrl!.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); await tick(); await tick(); };
  const end = async () => { ctrl!.close(); await tick(); await tick(); };
  const send = async (q: string) => { (doc.getElementById('amkIn') as HTMLTextAreaElement).value = q; (doc.getElementById('amkSend') as HTMLButtonElement).click(); await tick(); };
  (w as unknown as { openAskMindy: () => void }).openAskMindy();
  const q = (id: string) => doc.querySelector(`[data-testid="${id}"]`);
  return { w, doc, push, end, send, q, advance: (ms: number) => { clock += ms; } };
}

describe('Map Ask Mindy window: research progress', () => {
  it('a long run shows every step in one panel (no 6-line freeze), de-duplicated; the answer collapses it', async () => {
    const t = boot();
    await t.send('Assess Ridgeline Digital for Navy marketing work');
    for (let i = 0; i < 9; i++) await t.push({ type: 'progress', message: `Checking source ${i}.` });
    await t.push({ type: 'progress', message: 'Checking source 8.' });
    expect(t.q('amk-research')).not.toBeNull();
    expect(t.doc.querySelector('.amk-rp-cur')!.textContent).toBe('Checking source 8.');
    expect(t.doc.querySelector('.amk-rp-n')!.textContent).toBe(' · 10 steps');
    expect(t.q('amk-notices')).toBeNull(); // not warnings
    expect((t.doc.querySelector('.amk-msg.a .bub') as HTMLElement).style.display).toBe('none'); // no typing dots under the panel

    (t.q('amk-research-toggle') as HTMLButtonElement).click();
    const items = [...t.doc.querySelectorAll('.amk-rp-steps li')].map((li) => li.textContent);
    expect(items).toHaveLength(9);
    expect(items[8]).toBe('Checking source 8. ×2');

    t.advance(222_000);
    await t.push({ type: 'token', content: 'Start with the Navy recruiting campaign.' });
    await t.push({ type: 'done' });
    await t.end();
    expect(t.q('amk-research')).toBeNull();
    expect(t.q('amk-research-summary')!.querySelector('.amk-rp-hd')!.textContent).toBe('Researched · 10 steps · 3:42');
    expect(t.doc.querySelector('.amk-msg.a .bub')!.textContent).toContain('Navy recruiting campaign');
    expect((t.doc.querySelector('.amk-msg.a .bub') as HTMLElement).style.display).toBe('');
  });

  it('a phase line is the headline, not a step; step text is inserted as text', async () => {
    const t = boot();
    await t.send('q');
    await t.push({ type: 'progress', message: '<img src=x onerror=alert(1)>' });
    await t.push({ type: 'progress', message: 'Checking every figure against the sources.', phase: 'checking' });
    expect(t.doc.querySelector('.amk-rp-cur')!.textContent).toBe('Checking every figure against the sources.');
    expect(t.doc.querySelector('.amk-rp-n')!.textContent).toBe(' · 1 step');
    expect(t.doc.querySelector('.amk-rp img')).toBeNull();
  });

  it('after 20 s of quiet it says it is still working, and the timer moves', async () => {
    const t = boot();
    await t.send('q');
    await t.push({ type: 'progress', message: 'Checking awards.' });
    expect((t.doc.querySelector('.amk-rp-still') as HTMLElement).hidden).toBe(true);
    t.advance(25_000);
    await new Promise((r) => setTimeout(r, 1100));
    expect((t.doc.querySelector('.amk-rp-still') as HTMLElement).hidden).toBe(false);
    expect(t.doc.querySelector('.amk-rp-time')!.textContent).toBe('0:25');
  });

  it('Stop collapses the panel and frees the input', async () => {
    const t = boot();
    await t.send('q');
    await t.push({ type: 'progress', message: 'Checking awards.' });
    (t.q('amk-stop') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 30));
    expect(t.q('amk-research')).toBeNull();
    expect(t.q('amk-research-summary')).not.toBeNull();
    expect((t.doc.getElementById('amkSend') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a research answer table fits the drawer: long cells wrap, short values stay on one line, 3+ columns drop the first-column minimum', async () => {
    const t = boot();
    (t.w as unknown as { __mindyMd: (s: string) => string }).__mindyMd = (s: string) => s; // the answer below is already HTML
    await t.send('q');
    await t.push({ type: 'token', content: '<table><tr><td>SAM registration</td><td>Active, expires 2027-03-14 (all awards)</td><td>SAM record</td></tr></table><table><tr><td>Acme</td><td>$1.2M</td></tr></table>' });
    await t.push({ type: 'done' });
    await t.end();
    const [wide, narrow] = [...t.doc.querySelectorAll('.amk-msg.a .bub table')];
    expect(wide.className).toBe('md-cols3');
    expect([...wide.querySelectorAll('td')].map((td) => td.className)).toEqual(['', 'md-wrap', '']);
    expect(narrow.className).toBe('');
    expect([...narrow.querySelectorAll('td')].map((td) => td.className)).toEqual(['', '']);
  });

  it('collapsing closes an open steps list so the answer is not pushed down', async () => {
    const t = boot();
    await t.send('q');
    await t.push({ type: 'progress', message: 'Checking awards.' });
    (t.q('amk-research-toggle') as HTMLButtonElement).click();
    expect((t.doc.querySelector('.amk-rp-steps') as HTMLElement).hidden).toBe(false);
    await t.push({ type: 'token', content: 'Answer.' });
    expect((t.doc.querySelector('.amk-rp-steps') as HTMLElement).hidden).toBe(true);
    expect(t.q('amk-research-toggle')!.textContent).toBe('Show steps');
  });

  it('a research-beta turn shows its tag on the progress line and above the answer', async () => {
    const t = boot();
    await t.send('Assess Ridgeline');
    await t.push({ type: 'mode', mode: 'research', beta: true, label: 'Research · Beta' });
    await t.push({ type: 'progress', message: 'Checking awards.' });
    expect(t.q('amk-research-tag')!.textContent).toBe('Research · Beta');
    expect(t.q('amk-beta-tag')!.textContent).toBe('Research · Beta');
    await t.push({ type: 'token', content: 'Answer.' });
    await t.push({ type: 'done' });
    await t.end();
    expect(t.doc.querySelectorAll('[data-testid="amk-beta-tag"]').length).toBe(1);
  });

  it('a progress line without a mode event has no tag', async () => {
    const t = boot();
    await t.send('q');
    await t.push({ type: 'progress', message: 'Checking awards.' });
    expect(t.q('amk-research-tag')).toBeNull();
    expect(t.q('amk-beta-tag')).toBeNull();
  });
});

