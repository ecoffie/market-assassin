/**
 * Map Ask Mindy report pane: preview scrolling and export (2026-11-22). Runs the REAL drawer script
 * (ASK_MINDY_JS) in jsdom.
 *
 * Before:
 * - a packaged market report showed its own "Save as PDF" (window.print) inside the script-less preview
 *   frame, where it could not run;
 * - the header only offered "Open hosted link", whose page's button opened the print dialog;
 * - no file was ever produced, and a failed export only changed a button label.
 *
 * Now:
 * - Export → Download PDF navigates a hidden frame to /reports/<id>/pdf (Content-Disposition: attachment),
 *   so the BROWSER saves the file. The first version fetched a blob and clicked a synthetic link; in
 *   production that saved nothing, while the route itself returned a valid PDF (2026-11-22);
 * - a failure loads the route's HTML error page in that frame, and its message is shown in the pane;
 * - the in-frame button is hidden;
 * - the preview can be scrolled with the keyboard as soon as it opens.
 *
 * Browser proof: scripts/acceptance/map-report-pane.mjs.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'node:util';
import { JSDOM } from 'jsdom';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const REPORT_ID = 'AbCdEfGhIjKlMnOpQrStUv';
const HTML = '<!doctype html><html><head><title>R</title></head><body><header class="rp"><h1>Facilities maintenance</h1><button class="pdfbtn" onclick="window.print()">Save as PDF</button></header><p>REPORT BODY</p></body></html>';

function drawerScript(): string {
  const a = MAP.indexOf('const ASK_MINDY_JS = `<script>');
  const b = MAP.indexOf('</script>`;', a);
  return MAP.slice(a + 'const ASK_MINDY_JS = `<script>'.length, b).replace(/\\\\/g, '\\');
}
const token = (email: string) => Buffer.from(JSON.stringify({ email, exp: Date.now() + 3_600_000 })).toString('base64').replace(/=+$/, '') + '.sig';

function boot(opts: { chat: Array<Record<string, unknown>>; download?: { ok: boolean } }) {
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
  const saved: Array<{ href: string; download: string }> = [];
  let blobs = 0;
  (w as unknown as { URL: { createObjectURL: (b: unknown) => string; revokeObjectURL: () => void } }).URL.createObjectURL = () => { blobs++; return 'blob:https://getmindy.ai/x'; };
  (w as unknown as { URL: { revokeObjectURL: () => void } }).URL.revokeObjectURL = () => {};
  (w as unknown as { HTMLAnchorElement: { prototype: { click: () => void } } }).HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    saved.push({ href: this.href, download: this.download });
  };
  // Timers of a second or more are held so a test can advance them (the PDF settle and frame cleanup).
  const held: Array<{ at: number; fn: () => void }> = [];
  let clock = 0;
  const realSetTimeout = w.setTimeout.bind(w);
  (w as unknown as { setTimeout: (fn: () => void, ms?: number) => unknown }).setTimeout = (fn: () => void, ms?: number) => {
    if ((ms ?? 0) >= 1000) { held.push({ at: clock + (ms ?? 0), fn }); return held.length; }
    return realSetTimeout(fn, ms);
  };
  const advance = (ms: number) => {
    clock += ms;
    for (const t of held.splice(0)) { if (t.at <= clock) t.fn(); else held.push(t); }
  };
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const pending: Promise<unknown>[] = [];
  w.fetch = vi.fn((url: string, init: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers ?? {} });
    let p: Promise<unknown>;
    if (url.startsWith('/api/app/vault/doc-access')) p = Promise.resolve({ ok: true, status: 200, json: async () => ({ uploads: false, generate: true }) });
    else if (url.startsWith('/api/app/vault/documents/download')) {
      p = opts.download?.ok === false ? Promise.resolve({ ok: false, status: 404, json: async () => ({ success: false }) }) : Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, url: 'https://signed/x' }) });
    } else if (url.startsWith('/api/app/vault/documents/preview')) {
      p = Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, title: 'Doc', version: 1, html: '<!doctype html><p>DOC</p>', files: [{ format: 'pdf', document_id: '11111111-1111-4111-8111-111111111112', file_name: 'R.pdf', version: 1 }] }) });
    } else if (url.startsWith('/api/app/chat/suggestions')) p = Promise.resolve({ ok: true, status: 200, json: async () => ({ suggestions: [] }) });
    else {
      const enc = new NodeTextEncoder();
      const text = opts.chat.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
      p = Promise.resolve({ ok: true, status: 200, body: new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close(); } }), json: async () => ({}) });
    }
    pending.push(p.catch(() => undefined));
    return p;
  }) as never;
  w.eval(drawerScript());
  const settle = async () => { for (let i = 0; i < 12; i++) { await Promise.all(pending); await new Promise((r) => setTimeout(r, 0)); } };
  const doc = w.document;
  const ask = async (q: string) => { (doc.getElementById('amkIn') as HTMLTextAreaElement).value = q; (doc.getElementById('amkSend') as HTMLButtonElement).click(); await settle(); };
  (w as unknown as { openAskMindy: () => void }).openAskMindy();
  return { w, doc, calls, saved, settle, ask, advance, blobs: () => blobs };
}

const reportTurn = (over: Record<string, unknown> = {}) => [
  { type: 'session', sessionId: 's1' }, { type: 'token', content: 'Here is your report.' },
  { type: 'market_report', report_id: REPORT_ID, url: `https://getmindy.ai/reports/${REPORT_ID}`, title: 'Facilities maintenance', html: HTML, ...over },
  { type: 'done' },
];

const pane = (doc: Document) => doc.querySelector('[data-testid="amk-report-pane"]') as HTMLElement;
const err = (doc: Document) => doc.querySelector('[data-testid="amk-report-error"]') as HTMLElement;
const pdfItem = (doc: Document) => doc.querySelector('.amk-exp-panel [data-fmt="pdf"]') as HTMLElement | null;

describe('Map report pane: a packaged market report exports a real PDF', () => {
  it('shows the report with its in-frame print button hidden, and Export → Download PDF in the header', async () => {
    const t = boot({ chat: reportTurn() });
    await t.ask('market report for facilities maintenance');
    expect(pane(t.doc).classList.contains('show')).toBe(true);
    const srcdoc = (t.doc.querySelector('.amk-rep-f') as HTMLIFrameElement).srcdoc;
    expect(srcdoc).toContain('<style>.pdfbtn{display:none!important}</style></head>');
    expect(srcdoc).toContain('REPORT BODY');
    expect((t.doc.querySelector('.amk-rep-f') as HTMLIFrameElement).getAttribute('sandbox')).toBe(''); // still script-less
    expect(pdfItem(t.doc)?.textContent).toBe('Download PDF');
    expect(t.doc.querySelectorAll('.amk-exp-panel [role="menuitem"]').length).toBe(1); // PDF only: the one real export
    expect([...t.doc.querySelectorAll('.amk-rep-exp > a')].map((a) => a.textContent)).toEqual(['Open hosted link']);
  });

  it('Download PDF is a real link to /reports/<id>/pdf that opens a new tab: no fetch, no blob, no hidden frame', async () => {
    const t = boot({ chat: reportTurn() });
    await t.ask('market report');
    const a = pdfItem(t.doc) as HTMLAnchorElement;
    expect(a.tagName).toBe('A');
    expect(a.getAttribute('href')).toBe(`/reports/${REPORT_ID}/pdf`);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener');
    expect(a.hasAttribute('download')).toBe(false); // a failure must show the route's error page, never save it as a file
    expect(a.getAttribute('role')).toBe('menuitem');
    expect(a.textContent).toBe('Download PDF');
    expect(a.getAttribute('title')).toBe('Opens in a new tab'); // says where it goes
    expect(a.getAttribute('aria-label')).toBe('Download PDF (opens in a new tab)');
    // The browser follows the link itself; the handler only records the export and closes the menu.
    const track = vi.fn();
    (t.w as unknown as { __track: typeof track }).__track = track;
    const ev = new t.w.MouseEvent('click', { bubbles: true, cancelable: true });
    (t.doc.querySelector('[data-testid="amk-export-toggle"]') as HTMLButtonElement).click();
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(track).toHaveBeenCalledWith('tool_use', 'map_report_export', { format: 'pdf', source: 'market_report' });
    expect((t.doc.querySelector('.amk-exp-panel') as HTMLElement).hidden).toBe(true);
    await t.settle();
    expect(t.calls.some((c) => c.url.startsWith('/reports/'))).toBe(false);
    expect(t.blobs()).toBe(0);
    expect(t.saved).toEqual([]);
    expect(t.doc.querySelector('iframe[data-testid="amk-report-pdf-frame"]')).toBeNull();
    expect(MAP).not.toContain('function downloadReportPdf'); // the script-driven download is gone
  });

  it('a report that was not saved (no report_id) offers no download and says why', async () => {
    const t = boot({ chat: reportTurn({ report_id: null, url: null }) });
    await t.ask('market report');
    expect(pdfItem(t.doc)).toBeNull();
    expect(t.doc.querySelector('[data-testid="amk-report-no-export"]')?.textContent).toMatch(/not saved.*Ask Mindy to create it again/);
  });

  it('reopening from the chat card keeps Export', async () => {
    const t = boot({ chat: reportTurn() });
    await t.ask('market report');
    (t.doc.querySelector('.amk-rep-x') as HTMLButtonElement).click();
    expect(t.doc.querySelector('.amk-repcard-open')?.textContent).toBe('Open market report');
    (t.doc.querySelector('.amk-repcard-open') as HTMLButtonElement).click();
    expect(pane(t.doc).classList.contains('show')).toBe(true);
    expect(pdfItem(t.doc)?.textContent).toBe('Download PDF');
  });
});

describe('Map report pane: Vault document export errors are visible', () => {
  it('a failed Vault download shows an actionable message', async () => {
    const t = boot({
      chat: [{ type: 'session', sessionId: 's1' }, { type: 'token', content: 'Saved.' }, { type: 'deliverables', files: [{ format: 'pdf', document_id: '11111111-1111-4111-8111-111111111112', file_name: 'R.pdf', version: 1 }] }, { type: 'done' }],
      download: { ok: false },
    });
    await t.ask('write a report');
    pdfItem(t.doc)!.click();
    await t.settle();
    expect(err(t.doc).hidden).toBe(false);
    expect(err(t.doc).textContent).toMatch(/PDF file could not be prepared\. Try again/);
  });
});

describe('Map report pane: the preview can be scrolled', () => {
  it('the preview container scrolls (WebKit/iOS size iframes to their content)', () => {
    expect(MAP).toMatch(/\.amk-rep-body\{[^}]*overflow:auto;-webkit-overflow-scrolling:touch/);
  });

  it('focus moves into the loaded report so the keyboard scrolls it, and opening the drawer does not take it back', async () => {
    const t = boot({ chat: reportTurn() });
    await t.ask('market report');
    const f = t.doc.querySelector('.amk-rep-f') as HTMLIFrameElement;
    const focus = vi.spyOn(f, 'focus');
    f.dispatchEvent(new t.w.Event('load'));
    expect(focus).toHaveBeenCalledTimes(1);
    expect(MAP).toContain('setTimeout(function(){ if(input&&!repIsOpen()) input.focus(); },220);');
  });
});
