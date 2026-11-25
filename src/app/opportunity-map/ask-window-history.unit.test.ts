/**
 * Map Ask Mindy window: conversation continuity, history and New chat (2026-11-22). These are the top two
 * parity gaps with the old /app chat. Runs the REAL drawer script (ASK_MINDY_JS) in jsdom.
 *
 * Contract (confirmed with Ask Mindy):
 * - reuse /api/app/chat-sessions (list, &sessionId=, DELETE) and send sessionId;
 * - the server does not rebuild context, so the client re-sends history;
 * - reopened sessions carry deliverables but no source ledger, so their history goes without sources.
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
const SID = '11111111-1111-4111-8111-111111111111';
const SID2 = '22222222-2222-4222-8222-222222222222';
const DOC = '33333333-3333-4333-8333-333333333333';
const LEDGER = { v: 1, entries: [{ id: 'src:x' }], sig: 's' };
const REPORT_ID = 'Ej6xTestReportId0000a';
const HOSTED_HTML = '<!doctype html><html><head><title>R</title></head><body><button class="pdfbtn">Save as PDF</button><p>HOSTED REPORT BODY</p></body></html>';

type Store = Record<string, string>;
type Sessions = { list?: { status: number; json?: unknown }; one?: { status: number; json?: unknown }; del?: { status: number } };

function boot(opts: { session?: Store; local?: Store; chat?: Array<Array<Record<string, unknown>>>; sessions?: Sessions; hosted?: { status: number; html?: string } | 'network-error' } = {}) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="amkOv"></div><aside id="amk" aria-hidden="true"><div class="amk-hd"><div id="amkCtx"></div><button id="amkX"></button></div>'
    + '<div id="amkBody"></div><div class="amk-foot"><div class="amk-in"><textarea id="amkIn"></textarea><button id="amkSend"></button></div></div></aside></body></html>',
    { url: 'https://getmindy.ai/opportunity-map', runScripts: 'outside-only' },
  );
  const w = dom.window as unknown as Record<string, unknown> & Window & { eval: (s: string) => unknown };
  const local: Store = opts.local ?? { mi_beta_auth_token: token('pro@example.com') };
  const session: Store = opts.session ?? {};
  const fake = (st: Store) => ({ getItem: (k: string) => st[k] ?? null, setItem: (k: string, v: string) => { st[k] = v; }, removeItem: (k: string) => { delete st[k]; } });
  Object.defineProperty(w, 'localStorage', { value: fake(local) });
  Object.defineProperty(w, 'sessionStorage', { value: fake(session) });
  w.TextDecoder = NodeTextDecoder as never;
  w.__mindyViewCtx = () => ({ count: 3, scope: 'all' });
  const chatBodies: Array<Record<string, unknown>> = [];
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const pending: Promise<unknown>[] = [];
  let i = 0;
  w.fetch = vi.fn((url: string, init: { body?: string; method?: string } = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body });
    let p: Promise<unknown>;
    const js = (status: number, json: unknown = {}) => Promise.resolve({ ok: status < 300, status, json: async () => json });
    if (url.startsWith('/api/app/connected-apps')) p = js(404, { error: 'not_enabled' });
    else if (url.startsWith('/api/app/vault/')) p = js(200, { uploads: false, generate: true, success: true, title: 'R', version: 1, html: '<p>R</p>', files: [] });
    else if (url.startsWith('/api/app/chat/suggestions')) p = js(200, { suggestions: [] });
    else if (url.startsWith('/reports/')) {
      const h = opts.hosted ?? { status: 200, html: HOSTED_HTML };
      p = h === 'network-error' ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: h.status < 300, status: h.status, text: async () => h.html ?? '' });
    }
    else if (url.startsWith('/api/app/chat-sessions')) {
      const s = opts.sessions ?? {};
      if (init.method === 'DELETE') p = js(s.del?.status ?? 200, { success: true });
      else if (url.includes('sessionId=')) p = js(s.one?.status ?? 200, s.one?.json ?? {});
      else p = js(s.list?.status ?? 200, s.list?.json ?? { success: true, sessions: [] });
    } else {
      chatBodies.push(JSON.parse(init.body || '{}'));
      const evs = (opts.chat ?? [])[i++] ?? [{ type: 'token', content: 'Answer.' }, { type: 'done' }];
      const enc = new NodeTextEncoder();
      p = Promise.resolve({ ok: true, status: 200, body: new ReadableStream({ start(c) { c.enqueue(enc.encode(sse(evs))); c.close(); } }), json: async () => ({}) });
    }
    pending.push(p.catch(() => undefined));
    return p;
  }) as never;
  w.eval(drawerScript());
  const settle = async () => { for (let k = 0; k < 12; k++) { await Promise.all(pending); await new Promise((r) => setTimeout(r, 0)); } };
  const doc = w.document;
  const send = async (q: string) => { (doc.getElementById('amkIn') as HTMLTextAreaElement).value = q; (doc.getElementById('amkSend') as HTMLButtonElement).click(); await settle(); };
  const open = () => (w as unknown as { openAskMindy: () => void }).openAskMindy();
  const bubbles = () => [...doc.querySelectorAll('#amkBody .amk-msg')].map((m) => (m.classList.contains('u') ? 'U: ' : 'A: ') + (m.querySelector('.bub')?.textContent ?? m.textContent));
  const click = (sel: string) => (doc.querySelector(sel) as HTMLElement).click();
  return { w, doc, session, local, chatBodies, calls, settle, send, open, bubbles, click };
}

describe('the map conversation survives a reload in the same tab', () => {
  it('reopening the page restores the conversation, and the next question continues it', async () => {
    const a = boot({ chat: [[{ type: 'session', sessionId: SID }, { type: 'token', content: 'Navy buys most.' }, { type: 'sources', ledger: LEDGER }, { type: 'done' }]] });
    a.open();
    await a.send('Who buys drones?');
    // "Reload": a fresh page with the same sessionStorage and sign-in.
    const b = boot({ session: a.session, local: a.local });
    b.open();
    expect(b.bubbles()).toEqual(['U: Who buys drones?', 'A: Navy buys most.']);
    await b.send('And the Army?');
    expect(b.chatBodies[0].sessionId).toBe(SID);
    expect(b.chatBodies[0].history).toEqual([{ role: 'user', content: 'Who buys drones?' }, { role: 'assistant', content: 'Navy buys most.', sources: LEDGER }]);
  });

  it('another signed-in account (or workspace) never sees it', async () => {
    const a = boot();
    a.open();
    await a.send('Private question');
    const other = boot({ session: a.session, local: { mi_beta_auth_token: token('eve@example.com') } });
    other.open();
    expect(other.bubbles()).toEqual([]);
    const ws = boot({ session: a.session, local: { ...a.local, mindy_active_workspace: 'client-ws' } });
    ws.open();
    expect(ws.bubbles()).toEqual([]);
  });

  it('display-only report files ride in history for redraw, but are never sent to the server', async () => {
    const a = boot({ chat: [[{ type: 'session', sessionId: SID }, { type: 'token', content: 'Saved.' }, { type: 'deliverables', files: [{ format: 'pdf', document_id: DOC, file_name: 'R.pdf', version: 1 }] }, { type: 'done' }]] });
    a.open();
    await a.send('Write a report');
    const b = boot({ session: a.session, local: a.local });
    b.open();
    expect(b.doc.querySelector('[data-testid="amk-report-card"]')).not.toBeNull();
    await b.send('Next');
    expect(JSON.stringify(b.chatBodies[0].history)).not.toContain('files');
  });
});

describe('New chat', () => {
  it('clears the conversation; the next question starts fresh', async () => {
    const a = boot({ chat: [[{ type: 'session', sessionId: SID }, { type: 'token', content: 'One.' }, { type: 'done' }]] });
    a.open();
    await a.send('First');
    a.click('[data-testid="amk-new-chat"]');
    expect(a.bubbles()).toEqual([]);
    expect(a.doc.querySelector('[data-testid="amk-blank"]')).not.toBeNull();
    await a.send('Second');
    expect(a.chatBodies[1].sessionId).toBeUndefined();
    expect(a.chatBodies[1].history).toEqual([]);
    const reload = boot({ session: a.session, local: a.local });
    reload.open();
    expect(reload.bubbles()).toEqual(['U: Second', 'A: Answer.']);
  });
});

describe('History (GET /api/app/chat-sessions)', () => {
  const LIST = { success: true, sessions: [{ id: SID2, title: 'Drone market', message_count: 4, updated_at: '2026-11-20T10:00:00Z' }] };
  const ONE = { success: true, session: { id: SID2, title: 'Drone market' }, messages: [
    { id: 'm1', role: 'user', content: 'Drone market?' },
    { id: 'm2', role: 'assistant', content: 'Here is the report.', deliverables: { files: [{ format: 'docx', document_id: DOC, file_name: 'Drones.docx', version: 2 }] } },
  ] };

  it('lists past conversations; opening one restores it with its report card and continues it', async () => {
    const t = boot({ sessions: { list: { status: 200, json: LIST }, one: { status: 200, json: ONE } } });
    t.open();
    t.click('[data-testid="amk-history-btn"]');
    await t.settle();
    expect(t.doc.getElementById('amk')!.classList.contains('amk-hist-open')).toBe(true);
    expect(t.doc.querySelector('.amk-hist-item b')?.textContent).toBe('Drone market');
    t.click('.amk-hist-item');
    await t.settle();
    expect(t.doc.getElementById('amk')!.classList.contains('amk-hist-open')).toBe(false);
    expect(t.bubbles()).toEqual(['U: Drone market?', 'A: Here is the report.']);
    expect(t.doc.querySelector('[data-testid="amk-report-card"] b')?.textContent).toBe('Drones');
    expect(t.calls.some((c) => c.url.startsWith('/api/app/vault/documents/preview'))).toBe(false); // card only, no auto-open
    await t.send('Revise it');
    expect(t.chatBodies[0].sessionId).toBe(SID2);
    // No ledger for reopened sessions (contract): history without sources.
    expect(t.chatBodies[0].history).toEqual([{ role: 'user', content: 'Drone market?' }, { role: 'assistant', content: 'Here is the report.' }]);
  });

  it('delete removes the row (DELETE with email + sessionId); deleting the open one clears it', async () => {
    const t = boot({ sessions: { list: { status: 200, json: LIST }, one: { status: 200, json: ONE } } });
    t.open();
    t.click('[data-testid="amk-history-btn"]'); await t.settle();
    t.click('.amk-hist-item'); await t.settle();
    t.click('[data-testid="amk-history-btn"]'); await t.settle();
    t.click('.amk-hist-del'); await t.settle();
    const del = t.calls.find((c) => c.method === 'DELETE')!;
    expect(JSON.parse(del.body!)).toEqual({ email: 'pro@example.com', sessionId: SID2 });
    expect(t.doc.querySelector('.amk-hist-row')).toBeNull();
    expect(t.doc.querySelector('.amk-hist-msg')?.textContent).toBe('No saved conversations yet.');
    t.click('.amk-hist-x');
    expect(t.bubbles()).toEqual([]);
  });

  it('a failed delete says so on the row and keeps it', async () => {
    const t = boot({ sessions: { list: { status: 200, json: LIST }, del: { status: 500 } } });
    t.open();
    t.click('[data-testid="amk-history-btn"]'); await t.settle();
    t.click('.amk-hist-del'); await t.settle();
    expect(t.doc.querySelector('.amk-hist-row')).not.toBeNull();
    expect(t.doc.querySelector('.amk-hist-err')?.textContent).toMatch(/Couldn't delete/);
  });

  it('free accounts, sign-in and errors get plain messages (errors offer Try again)', async () => {
    const pro = boot({ sessions: { list: { status: 403 } } });
    pro.open(); pro.click('[data-testid="amk-history-btn"]'); await pro.settle();
    expect(pro.doc.querySelector('.amk-hist-msg')?.textContent).toBe('Saved conversations are part of Mindy Pro.');
    const err = boot({ sessions: { list: { status: 500 } } });
    err.open(); err.click('[data-testid="amk-history-btn"]'); await err.settle();
    expect(err.doc.querySelector('.amk-hist-msg')?.textContent).toMatch(/Couldn't load your conversations/);
    expect(err.doc.querySelector('.amk-hist-retry')).not.toBeNull();
    const out = boot({ local: {} });
    out.open(); out.click('[data-testid="amk-history-btn"]'); await out.settle();
    expect(out.doc.querySelector('.amk-hist-msg')?.textContent).toBe('Sign in to see your conversations.');
  });

  it('titles are inserted as text', async () => {
    const t = boot({ sessions: { list: { status: 200, json: { success: true, sessions: [{ id: SID2, title: '<img src=x onerror=alert(1)>', updated_at: null }] } } } });
    t.open(); t.click('[data-testid="amk-history-btn"]'); await t.settle();
    expect(t.doc.querySelector('.amk-hist img')).toBeNull();
  });
});

describe('opportunity (card) chat', () => {
  it('History and New chat are map-view tools, hidden in card chat', () => {
    expect(MAP).toContain('.amk-card .amk-hd-tools{display:none}');
  });
});

describe('a packaged market report comes back with its conversation (Claude Local, 2026-11-22)', () => {
  // Before: reopening a saved conversation (History) or reloading showed the answer text only. The market
  // report's card, preview and Export menu were gone, so the PDF download could not be reached.
  const pane = (doc: Document) => doc.querySelector('[data-testid="amk-report-pane"]') as HTMLElement | null;
  const pdfItem = (doc: Document) => doc.querySelector('.amk-exp-panel [data-fmt="pdf"]') as HTMLButtonElement | null;
  const ONE = { success: true, session: { id: SID2, title: 'Facilities' }, messages: [
    { id: 'm1', role: 'user', content: 'Market report for facilities maintenance' },
    { id: 'm2', role: 'assistant', content: 'Here is your report.', market_report: { report_id: REPORT_ID, title: 'Facilities maintenance' } },
  ] };
  const reopen = async (t: ReturnType<typeof boot>) => {
    t.open();
    t.click('[data-testid="amk-history-btn"]');
    await t.settle();
    t.click('.amk-hist-item');
    await t.settle();
  };
  const LIST = { success: true, sessions: [{ id: SID2, title: 'Facilities', message_count: 2, updated_at: '2026-11-22T10:00:00Z' }] };

  it('History: the report card is back; Open loads the hosted report into the pane with Export → Download PDF', async () => {
    const t = boot({ sessions: { list: { status: 200, json: LIST }, one: { status: 200, json: ONE } } });
    await reopen(t);
    const card = t.doc.querySelector('[data-testid="amk-report-card"]');
    expect(card?.querySelector('b')?.textContent).toBe('Facilities maintenance');
    expect(card?.querySelector('.amk-repcard-open')?.textContent).toBe('Open market report'); // same label as the live card
    const chat = t.doc.getElementById('amkBody') as HTMLElement;
    expect(chat.scrollTop).toBe(chat.scrollHeight); // the reopened conversation shows its end, with the card
    expect(t.calls.some((c) => c.url.startsWith('/reports/'))).toBe(false); // card only, no auto-load
    t.click('[data-testid="amk-report-card"] .amk-repcard-open');
    await t.settle();
    expect(t.calls.filter((c) => c.url.startsWith('/reports/')).map((c) => c.url)).toEqual([`/reports/${REPORT_ID}`]);
    expect(pane(t.doc)?.classList.contains('show')).toBe(true);
    const f = t.doc.querySelector('.amk-rep-f') as HTMLIFrameElement;
    expect(f.srcdoc).toContain('HOSTED REPORT BODY');
    expect(f.srcdoc).toContain('.pdfbtn{display:none!important}');
    expect(pdfItem(t.doc)?.textContent).toBe('Download PDF');
    expect([...t.doc.querySelectorAll('.amk-rep-exp > a')].map((a) => (a as HTMLAnchorElement).getAttribute('href'))).toEqual([`https://getmindy.ai/reports/${REPORT_ID}`]);
    expect(t.doc.querySelectorAll('[data-testid="amk-report-card"]').length).toBe(1); // opening adds no second card
    // Download PDF is a real link to the PDF route (opens a new tab).
    expect(pdfItem(t.doc)!.getAttribute('href')).toBe(`/reports/${REPORT_ID}/pdf`);
    expect(pdfItem(t.doc)!.getAttribute('target')).toBe('_blank');
  });

  it('a reload in the same tab keeps the card (the live turn records the report id and title)', async () => {
    const a = boot({ chat: [[{ type: 'session', sessionId: SID }, { type: 'token', content: 'Here is your report.' },
      { type: 'market_report', report_id: REPORT_ID, url: `https://getmindy.ai/reports/${REPORT_ID}`, title: 'Facilities maintenance', html: '<p>LIVE</p>' }, { type: 'done' }]] });
    a.open();
    await a.send('Market report for facilities maintenance');
    const b = boot({ session: a.session, local: a.local });
    b.open();
    expect(b.doc.querySelector('[data-testid="amk-report-card"] b')?.textContent).toBe('Facilities maintenance');
    expect(a.session[Object.keys(a.session)[0]]).not.toContain('LIVE'); // the html is never stored
    await b.send('Next');
    expect((b.chatBodies[0].history as Array<Record<string, unknown>>).every((h) => !('report' in h))).toBe(true); // display-only, never sent
    expect(JSON.stringify(b.chatBodies[0].history)).not.toContain(REPORT_ID);
  });

  it('a removed or expired report says so (no retry); other failures offer Try again', async () => {
    for (const status of [404, 410]) {
      const t = boot({ sessions: { list: { status: 200, json: LIST }, one: { status: 200, json: ONE } }, hosted: { status } });
      await reopen(t);
      t.click('[data-testid="amk-report-card"] .amk-repcard-open');
      await t.settle();
      const msg = t.doc.querySelector('.amk-rep-msg') as HTMLElement;
      expect(msg.textContent).toContain('This report is no longer available. Ask Mindy to create it again.');
      expect(msg.querySelector('button')).toBeNull();
      expect(pdfItem(t.doc)).toBeNull(); // no Export for a report that is gone
    }
    for (const hosted of [{ status: 503 }, 'network-error' as const]) {
      const t = boot({ sessions: { list: { status: 200, json: LIST }, one: { status: 200, json: ONE } }, hosted });
      await reopen(t);
      t.click('[data-testid="amk-report-card"] .amk-repcard-open');
      await t.settle();
      const msg = t.doc.querySelector('.amk-rep-msg') as HTMLElement;
      expect(msg.textContent).toMatch(/could not be loaded/);
      expect(msg.querySelector('button')?.textContent).toBe('Try again');
    }
  });

  it('a malformed report id from the server is ignored (no card, no request)', async () => {
    const bad = { ...ONE, messages: [ONE.messages[0], { ...ONE.messages[1], market_report: { report_id: '../admin', title: 'x' } }] };
    const t = boot({ sessions: { list: { status: 200, json: LIST }, one: { status: 200, json: bad } } });
    await reopen(t);
    expect(t.doc.querySelector('[data-testid="amk-report-card"]')).toBeNull();
    expect(t.calls.some((c) => c.url.startsWith('/reports/'))).toBe(false);
  });
});
