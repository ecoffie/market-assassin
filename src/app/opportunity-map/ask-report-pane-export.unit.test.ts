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

  it('Download PDF navigates a hidden frame to /reports/<id>/pdf: no fetch, no blob, no synthetic link', async () => {
    const t = boot({ chat: reportTurn() });
    await t.ask('market report');
    pdfItem(t.doc)!.click();
    await t.settle();
    const frames = t.doc.querySelectorAll('[data-testid="amk-report-pdf-frame"]');
    expect(frames.length).toBe(1);
    const f = frames[0] as HTMLIFrameElement;
    expect(f.getAttribute('src')).toBe(`/reports/${REPORT_ID}/pdf`);
    expect(f.getAttribute('aria-hidden')).toBe('true');
    expect(f.style.visibility).toBe('hidden');
    expect(f.hasAttribute('sandbox')).toBe(false); // a sandboxed frame could not download
    expect(t.calls.some((c) => c.url.startsWith('/reports/'))).toBe(false); // one render, by the browser
    expect(t.blobs()).toBe(0);
    expect(t.saved).toEqual([]);
    expect(pdfItem(t.doc)!.disabled).toBe(true);
    expect(pdfItem(t.doc)!.textContent).toBe('Preparing PDF...');
    t.advance(10_000);
    expect(pdfItem(t.doc)!.disabled).toBe(false);
    expect(pdfItem(t.doc)!.textContent).toBe('Download PDF');
    expect(err(t.doc).hidden).toBe(true);
    t.advance(120_000);
    expect(t.doc.querySelectorAll('[data-testid="amk-report-pdf-frame"]').length).toBe(0); // cleaned up
  });

  const loadInFrame = (doc: Document, html: string) => {
    const f = doc.querySelector('[data-testid="amk-report-pdf-frame"]') as HTMLIFrameElement;
    const d = f.contentDocument!;
    d.open(); d.write(html); d.close();
    f.dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event('load'));
  };
  const routeErrorPage = (message: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PDF not available</title></head><body><div class="c"><h1>PDF not available</h1><p>${message}</p></div></body></html>`;

  it('a route failure (its HTML error page loads in the frame) shows the message and offers Try again', async () => {
    const message = "We couldn't create the PDF just now. Try again in a minute. The report itself is unchanged.";
    const t = boot({ chat: reportTurn() });
    await t.ask('market report');
    pdfItem(t.doc)!.click();
    await t.settle();
    loadInFrame(t.doc, routeErrorPage(message));
    expect(err(t.doc).hidden).toBe(false);
    expect(err(t.doc).getAttribute('role')).toBe('alert');
    expect(err(t.doc).textContent).toBe(message);
    expect(pdfItem(t.doc)!.textContent).toBe('Try again');
    expect(pdfItem(t.doc)!.disabled).toBe(false);
    t.advance(10_000);
    expect(pdfItem(t.doc)!.textContent).toBe('Try again'); // the settle never hides a failure
  });

  it('a failure that arrives AFTER the button settled still shows (a slow failure is never silent)', async () => {
    const t = boot({ chat: reportTurn() });
    await t.ask('market report');
    pdfItem(t.doc)!.click();
    await t.settle();
    t.advance(10_000);
    expect(pdfItem(t.doc)!.textContent).toBe('Download PDF');
    loadInFrame(t.doc, routeErrorPage('Too many PDF downloads in a short time. Wait a few minutes and try again.'));
    expect(err(t.doc).textContent).toMatch(/Too many PDF downloads/);
    expect(pdfItem(t.doc)!.textContent).toBe('Try again');
  });

  it('any other page in the frame (e.g. a platform error) is a failure with a generic message', async () => {
    const t = boot({ chat: reportTurn() });
    await t.ask('market report');
    pdfItem(t.doc)!.click();
    await t.settle();
    loadInFrame(t.doc, '<!doctype html><html><head><title>504</title></head><body>An error occurred with this application.</body></html>');
    expect(err(t.doc).textContent).toMatch(/could not be created/);
    expect(pdfItem(t.doc)!.textContent).toBe('Try again');
  });

  it('an empty load (about:blank, or a browser that fires load for a download) is not an error', async () => {
    const t = boot({ chat: reportTurn() });
    await t.ask('market report');
    pdfItem(t.doc)!.click();
    await t.settle();
    loadInFrame(t.doc, '');
    expect(err(t.doc).hidden).toBe(true);
    t.advance(10_000);
    expect(pdfItem(t.doc)!.textContent).toBe('Download PDF');
  });

  it('Try again replaces the old frame (one download frame at a time) and starts a fresh download', async () => {
    const t = boot({ chat: reportTurn() });
    await t.ask('market report');
    pdfItem(t.doc)!.click();
    await t.settle();
    loadInFrame(t.doc, routeErrorPage('Too many PDF downloads in a short time. Wait a few minutes and try again.'));
    pdfItem(t.doc)!.click();
    await t.settle();
    expect(t.doc.querySelectorAll('[data-testid="amk-report-pdf-frame"]').length).toBe(1);
    expect(err(t.doc).hidden).toBe(true);
    expect(pdfItem(t.doc)!.textContent).toBe('Preparing PDF...');
    t.advance(10_000);
    expect(pdfItem(t.doc)!.textContent).toBe('Download PDF');
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
