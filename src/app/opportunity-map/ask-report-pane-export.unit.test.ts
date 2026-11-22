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
 * - Export → Download PDF fetches /reports/<id>/pdf outside the frame and saves the file;
 * - failures show the server's message in the pane;
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
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7

function drawerScript(): string {
  const a = MAP.indexOf('const ASK_MINDY_JS = `<script>');
  const b = MAP.indexOf('</script>`;', a);
  return MAP.slice(a + 'const ASK_MINDY_JS = `<script>'.length, b).replace(/\\\\/g, '\\');
}
const token = (email: string) => Buffer.from(JSON.stringify({ email, exp: Date.now() + 3_600_000 })).toString('base64').replace(/=+$/, '') + '.sig';

type PdfReply = { status: number; contentType: string; json?: Record<string, unknown>; disposition?: string } | 'network-error';

function boot(opts: { chat: Array<Record<string, unknown>>; pdf?: PdfReply; download?: { ok: boolean } }) {
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
  (w as unknown as { URL: { createObjectURL: (b: unknown) => string; revokeObjectURL: () => void } }).URL.createObjectURL = () => 'blob:https://getmindy.ai/x';
  (w as unknown as { URL: { revokeObjectURL: () => void } }).URL.revokeObjectURL = () => {};
  (w as unknown as { HTMLAnchorElement: { prototype: { click: () => void } } }).HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    saved.push({ href: this.href, download: this.download });
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
    } else if (url.startsWith('/reports/')) {
      const r = opts.pdf ?? { status: 200, contentType: 'application/pdf', disposition: 'attachment; filename="facilities-maintenance-market-report.pdf"' };
      if (r === 'network-error') p = Promise.reject(new Error('offline'));
      else {
        const headers = new Map([['content-type', r.contentType], ['content-disposition', r.disposition ?? '']]);
        p = Promise.resolve({ ok: r.status < 300, status: r.status, headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null }, blob: async () => ({ size: PDF_BYTES.length }), json: async () => r.json ?? {} });
      }
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
  return { w, doc, calls, saved, settle, ask };
}

const reportTurn = (over: Record<string, unknown> = {}) => [
  { type: 'session', sessionId: 's1' }, { type: 'token', content: 'Here is your report.' },
  { type: 'market_report', report_id: REPORT_ID, url: `https://getmindy.ai/reports/${REPORT_ID}`, title: 'Facilities maintenance', html: HTML, ...over },
  { type: 'done' },
];

const pane = (doc: Document) => doc.querySelector('[data-testid="amk-report-pane"]') as HTMLElement;
const err = (doc: Document) => doc.querySelector('[data-testid="amk-report-error"]') as HTMLElement;
const pdfItem = (doc: Document) => doc.querySelector('.amk-exp-panel button[data-fmt="pdf"]') as HTMLButtonElement | null;

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
    expect(t.doc.querySelectorAll('.amk-exp-panel button').length).toBe(1); // PDF only: the one real export
    expect([...t.doc.querySelectorAll('.amk-rep-exp a')].map((a) => a.textContent)).toEqual(['Open hosted link']);
  });

  it('Download PDF fetches /reports/<id>/pdf outside the frame and saves the file with the server’s name', async () => {
    const t = boot({ chat: reportTurn() });
    await t.ask('market report');
    pdfItem(t.doc)!.click();
    await t.settle();
    const call = t.calls.find((c) => c.url.startsWith('/reports/'))!;
    expect(call.url).toBe(`/reports/${REPORT_ID}/pdf`);
    expect(call.headers.Accept).toContain('application/json'); // errors come back as a readable message
    expect(t.saved).toEqual([{ href: 'blob:https://getmindy.ai/x', download: 'facilities-maintenance-market-report.pdf' }]);
    expect(err(t.doc).hidden).toBe(true);
    expect(pdfItem(t.doc)!.textContent).toBe('Download PDF');
  });

  it('a server failure shows its message in the pane and offers Try again (never a silent label change)', async () => {
    const message = "We couldn't create the PDF just now. Try again in a minute. The report itself is unchanged.";
    const t = boot({ chat: reportTurn(), pdf: { status: 503, contentType: 'application/json', json: { success: false, error: 'pdf_unavailable', message } } });
    await t.ask('market report');
    pdfItem(t.doc)!.click();
    await t.settle();
    expect(err(t.doc).hidden).toBe(false);
    expect(err(t.doc).getAttribute('role')).toBe('alert');
    expect(err(t.doc).textContent).toBe(message);
    expect(pdfItem(t.doc)!.textContent).toBe('Try again');
    expect(t.saved).toEqual([]);
  });

  it('a 200 that is not a PDF is not saved', async () => {
    const t = boot({ chat: reportTurn(), pdf: { status: 200, contentType: 'text/html', json: {} } });
    await t.ask('market report');
    pdfItem(t.doc)!.click();
    await t.settle();
    expect(t.saved).toEqual([]);
    expect(err(t.doc).textContent).toMatch(/could not be created/);
  });

  it('a network failure says to check the connection', async () => {
    const t = boot({ chat: reportTurn(), pdf: 'network-error' });
    await t.ask('market report');
    pdfItem(t.doc)!.click();
    await t.settle();
    expect(err(t.doc).textContent).toMatch(/Check your connection/);
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
