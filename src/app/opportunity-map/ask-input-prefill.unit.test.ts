/**
 * D7 (Agent 4 live scorecard, 2026-11-16): opening Ask Mindy put the map's search term INTO the question box,
 * so a customer who clicked in and typed sent the two glued together ("hvac servicesFind HVAC opportunities\u2026").
 * Runs the REAL ASK_MINDY_JS in jsdom and pins the exact string sent: the question in the message is exactly
 * what is in the box — the view term is shown as a hint (placeholder) and reaches the answer through the
 * grounded view preamble, never as typed text.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
import { JSDOM } from 'jsdom';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
function drawerScript(): string {
  const a = MAP.indexOf('const ASK_MINDY_JS = `<script>');
  const b = MAP.indexOf('</script>`;', a);
  return MAP.slice(a + 'const ASK_MINDY_JS = `<script>'.length, b).replace(/\\\\/g, '\\');
}

function boot(view: Record<string, unknown>) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="amkOv"></div><div id="amk" aria-hidden="true"><div id="amkCtx"></div><button id="amkX"></button>'
    + '<div id="amkBody"></div><div class="amk-foot"><div class="amk-in"><textarea id="amkIn" placeholder="Ask Mindy\u2026"></textarea><button id="amkSend"></button></div></div></div></body></html>',
    { url: 'https://getmindy.ai/opportunity-map', runScripts: 'outside-only' },
  );
  const w = dom.window as unknown as Record<string, unknown> & Window & { eval: (s: string) => unknown };
  const p = Buffer.from(JSON.stringify({ email: 'pro@example.com', exp: Date.now() + 3_600_000 })).toString('base64').replace(/=+$/, '');
  const store: Record<string, string> = { mi_beta_auth_token: `${p}.sig` };
  Object.defineProperty(w, 'localStorage', { value: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } });
  w.TextDecoder = NodeTextDecoder as never;
  w.__track = () => {};
  w.__mindyViewCtx = () => view;
  const chat: Array<Record<string, unknown>> = [];
  const pending: Promise<unknown>[] = [];
  const enc = new NodeTextEncoder();
  w.fetch = vi.fn((u: string, init: { body: string }) => {
    let pr: Promise<unknown>;
    if (u === '/api/app/chat/suggestions') pr = Promise.resolve({ ok: true, status: 200, json: async () => ({ suggestions: [] }) });
    else {
      chat.push(JSON.parse(init.body));
      const text = [{ type: 'session', sessionId: 'sess-1' }, { type: 'token', content: 'ok' }, { type: 'done' }].map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
      pr = Promise.resolve({ status: 200, ok: true, body: new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close(); } }), json: async () => ({}) });
    }
    pending.push(pr);
    return pr;
  }) as never;
  w.eval(drawerScript());
  const settle = async () => { for (let i = 0; i < 10; i++) { await Promise.all(pending); await new Promise((r) => setTimeout(r, 0)); } };
  const box = () => w.document.getElementById('amkIn') as HTMLTextAreaElement;
  // A customer clicks into the box and types: keystrokes land AFTER whatever is already there.
  const typeAndSend = async (typed: string) => {
    box().value = box().value + typed;
    (w.document.getElementById('amkSend') as HTMLButtonElement).click();
    await settle();
  };
  return { w, box, typeAndSend, chat };
}

const VIEW = { count: 42, scope: 'open', state: 'TX', q: 'hvac services' };
const TYPED = 'Find HVAC opportunities in Texas that close in the next 30 days';

/** The question part of the message: everything after the grounded view preamble. */
function question(message: unknown): string {
  const m = String(message);
  const i = m.indexOf(']\n\n');
  return i >= 0 && m.startsWith('[Current map view') ? m.slice(i + 3) : m;
}

describe('Ask Mindy sends exactly what is in the box (D7)', () => {
  it('opening from the map with a search term does not put the term into the box', async () => {
    const t = boot(VIEW);
    (t.w.openAskMindy as (s?: string) => void)();
    expect(t.box().value).toBe('');
    // Placeholder may hint the map search term; it is NOT injected into the message (2026-11-19).
    expect(t.box().placeholder).toBe('Ask about \u201chvac services\u201d\u2026');
    await t.typeAndSend(TYPED);
    expect(question(t.chat[0].message)).toBe(TYPED);
    expect(String(t.chat[0].message)).toBe(TYPED);
    expect(String(t.chat[0].message)).not.toContain('hvac servicesFind');
    expect(String(t.chat[0].message)).not.toContain('[Current map view');
    // The bubble shows the same words that were sent.
    const bubbles = t.w.document.querySelectorAll('.amk-msg.u');
    expect(bubbles[bubbles.length - 1].textContent).toBe(TYPED);
  });
  it('an explicit question from the search bar is sent exactly as shown', async () => {
    const t = boot(VIEW);
    (t.w.openAskMindy as (s?: string) => void)('who buys roofing in Texas?');
    expect(t.box().value).toBe('who buys roofing in Texas?');
    await t.typeAndSend('');
    expect(question(t.chat[0].message)).toBe('who buys roofing in Texas?');
  });
  it('a later open without a seed clears text the opener put there', async () => {
    const t = boot(VIEW);
    const open = t.w.openAskMindy as (s?: string) => void;
    open('who buys roofing in Texas?');
    expect(t.box().value).toBe('who buys roofing in Texas?');
    open();
    expect(t.box().value).toBe('');
    await t.typeAndSend(TYPED);
    expect(question(t.chat[0].message)).toBe(TYPED);
  });
  it('a later open without a seed keeps a draft the customer typed', async () => {
    const t = boot(VIEW);
    const open = t.w.openAskMindy as (s?: string) => void;
    open();
    t.box().value = 'Which of these are set aside for';
    open();
    expect(t.box().value).toBe('Which of these are set aside for');
    // An opener seed the customer then edited is their draft too.
    open('who buys roofing');
    t.box().value = 'who buys roofing in Florida';
    open();
    expect(t.box().value).toBe('who buys roofing in Florida');
    await t.typeAndSend('?');
    expect(question(t.chat[0].message)).toBe('who buys roofing in Florida?');
  });
  it('without a search term the default hint is kept', () => {
    const t = boot({ count: 42, scope: 'open', state: 'TX' });
    (t.w.openAskMindy as (s?: string) => void)();
    expect(t.box().value).toBe('');
    expect(t.box().placeholder).toBe('Ask Mindy\u2026');
  });
  it('the greeting has no how-to chip dressed as an action', () => {
    const t = boot(VIEW);
    (t.w.openAskMindy as (s?: string) => void)();
    const labels = Array.from(t.w.document.querySelectorAll('.amk-chips button')).map((b) => b.textContent);
    expect(labels).not.toContain('Add a target to my pipeline');
    expect(labels.length).toBeGreaterThan(0);
  });
});
