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
 * - the preview can be scrolled with the keyboard as soon as it opens;
 * - the PANE BODY scrolls: the frame is sized to its report, because a container-sized frame left scrolling
 *   to the inner document, which did not move in a production browser (757x485 and the /app iframe,
 *   2026-11-22).
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
    expect(srcdoc).toMatch(/<style>\.pdfbtn\{display:none!important\}html\{height:auto!important;overflow:auto!important\}body\{[^}]*\}<\/style><\/head>/);
    expect(srcdoc).toContain('REPORT BODY');
    // Still script-less: same-origin ONLY, so the pane can measure the report (no scripts/forms/popups/navigation).
    expect((t.doc.querySelector('.amk-rep-f') as HTMLIFrameElement).getAttribute('sandbox')).toBe('allow-same-origin');
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

  const fakeHeight = (f: HTMLIFrameElement, h: number) => {
    const de = f.contentDocument!.documentElement;
    Object.defineProperty(de, 'scrollHeight', { configurable: true, get: () => h });
    Object.defineProperty(de, 'clientHeight', { configurable: true, get: () => parseInt(f.style.height, 10) || 0 });
  };

  it('a loaded report is sized to its full height, the pane body takes focus, and the report is not a second scroller', async () => {
    const t = boot({ chat: reportTurn() });
    await t.ask('market report');
    const f = t.doc.querySelector('.amk-rep-f') as HTMLIFrameElement;
    const body = t.doc.querySelector('.amk-rep-body') as HTMLElement;
    const d = f.contentDocument!; d.open(); d.write(HTML); d.close();
    fakeHeight(f, 5953);
    body.scrollTop = 200;
    f.dispatchEvent(new t.w.Event('load'));
    expect(f.classList.contains('fit')).toBe(true);
    expect(f.style.height).toBe('5953px');
    expect(d.documentElement.style.getPropertyValue('overflow-y')).toBe('hidden');
    // Must be !important to beat the injected html{overflow:auto!important} (jsdom drops the priority, so the
    // source is asserted; the browser acceptance asserts the computed value).
    expect(MAP).toContain("de.style.setProperty('overflow-y','hidden','important')");
    expect(body.getAttribute('tabindex')).toBe('-1');
    expect(t.doc.activeElement).toBe(body); // keyboard scrolls the pane
    expect(body.scrollTop).toBe(0); // a new report starts at the top
    expect(MAP).toContain('.amk-rep-f.fit{position:static;display:block;inset:auto}');
  });

  it('a horizontal scrollbar inside the report is added to the height, so the last line is not hidden', async () => {
    const t = boot({ chat: reportTurn() });
    await t.ask('market report');
    const f = t.doc.querySelector('.amk-rep-f') as HTMLIFrameElement;
    const d = f.contentDocument!; d.open(); d.write(HTML); d.close();
    const de = d.documentElement;
    Object.defineProperty(de, 'scrollHeight', { configurable: true, get: () => 3000 });
    Object.defineProperty(de, 'clientHeight', { configurable: true, get: () => (parseInt(f.style.height, 10) || 0) - 14 });
    f.dispatchEvent(new t.w.Event('load'));
    expect(f.style.height).toBe('3014px');
  });

  it('a new report resets the fit, and a report whose document cannot be read keeps the full-pane frame', async () => {
    const t = boot({ chat: reportTurn() });
    await t.ask('market report');
    const f = t.doc.querySelector('.amk-rep-f') as HTMLIFrameElement;
    const d = f.contentDocument!; d.open(); d.write(HTML); d.close();
    fakeHeight(f, 4000);
    f.dispatchEvent(new t.w.Event('load'));
    expect(f.classList.contains('fit')).toBe(true);
    // A revision / another report: the frame goes back to full-pane until it is measured again.
    (t.doc.querySelector('.amk-rep-x') as HTMLButtonElement).click();
    (t.doc.querySelector('.amk-repcard-open') as HTMLButtonElement).click();
    expect(f.classList.contains('fit')).toBe(false);
    expect(f.style.height).toBe('');
    Object.defineProperty(f, 'contentDocument', { configurable: true, get: () => null });
    const focus = vi.spyOn(f, 'focus');
    f.dispatchEvent(new t.w.Event('load'));
    expect(f.classList.contains('fit')).toBe(false);
    expect(focus).toHaveBeenCalledTimes(1); // fallback: the frame's own document scrolls
  });

  it('after a click INSIDE the report (focus in the frame), Page Down / End / arrows / Space scroll the pane body (retest 2026-11-25)', async () => {
    const t = boot({ chat: reportTurn() });
    await t.ask('market report');
    const f = t.doc.querySelector('.amk-rep-f') as HTMLIFrameElement;
    const body = t.doc.querySelector('.amk-rep-body') as HTMLElement;
    const d = f.contentDocument!; d.open(); d.write(HTML); d.close();
    fakeHeight(f, 6000);
    f.dispatchEvent(new t.w.Event('load'));
    expect(f.classList.contains('fit')).toBe(true);
    // jsdom has no layout: give the pane a real viewport and a stored, clamped scroll position.
    let top = 0;
    Object.defineProperty(body, 'clientHeight', { configurable: true, get: () => 400 });
    Object.defineProperty(body, 'scrollHeight', { configurable: true, get: () => 6000 });
    Object.defineProperty(body, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = Math.max(0, Math.min(5600, v)); } });
    const key = (k: string, o: KeyboardEventInit = {}) => {
      const ev = new (d.defaultView as unknown as typeof window).KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o });
      d.body.dispatchEvent(ev);
      return ev;
    };
    key('PageDown'); key('PageDown'); key('PageDown');
    expect(top).toBe(3 * 360);
    expect(key('End').defaultPrevented).toBe(true);
    expect(top).toBe(5600); // the end of the report: last section and footer in view
    key('ArrowUp'); expect(top).toBe(5560);
    key('ArrowDown'); expect(top).toBe(5600);
    key('Home'); expect(top).toBe(0);
    key(' '); expect(top).toBe(360);
    key(' ', { shiftKey: true }); expect(top).toBe(0);
    key('PageUp'); expect(top).toBe(0);
    // Left alone: modified keys (browser shortcuts) and sideways arrows (a wide table scrolls itself).
    expect(key('End', { metaKey: true }).defaultPrevented).toBe(false);
    expect(key('ArrowRight').defaultPrevented).toBe(false);
    expect(top).toBe(0);
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

