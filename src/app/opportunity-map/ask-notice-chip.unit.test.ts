/**
 * The selected notice rides along with the MAIN Ask Mindy chat (Eric, 2026-11-16: no separate per-card chat).
 * Runs the REAL ASK_MINDY_JS in jsdom: the chip mirrors the listing drawer's selection, only the notice id is
 * sent as context:{kind:'opportunity',notice_id}, the conversation is not forked, the chip can be removed,
 * and "Open in full workspace" hands the session + notice to MindyChatPanel via sessionStorage.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
import { JSDOM } from 'jsdom';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const NID = '6ba812a7e0284f79bc44c4932777c340';
const NID2 = 'd5a962ec18be46f9be23b66777921929';
function drawerScript(): string {
  const a = MAP.indexOf('const ASK_MINDY_JS = `<script>');
  const b = MAP.indexOf('</script>`;', a);
  return MAP.slice(a + 'const ASK_MINDY_JS = `<script>'.length, b).replace(/\\\\/g, '\\');
}

function boot() {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="amkOv"></div><div id="amk" aria-hidden="true"><div id="amkCtx"></div><button id="amkX"></button>'
    + '<div id="amkBody"></div><div class="amk-foot"><div class="amk-in"><textarea id="amkIn"></textarea><button id="amkSend"></button></div></div></div></body></html>',
    { url: 'https://getmindy.ai/opportunity-map', runScripts: 'outside-only' },
  );
  const w = dom.window as unknown as Record<string, unknown> & Window & { eval: (s: string) => unknown };
  const p = Buffer.from(JSON.stringify({ email: 'pro@example.com', exp: Date.now() + 3_600_000 })).toString('base64').replace(/=+$/, '');
  const store: Record<string, string> = { mi_beta_auth_token: `${p}.sig` };
  Object.defineProperty(w, 'localStorage', { value: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } });
  w.TextDecoder = NodeTextDecoder as never;
  w.__track = () => {};
  w.__mindyViewCtx = () => ({ count: 12, scope: 'open', state: 'VA' });
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
  const open = () => (w.openAskMindy as () => void)();
  const ask = async (q: string) => {
    (w.document.getElementById('amkIn') as HTMLTextAreaElement).value = q;
    (w.document.getElementById('amkSend') as HTMLButtonElement).click();
    await settle();
  };
  const chip = () => w.document.getElementById('amkAtt') as HTMLElement;
  const select = (o: unknown) => { w.__selectedOpp = o; (w.__onSelectedOpp as () => void)(); };
  return { w, open, ask, chip, select, chat };
}

const OPP = { id: NID, title: 'Janitorial Services, USCG Sector Key West', deadline: '2026-12-04T17:00:00Z' };

describe('selected notice attaches to the main chat', () => {
  it('shows a chip and an About header for the open listing, and sends only its id', async () => {
    const t = boot();
    t.w.__selectedOpp = OPP;
    t.open();
    expect(t.chip().className).toBe('amk-att');
    expect(t.chip().textContent).toContain('Janitorial Services, USCG Sector Key West');
    expect(t.w.document.getElementById('amkCtx')!.textContent).toBe('About: Janitorial Services, USCG Sector Key West · due 2026-12-04');
    await t.ask('Who held this before?');
    expect(t.chat[0].context).toEqual({ kind: 'opportunity', notice_id: NID });
    expect(t.chat[0].turn_id).toBeUndefined();
    const m = String(t.chat[0].message);
    expect(m).toContain('[Current map view'); // kept exactly as without a notice (server contract)
    expect(m).not.toContain('Display:');
    expect(t.chat[0].display).toBe('narrow_panel');
    expect(m.endsWith('Who held this before?')).toBe(true);
    expect(JSON.stringify(t.chat[0])).not.toContain('Key West'); // the title is never sent; the server loads the record
  });
  it('is the SAME conversation: session and history carry across attach and remove', async () => {
    const t = boot();
    t.open();
    await t.ask('q1');
    expect(t.chat[0].context).toBeUndefined();
    t.select(OPP);
    await t.ask('q2');
    expect(t.chat[1].sessionId).toBe('sess-1');
    expect((t.chat[1].history as unknown[]).length).toBe(2);
    expect(t.chat[1].context).toEqual({ kind: 'opportunity', notice_id: NID });
  });
  it('the × removes it: the next question goes without context', async () => {
    const t = boot();
    t.w.__selectedOpp = OPP;
    t.open();
    (t.chip().querySelector('button') as HTMLButtonElement).click();
    expect(t.chip().textContent).toBe('');
    expect(t.w.document.getElementById('amkCtx')!.textContent).toContain('in view');
    await t.ask('q');
    expect(t.chat[0].context).toBeUndefined();
    expect(String(t.chat[0].message)).toContain('[Current map view');
    t.open(); // reopening with the same selection keeps it removed
    expect(t.chip().textContent).toBe('');
    t.select({ ...OPP, id: NID2, title: 'Other' }); // a different notice attaches
    expect(t.chip().textContent).toContain('Other');
  });
  it('no chip without a selection, for a non-SAM id, or after the listing closes', () => {
    const t = boot();
    t.open();
    expect(t.chip().textContent).toBe('');
    t.select({ id: 'W912PL26Q0042', title: 'x' });
    expect(t.chip().textContent).toBe('');
    t.select(OPP);
    expect(t.chip().textContent).toContain('Key West');
    t.w.__selectedOpp = null;
    t.open();
    expect(t.chip().textContent).toBe('');
  });
  it('a title with markup is shown as text', () => {
    const t = boot();
    t.w.__selectedOpp = { ...OPP, title: '<img src=x onerror="window.__pwned=1">' };
    t.open();
    expect(t.chip().querySelector('img')).toBeNull();
    expect((t.w as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});

describe('Open in full workspace', () => {
  it('links to the Ask Mindy panel and hands over the session and attached notice (no message, no auto-send)', async () => {
    const t = boot();
    t.w.__selectedOpp = OPP;
    t.open();
    await t.ask('q1');
    const a = t.w.document.getElementById('amkWs') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/app?panel=chat');
    a.addEventListener('click', (e) => e.preventDefault()); // jsdom: don't navigate
    a.click();
    const h = JSON.parse(t.w.sessionStorage.getItem('mindy_chat_handoff')!);
    expect(h).toEqual({ v: 1, sessionId: 'sess-1', context: { kind: 'opportunity', notice_id: NID, title: OPP.title, deadline: OPP.deadline } });
    expect(t.w.sessionStorage.getItem('mindy_chat_seed')).toBeNull();
  });
  it('without a notice it carries just the session', async () => {
    const t = boot();
    t.open();
    await t.ask('q1');
    const a = t.w.document.getElementById('amkWs') as HTMLAnchorElement;
    a.addEventListener('click', (e) => e.preventDefault());
    a.click();
    expect(JSON.parse(t.w.sessionStorage.getItem('mindy_chat_handoff')!)).toEqual({ v: 1, sessionId: 'sess-1', context: null });
  });
});

describe('the listing drawer publishes the selection', () => {
  it('sets window.__selectedOpp for SAM notices (no flag) and clears it on close', () => {
    expect(MAP).toMatch(/window\.__selectedOpp=\/\^\[0-9a-f\]\{32\}\$\/\.test/);
    expect(MAP).toMatch(/function close\(\)\{[^}]*window\.__selectedOpp=null;/);
  });
});
