/**
 * Map "Ask Mindy" drawer: answers are RENDERED (safe markdown), long URLs wrap, and follow-up chips are
 * derived and shown only under the latest answer (2026-11-15: raw **, ###, - and [text](url) showed
 * literally; the same 4 chips repeated under every answer). Runs the REAL ASK_MINDY_JS in jsdom with the
 * real browser copy of the renderer (SAFE_MARKDOWN_SCRIPT).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
import { JSDOM } from 'jsdom';
import { SAFE_MARKDOWN_SCRIPT } from '@/lib/chat/safe-markdown';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
function drawerScript(): string {
  const a = MAP.indexOf('const ASK_MINDY_JS = `<script>');
  const b = MAP.indexOf('</script>`;', a);
  return MAP.slice(a + 'const ASK_MINDY_JS = `<script>'.length, b).replace(/\\\\/g, '\\');
}

type Opts = { tokens?: string[][]; suggestions?: Array<string[] | 'fail'>; withRenderer?: boolean };
function boot(o: Opts = {}) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="amkOv"></div><div id="amk" aria-hidden="true"><div id="amkCtx"></div><button id="amkX"></button>'
    + '<div id="amkBody"></div><textarea id="amkIn"></textarea><button id="amkSend"></button></div></body></html>',
    { url: 'https://getmindy.ai/opportunity-map', runScripts: 'outside-only' },
  );
  const w = dom.window as unknown as Record<string, unknown> & Window & { eval: (s: string) => unknown };
  const p = Buffer.from(JSON.stringify({ email: 'pro@example.com', exp: Date.now() + 3_600_000 })).toString('base64').replace(/=+$/, '');
  const store: Record<string, string> = { mi_beta_auth_token: `${p}.sig` };
  Object.defineProperty(w, 'localStorage', { value: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } });
  w.TextDecoder = NodeTextDecoder as never;
  w.__track = () => {};
  w.__mindyViewCtx = () => ({ count: 12, scope: 'open', state: 'VA', viewStates: [{ state: 'VA', pins: 12 }] });
  const tokens = [...(o.tokens ?? [])];
  const sugg = [...(o.suggestions ?? [])];
  const chat: Array<Record<string, unknown>> = [];
  const suggestionCalls: Array<Record<string, unknown>> = [];
  const pending: Promise<unknown>[] = [];
  const enc = new NodeTextEncoder();
  w.fetch = vi.fn((u: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    let pr: Promise<unknown>;
    if (u === '/api/app/chat/suggestions') {
      suggestionCalls.push(body);
      const s = sugg.shift() ?? [];
      pr = Promise.resolve(s === 'fail' ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ suggestions: s }) });
    } else {
      chat.push(body);
      const t = tokens.shift() ?? ['ok'];
      const text = [...t.map((c) => ({ type: 'token', content: c })), { type: 'done' }].map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
      pr = Promise.resolve({ status: 200, ok: true, body: new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close(); } }), json: async () => ({}) });
    }
    pending.push(pr);
    return pr;
  }) as never;
  if (o.withRenderer !== false) w.eval(SAFE_MARKDOWN_SCRIPT.replace(/^<script>/, '').replace(/<\/script>$/, ''));
  w.eval(drawerScript());
  const settle = async () => { for (let i = 0; i < 10; i++) { await Promise.all(pending); await new Promise((r) => setTimeout(r, 0)); } };
  const ask = async (q: string) => {
    (w.openAskMindy as () => void)();
    (w.document.getElementById('amkIn') as HTMLTextAreaElement).value = q;
    (w.document.getElementById('amkSend') as HTMLButtonElement).click();
    await settle();
  };
  const bubbles = () => Array.from(w.document.querySelectorAll('.amk-msg.a .bub')) as HTMLElement[];
  const chipRows = () => Array.from(w.document.querySelectorAll('.amk-act.amk-fu')) as HTMLElement[];
  return { w, ask, bubbles, chipRows, chat, suggestionCalls };
}

const ANSWER = ['### Open opportunities\n\nHere are **two** janitorial solicitations:\n\n', '- **USCG Sector Key West** — due Nov 20\n- Recruiting Station\n\n', '[View the solicitation on SAM.gov](https://sam.gov/workspace/contract/opp/4b6c32fbb0b146d29d4315cc8c49a4e9/view)'];

describe('answers are rendered, not shown as raw markdown', () => {
  it('headings, bold, bullets and links render; no raw markdown characters remain', async () => {
    const t = boot({ tokens: [ANSWER] });
    await t.ask('What janitorial work is open here?');
    const bub = t.bubbles().at(-1)!;
    expect(bub.classList.contains('md')).toBe(true);
    expect(bub.querySelector('.md-h3')!.textContent).toBe('Open opportunities');
    expect(bub.querySelector('strong')!.textContent).toBe('two');
    expect(bub.querySelectorAll('ul li')).toHaveLength(2);
    const a = bub.querySelector('a')!;
    expect(a.textContent).toBe('View the solicitation on SAM.gov');
    expect(a.getAttribute('href')).toBe('https://sam.gov/workspace/contract/opp/4b6c32fbb0b146d29d4315cc8c49a4e9/view');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(bub.textContent).not.toMatch(/\*\*|###|\]\(|^- /m);
  });
  it('model text with markup or a javascript: link cannot inject anything into the page', async () => {
    const t = boot({ tokens: [['<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script> ', '[click](javascript:window.__pwned=3) ', '[x](https://ok.gov/" onmouseover="window.__pwned=4)']] });
    await t.ask('test');
    const bub = t.bubbles().at(-1)!;
    expect(bub.querySelector('img, script, iframe, svg')).toBeNull();
    for (const el of Array.from(bub.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name).not.toMatch(/^on/i);
        if (attr.name === 'href') expect(attr.value).toMatch(/^https?:\/\//);
      }
    }
    expect((t.w as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(bub.textContent).toContain('<script>'); // shown as text, harmlessly
  });
  it('without the renderer script the answer is plain text, never HTML', async () => {
    const t = boot({ tokens: [['**hi** <b>x</b>']], withRenderer: false });
    await t.ask('test');
    const bub = t.bubbles().at(-1)!;
    expect(bub.classList.contains('md')).toBe(false);
    expect(bub.textContent).toBe('**hi** <b>x</b>');
    expect(bub.querySelector('b, strong')).toBeNull();
  });
  it('the page ships the renderer before the drawer, and bubbles/links wrap long URLs', () => {
    expect(MAP).toMatch(/SAFE_MARKDOWN_SCRIPT \+ ASK_MINDY_JS/);
    expect(MAP).toMatch(/\.amk-msg\.a \.bub\{[^}]*overflow-wrap:anywhere;word-break:break-word/);
    expect(MAP).toMatch(/\.amk-msg\.a \.bub a,\.amk-src a\{[^}]*overflow-wrap:anywhere/);
  });
});

describe('follow-up chips: derived, and only under the latest answer', () => {
  it('chips come from the suggestions endpoint for THIS question + answer, and are not the old fixed four', async () => {
    const t = boot({ tokens: [ANSWER], suggestions: [['Who held the Key West contract before?', 'Show set-asides for these two']] });
    await t.ask('What janitorial work is open here?');
    expect(t.suggestionCalls).toHaveLength(1);
    expect(t.suggestionCalls[0]).toMatchObject({ email: 'pro@example.com', message: 'What janitorial work is open here?' });
    expect(String(t.suggestionCalls[0].answer)).toContain('USCG Sector Key West');
    const rows = t.chipRows();
    expect(rows).toHaveLength(1);
    expect(Array.from(rows[0].querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Who held the Key West contract before?', 'Show set-asides for these two']);
    expect(rows[0].textContent).not.toMatch(/Who are the contacts\?|Set-aside breakdown|Write a capability statement|Add to my pipeline/);
  });
  it('a second answer removes the first answer’s chips; only the latest answer has chips', async () => {
    // Answers must clear the outcome floor (≥80 chars) or follow-ups stay off.
    const a1 = 'First answer with enough substance that follow-up chips are allowed after this outcome. ';
    const a2 = 'Second answer with enough substance that follow-up chips are allowed after this outcome.';
    const t = boot({ tokens: [[a1], [a2]], suggestions: [['A1', 'A2'], ['B1']] });
    await t.ask('q1');
    await t.ask('q2');
    const rows = t.chipRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe('B1');
    expect(rows[0].closest('.amk-msg')).toBe(t.bubbles().at(-1)!.closest('.amk-msg'));
  });
  it('no chips when the endpoint fails or returns none', async () => {
    const long = 'A finished answer long enough that follow-ups would fire if suggestions returned. ';
    const a = boot({ tokens: [[long]], suggestions: ['fail'] });
    await a.ask('q');
    expect(a.chipRows()).toHaveLength(0);
    const b = boot({ tokens: [[long]], suggestions: [[]] });
    await b.ask('q');
    expect(b.chipRows()).toHaveLength(0);
  });
  it('clicking a chip asks it and clears the chips', async () => {
    const long = 'First answer with enough substance that follow-up chips are allowed after this outcome. ';
    const t = boot({ tokens: [[long], ['second']], suggestions: [['Follow up please'], []] });
    await t.ask('q1');
    (t.chipRows()[0].querySelector('button') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(String(t.chat.at(-1)!.message)).toContain('Follow up please');
  });
  it('short status answers do not generate follow-up chips', async () => {
    const t = boot({ tokens: [['Working…']], suggestions: [['Should not appear']] });
    await t.ask('q');
    expect(t.suggestionCalls).toHaveLength(0);
    expect(t.chipRows()).toHaveLength(0);
  });
});

describe('narrow-panel display (answer first)', () => {
  it('every question says display:narrow_panel; the message is the customer words only (no map preamble)', async () => {
    const t = boot({ tokens: [['a'], ['b']] });
    await t.ask('What janitorial work is open here?');
    await t.ask('And in Florida?');
    expect(t.chat.map((c) => c.display)).toEqual(['narrow_panel', 'narrow_panel']);
    for (const c of t.chat) {
      const m = String(c.message);
      expect(m).not.toMatch(/Display:|narrow side panel/i);
      expect(m).not.toContain('[Current map view');
    }
    expect(String(t.chat[0].message)).toBe('What janitorial work is open here?');
    expect(String(t.chat[1].message)).toBe('And in Florida?');
  });
  it('history and the user bubble hold only what the user typed', async () => {
    const t = boot({ tokens: [['a'], ['b']] });
    await t.ask('q1');
    await t.ask('q2');
    const hist = t.chat[1].history as Array<{ role: string; content: string }>;
    expect(hist[0]).toEqual({ role: 'user', content: 'q1' });
    expect(t.w.document.querySelector('.amk-msg.u')!.textContent).toBe('q1');
  });
  it('the opening paragraph is styled as the answer', () => {
    expect(MAP).toMatch(/\.amk-msg\.a \.bub\.md>p:first-child\{font-weight:500/);
  });
});