describe('Map report pane: the same-origin preview frame is locked down (Agent 4 review, 2026-11-22)', () => {
  const frame = (doc: Document) => doc.querySelector('.amk-rep-f') as HTMLIFrameElement;

  it('the sandbox is exactly allow-same-origin: never scripts, forms, popups, modals or top navigation', async () => {
    const t = boot({ chat: reportTurn() });
    await t.ask('market report');
    const sb = frame(t.doc).getAttribute('sandbox');
    expect(sb).toBe('allow-same-origin');
    expect((sb ?? '').split(/\s+/).filter(Boolean)).toEqual(['allow-same-origin']); // the exact token list
    for (const token of ['allow-scripts', 'allow-forms', 'allow-popups', 'allow-modals', 'allow-top-navigation', 'allow-downloads']) expect(sb).not.toContain(token);
    expect(MAP.match(/sandbox="[^"]*"/g)?.filter((m) => m.includes('allow-')) ?? []).toEqual(['sandbox="allow-same-origin"']); // the only token anywhere in the Map page
  });

  it('a Content-Security-Policy that blocks every request is the first thing in the frame, and refresh / base tags are removed', async () => {
    const hostile = '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=/api/app/chat-sessions?email=x"><META HTTP-EQUIV=Refresh CONTENT="1; URL=/api/x"><base href="https://evil.example/"><title>R</title></head><body><p>REPORT BODY</p></body></html>';
    const t = boot({ chat: reportTurn({ html: hostile }) });
    await t.ask('market report');
    const srcdoc = frame(t.doc).srcdoc;
    const head = srcdoc.slice(srcdoc.indexOf('<head>') + '<head>'.length);
    expect(head.startsWith('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; base-uri \'none\'; form-action \'none\'">')).toBe(true);
    expect(srcdoc).not.toMatch(/http-equiv="?refresh/i);
    expect(srcdoc).not.toMatch(/<base\b/i);
    expect(srcdoc).toContain('REPORT BODY');
  });

  it('HTML without a head still gets the policy first', async () => {
    const t = boot({ chat: reportTurn({ html: '<p>BARE</p>' }) });
    await t.ask('market report');
    const srcdoc = frame(t.doc).srcdoc;
    expect(srcdoc).toMatch(/^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"/);
    expect(srcdoc).toContain('<p>BARE</p>');
  });

  // Parsed the way the frame will parse it, so entity-encoded or reordered attributes cannot slip through.
  const cleaned = async (hostile: string) => {
    const t = boot({ chat: reportTurn({ html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${hostile}</head><body><p>REPORT BODY</p>${hostile}</body></html>` }) });
    await t.ask('market report');
    const srcdoc = frame(t.doc).srcdoc;
    const d = new t.w.DOMParser().parseFromString(srcdoc, 'text/html');
    return { srcdoc, d };
  };

  it.each([
    ['plain refresh', '<meta http-equiv="refresh" content="0;url=/api/app/chat-sessions?email=a@b.c">'],
    ['entity-encoded http-equiv', '<meta http-equiv="&#114;efresh" content="0;url=/api/x">'],
    ['hex entity, mixed case', '<META HTTP-EQUIV="&#x52;EFRESH" CONTENT="0; URL=/api/x">'],
    ['content before http-equiv', '<meta content="0;url=/api/x" http-equiv=refresh>'],
    ['unquoted, extra whitespace', '<meta   http-equiv = refresh   content=0;url=/api/x>'],
    ['any other http-equiv', '<meta http-equiv="set-cookie" content="a=b">'],
    ['refresh in body inside noscript', '<noscript><meta http-equiv="refresh" content="0;url=/api/x"></noscript>'],
  ])('no meta except charset/viewport survives: %s', async (_name, hostile) => {
    const { d } = await cleaned(hostile);
    const metas = [...d.querySelectorAll('meta')].map((m) => m.getAttribute('http-equiv') ?? m.getAttribute('name') ?? (m.hasAttribute('charset') ? 'charset' : '?'));
    expect(metas).toEqual(['Content-Security-Policy', 'charset', 'viewport']); // the policy first, then the two harmless ones
    expect(d.querySelector('meta[http-equiv="Content-Security-Policy"]')).toBe(d.head.firstElementChild);
  });

  it.each([
    ['base', '<base href="https://evil.example/">'],
    ['form', '<form action="/api/app/vault/documents" method="post"><input name="x"></form>'],
    ['script', '<script>alert(1)</script>'],
    ['iframe', '<iframe src="/api/x"></iframe>'],
    ['object / embed', '<object data="/api/x"></object><embed src="/api/x">'],
    ['link prefetch', '<link rel="prefetch" href="/api/x">'],
    ['template', '<template><meta http-equiv="refresh" content="0;url=/api/x"></template>'],
    ['svg animation rewriting href', '<svg><a href="https://ok.example/"><animate attributeName="href" to="/api/x"/><text>t</text></a></svg>'],
    ['math', '<math><mi xlink:href="/api/x">x</mi></math>'],
  ])('dangerous elements are removed: %s', async (_name, hostile) => {
    const { d } = await cleaned(hostile);
    expect(d.querySelector('base,form,script,iframe,object,embed,link,template,animate,set,math')).toBeNull();
    expect(d.body.textContent).toContain('REPORT BODY');
  });

  it('on* attributes and non-http(s)/mailto/# URLs are removed; safe links and data: images stay', async () => {
    const { d } = await cleaned(
      '<a id="js" href="javascript:alert(1)">a</a><a id="js2" href=" jav&#x09;ascript:alert(1)">b</a><a id="rel" href="/api/app/vault/documents/download?id=1">c</a>'
      + '<a id="ext" href="https://www.sam.gov/opp/1">d</a><a id="mail" href="mailto:x@example.com">e</a><a id="frag" href="#sec">f</a>'
      + '<img id="img" src="/api/should-not-load.png" onerror="alert(1)"><img id="data" src="data:image/png;base64,AAAA"><div id="h" onclick="x()" onmouseover="y()">h</div>'
      + '<svg><a id="sv" xlink:href="/api/x"><text>s</text></a></svg>',
    );
    const href = (id: string) => d.getElementById(id)?.getAttribute('href') ?? null;
    expect(href('js')).toBeNull();
    expect(href('js2')).toBeNull();
    expect(href('rel')).toBeNull();
    expect(href('ext')).toBe('https://www.sam.gov/opp/1');
    expect(href('mail')).toBe('mailto:x@example.com');
    expect(href('frag')).toBe('#sec');
    expect(d.getElementById('img')!.hasAttribute('src')).toBe(false);
    expect(d.getElementById('img')!.hasAttribute('onerror')).toBe(false);
    expect(d.getElementById('data')!.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect([...d.getElementById('h')!.attributes].map((a) => a.name)).toEqual(['id']);
    expect(d.querySelector('[id="sv"]')!.getAttribute('xlink:href')).toBeNull();
    expect([...d.querySelectorAll('*')].flatMap((e) => [...e.attributes]).filter((a) => /^on/i.test(a.name))).toEqual([]);
  });

  it.each([
    ['"<head>" inside an attribute of <html>', '<!doctype html><html data-x="<head>"><head><title>R</title></head><body><p>REPORT BODY</p></body></html>'],
    ['"<head>" inside an attribute in the body', '<!doctype html><html><head><title>R</title></head><body><p title="<head><meta>">REPORT BODY</p></body></html>'],
    ['no head at all, attribute with "<head"', '<p data-y="<head x>">REPORT BODY</p>'],
  ])('the policy is inserted through the DOM, so it is the first head child even when %s', async (_name, html) => {
    const t = boot({ chat: reportTurn({ html }) });
    await t.ask('market report');
    const d = new t.w.DOMParser().parseFromString(frame(t.doc).srcdoc, 'text/html'); // parsed the way the frame parses it
    const first = d.head.firstElementChild!;
    expect(first.tagName).toBe('META');
    expect(first.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(first.getAttribute('content')).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'");
    expect(d.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').length).toBe(1); // never smuggled into an attribute
    expect(d.body.textContent).toContain('REPORT BODY');
  });

  it('the policy is never spliced into the serialized string', () => {
    expect(MAP).toContain('head.insertBefore(csp,head.firstChild);');
    expect(MAP).not.toMatch(/serialized\.replace\(/);
  });

  it('the old string-regex stripping is gone (it was bypassable)', () => {
    expect(MAP).toContain('new DOMParser().parseFromString');
    expect(MAP).not.toMatch(/replace\(\/<meta\[\^>\]\*http-equiv/);
  });

  it('links never navigate the frame: http(s) opens a new tab with noopener, mailto goes to the mail app, anything else does nothing', async () => {
    const t = boot({ chat: reportTurn() });
    await t.ask('market report');
    const f = frame(t.doc);
    const d = f.contentDocument!;
    d.open(); d.write('<!doctype html><html><head></head><body><a id="ext" href="https://www.sam.gov/opp/1">SAM</a><a id="api" href="/api/app/vault/documents/download?id=1">x</a><a id="js" href="javascript:alert(1)">y</a><span id="txt">plain</span></body></html>'); d.close();
    const open = vi.fn();
    (t.w as unknown as { open: typeof open }).open = open;
    f.dispatchEvent(new t.w.Event('load'));
    const click = (id: string) => { const ev = new d.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }); d.getElementById(id)!.dispatchEvent(ev); return ev.defaultPrevented; };
    expect(click('ext')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://www.sam.gov/opp/1', '_blank', 'noopener');
    expect(click('api')).toBe(true); // prevented, and nothing opened
    expect(click('js')).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(click('txt')).toBe(false); // ordinary clicks are untouched
  });
});

