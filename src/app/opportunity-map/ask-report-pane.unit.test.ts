/**
 * Map Ask Mindy — in-chat REPORT PANE (the REAL drawer script, ASK_MINDY_JS, in jsdom).
 * A create_document turn ends with a `deliverables` event: the answer gets an "Open report" card (no
 * format chips), and the report opens in a pane BESIDE the chat with an Export menu, read from the
 * owner-scoped preview route inside a script-less sandboxed iframe. A revision replaces what the pane shows.
 * The open report survives a reload (and brings the signed ledger back so "revise it" resolves), is
 * dropped when the server says it is gone, and never shows in card chat.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'node:util';
import { JSDOM } from 'jsdom';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const DOCX = '11111111-1111-4111-8111-111111111111';
const PDF = '11111111-1111-4111-8111-111111111112';
const DOCX2 = '22222222-2222-4222-8222-222222222221';
const PDF2 = '22222222-2222-4222-8222-222222222222';
const LEDGER = { v: 1, entries: [{ id: 'src:create_document:c1' }], sig: 'x' };

function drawerScript(): string {
  const a = MAP.indexOf('const ASK_MINDY_JS = `<script>');
  const b = MAP.indexOf('</script>`;', a);
  return MAP.slice(a + 'const ASK_MINDY_JS = `<script>'.length, b).replace(/\\\\/g, '\\');
}
const token = (email: string) => Buffer.from(JSON.stringify({ email, exp: Date.now() + 3_600_000 })).toString('base64').replace(/=+$/, '') + '.sig';

type Reply = { status: number; json?: Record<string, unknown> };
function boot(opts: { store?: Record<string, string>; chat?: Array<Record<string, unknown>>; preview?: (id: string) => Reply } = {}) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="amkOv"></div><aside id="amk" aria-hidden="true"><div class="amk-hd"><div id="amkCtx"></div><button id="amkX"></button></div>'
    + '<div id="amkBody"></div><div class="amk-foot"><div class="amk-in"><textarea id="amkIn"></textarea><button id="amkSend"></button></div></div></aside></body></html>',
    { url: 'https://getmindy.ai/opportunity-map', runScripts: 'outside-only' },
  );
  const w = dom.window as unknown as Record<string, unknown> & Window & { eval: (s: string) => unknown };
  const store: Record<string, string> = { mi_beta_auth_token: token('pro@example.com'), ...(opts.store ?? {}) };
  Object.defineProperty(w, 'localStorage', { value: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } });
  w.TextDecoder = NodeTextDecoder as never;
  w.__mindyViewCtx = () => ({ count: 3, scope: 'all' });
  const calls: Array<{ url: string; headers: Record<string, string>; body?: Record<string, unknown> }> = [];
  const pending: Promise<unknown>[] = [];
  const previewFor = opts.preview ?? ((id: string) => ({ status: 200, json: { success: true, document_id: id, title: 'Koamana Build report', version: id === DOCX2 ? 2 : 1, html: '<!doctype html><p>REPORT BODY</p>', files: id === DOCX2 ? [{ format: 'pdf', document_id: PDF2, file_name: 'R.pdf', version: 2 }, { format: 'docx', document_id: DOCX2, file_name: 'R.docx', version: 2 }] : [{ format: 'pdf', document_id: PDF, file_name: 'R.pdf', version: 1 }, { format: 'docx', document_id: DOCX, file_name: 'R.docx', version: 1 }] } }));
  w.fetch = vi.fn((url: string, init: { headers?: Record<string, string>; body?: unknown }) => {
    calls.push({ url, headers: init?.headers ?? {}, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    let p: Promise<unknown>;
    if (url.startsWith('/api/app/vault/doc-access')) p = Promise.resolve({ ok: true, status: 200, json: async () => ({ uploads: false, generate: true }) });
    else if (url.startsWith('/api/app/vault/documents/preview')) {
      const r = previewFor(new URL(url, 'https://x').searchParams.get('id') || '');
      p = Promise.resolve({ ok: r.status < 300, status: r.status, json: async () => r.json ?? {} });
    } else if (url.startsWith('/api/app/vault/documents/download')) p = Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, url: 'https://signed/x?t=60' }) });
    else if (url.startsWith('/api/app/chat/suggestions')) p = Promise.resolve({ ok: true, status: 200, json: async () => ({ suggestions: [] }) });
    else {
      const enc = new NodeTextEncoder();
      const evs = opts.chat ?? [{ type: 'token', content: 'Done.' }, { type: 'done' }];
      const text = evs.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
      p = Promise.resolve({ ok: true, status: 200, body: new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close(); } }), json: async () => ({}) });
    }
    pending.push(p.catch(() => undefined));
    return p;
  }) as never;
  w.eval(drawerScript());
  const settle = async () => { for (let i = 0; i < 10; i++) { await Promise.all(pending); await new Promise((r) => setTimeout(r, 0)); } };
  const doc = w.document;
  const ask = async (q: string) => { (doc.getElementById('amkIn') as HTMLTextAreaElement).value = q; (doc.getElementById('amkSend') as HTMLButtonElement).click(); await settle(); };
  return { w, doc, calls, store, settle, ask };
}

const createTurn = (files: Array<Record<string, unknown>>) => [
  { type: 'session', sessionId: 's1' }, { type: 'token', content: 'I saved the report.' },
  { type: 'deliverables', files }, { type: 'sources', ledger: LEDGER }, { type: 'done' },
];
const V1 = [{ format: 'docx', document_id: DOCX, file_name: 'Koamana-Build-report.docx', version: 1 }, { format: 'pdf', document_id: PDF, file_name: 'Koamana-Build-report.pdf', version: 1 }];
const V2 = [{ format: 'docx', document_id: DOCX2, file_name: 'Koamana-Build-report.docx', version: 2 }, { format: 'pdf', document_id: PDF2, file_name: 'Koamana-Build-report.pdf', version: 2 }];

describe('Map Ask Mindy report pane', () => {
  it('create_document → Open report card only (no format chips) + pane with Export menu', async () => {
    const t = boot({ chat: createTurn(V1) });
    (t.w as unknown as { openAskMindy: () => void }).openAskMindy();
    await t.ask('Write a comprehensive market research report');
    const card = t.doc.querySelector('[data-testid="amk-report-card"]')!;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('Koamana-Build-report');
    expect(card.querySelector('.amk-repcard-open')?.textContent).toBe('Open document'); // a saved Vault document (Design & Output label)
    expect(card.textContent).toContain('Version 1');
    expect(card.querySelector('.amk-repcard-exp')).toBeNull();
    expect(card.querySelector('[data-fmt="pdf"]')).toBeNull();
    const pane = t.doc.querySelector('[data-testid="amk-report-pane"]') as HTMLElement;
    expect(pane.classList.contains('show')).toBe(true);
    expect(pane.querySelector('[data-testid="amk-export-toggle"]')?.textContent).toBe('Export');
    expect(pane.querySelector('.amk-exp-panel')?.hidden).toBe(true);
    const prev = t.calls.find((c) => c.url.startsWith('/api/app/vault/documents/preview'))!;
    expect(prev.url).toContain(`id=${DOCX}`); // the Word row is the primary id
    expect(prev.headers['x-mi-auth-token']).toBeTruthy();
    const frame = pane.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe(''); // no scripts, no same-origin
    expect(frame.getAttribute('srcdoc')).toContain('REPORT BODY');
    expect(pane.querySelector('.amk-rep-t')!.textContent).toBe('Koamana Build report');
    expect(pane.querySelector('.amk-rep-v')!.textContent).toContain('Version 1');
  });

  it('Export menu opens formats and uses the existing download route', async () => {
    const t = boot({ chat: createTurn(V1) });
    (t.w as unknown as { openAskMindy: () => void }).openAskMindy();
    await t.ask('report');
    const toggle = t.doc.querySelector('[data-testid="amk-export-toggle"]') as HTMLButtonElement;
    toggle.click();
    expect(t.doc.querySelector('.amk-exp-panel')?.hidden).toBe(false);
    expect([...t.doc.querySelectorAll('.amk-exp-panel button')].map((b) => b.textContent)).toEqual(['PDF', 'Word']);
    const before = t.calls.length;
    (t.doc.querySelector('.amk-exp-panel [data-fmt="pdf"]') as HTMLButtonElement).click();
    await t.settle();
    const dl = t.calls.slice(before).find((c) => c.url.startsWith('/api/app/vault/documents/download'))!;
    expect(dl.url).toContain(`id=${PDF}`);
  });

  it('a revision (new ids) replaces the pane with the new version; the older row is untouched', async () => {
    const t = boot({ chat: createTurn(V1) });
    (t.w as unknown as { openAskMindy: () => void }).openAskMindy();
    await t.ask('report');
    (t.w.fetch as unknown as { mockClear: () => void }).mockClear();
    // second turn returns the revision
    const t2 = boot({ chat: createTurn(V2), store: { mindy_map_report: t.store.mindy_map_report } });
    (t2.w as unknown as { openAskMindy: () => void }).openAskMindy();
    await t2.ask('make the recommendations shorter');
    const pane = t2.doc.querySelector('[data-testid="amk-report-pane"]') as HTMLElement;
    expect(pane.querySelector('.amk-rep-v')!.textContent).toContain('Version 2');
    expect(JSON.parse(t2.store.mindy_map_report)).toMatchObject({ id: DOCX2, version: 2, open: true });
  });

  it('persists the open report + signed ledger; after a reload the pane returns and "revise it" carries the ledger', async () => {
    const t = boot({ chat: createTurn(V1) });
    (t.w as unknown as { openAskMindy: () => void }).openAskMindy();
    await t.ask('report');
    const saved = JSON.parse(t.store.mindy_map_report);
    expect(saved).toMatchObject({ id: DOCX, email: 'pro@example.com', open: true, ledger: LEDGER });
    // reload: a fresh page with the same storage
    const t2 = boot({ store: { mindy_map_report: t.store.mindy_map_report } });
    (t2.w as unknown as { openAskMindy: () => void }).openAskMindy();
    await t2.settle();
    expect((t2.doc.querySelector('[data-testid="amk-report-pane"]') as HTMLElement).classList.contains('show')).toBe(true);
    await t2.ask('revise it: shorten the executive summary');
    const chat = t2.calls.find((c) => c.url === '/api/app/chat')!;
    const hist = chat.body!.history as Array<{ role: string; sources?: unknown }>;
    expect(hist[0].role).toBe('assistant');
    expect(hist[0].sources).toEqual(LEDGER);
  });

  it('closing the pane keeps the report one tap away (header "Report" button) and remembers it is closed', async () => {
    const t = boot({ chat: createTurn(V1) });
    (t.w as unknown as { openAskMindy: () => void }).openAskMindy();
    await t.ask('report');
    (t.doc.querySelector('.amk-rep-x') as HTMLButtonElement).click();
    const pane = t.doc.querySelector('[data-testid="amk-report-pane"]') as HTMLElement;
    expect(pane.classList.contains('show')).toBe(false);
    expect(JSON.parse(t.store.mindy_map_report).open).toBe(false);
    const btn = t.doc.querySelector('[data-testid="amk-report-btn"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('Saved document'); // the header button opens the saved Vault document, not the market report
    expect(btn.title).toBe('Open your saved document');
    btn.click();
    await t.settle();
    expect(pane.classList.contains('show')).toBe(true);
    expect(t.doc.querySelector('[data-testid="amk-report-btn"]')).toBeNull();
  });

  it('Escape closes the report first, then the drawer', async () => {
    const t = boot({ chat: createTurn(V1) });
    (t.w as unknown as { openAskMindy: () => void }).openAskMindy();
    await t.ask('report');
    const esc = () => t.doc.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape' }));
    esc();
    expect((t.doc.querySelector('[data-testid="amk-report-pane"]') as HTMLElement).classList.contains('show')).toBe(false);
    expect(t.doc.getElementById('amk')!.classList.contains('show')).toBe(true);
    esc();
    expect(t.doc.getElementById('amk')!.classList.contains('show')).toBe(false);
  });

  it('a report the server no longer has (404) is dropped with a plain message, never a stale page', async () => {
    const t = boot({ chat: createTurn(V1), preview: () => ({ status: 404, json: { success: false } }) });
    (t.w as unknown as { openAskMindy: () => void }).openAskMindy();
    await t.ask('report');
    const msg = t.doc.querySelector('.amk-rep-msg') as HTMLElement;
    expect(msg.textContent).toContain('no longer available');
    expect(t.store.mindy_map_report).toBeUndefined();
  });

  it('a stored report belonging to another account or workspace is never shown', async () => {
    const mine = { email: 'someone-else@example.com', ws: '', id: DOCX, open: true, files: [], ledger: LEDGER };
    const t = boot({ store: { mindy_map_report: JSON.stringify(mine) } });
    (t.w as unknown as { openAskMindy: () => void }).openAskMindy();
    await t.settle();
    expect(t.doc.querySelector('[data-testid="amk-report-pane"]')).toBeNull();
    expect(t.calls.some((c) => c.url.startsWith('/api/app/vault/documents/preview'))).toBe(false);
  });

  it('an answer with no create_document shows no card and no pane', async () => {
    const t = boot();
    (t.w as unknown as { openAskMindy: () => void }).openAskMindy();
    await t.ask('who buys the most here?');
    expect(t.doc.querySelector('[data-testid="amk-report-card"]')).toBeNull();
    expect(t.doc.querySelector('[data-testid="amk-report-pane"]')).toBeNull();
  });
});
