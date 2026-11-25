/**
 * Map drawer "Use a file from Drive or OneDrive": the REAL drawer script (ASK_MINDY_JS) in jsdom.
 * Hidden unless GET /api/app/connected-apps answers (404 while the flag is off); a 401 right after sign-in is
 * retried. Connect shows the access note and does not leave the Map until Continue. OneDrive picks go through
 * Mindy's chooser (POST /browse, /selections) and become chips; the next question carries connectedFiles;
 * removing the chip or a new chat stops sending it. Back from the provider (?connect=ok) the drawer reopens,
 * says what happened and cleans the address bar.
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
function token(email: string): string {
  return Buffer.from(JSON.stringify({ email, exp: Date.now() + 3_600_000 })).toString('base64').replace(/=+$/, '') + '.sig';
}

const ME = 'pro@example.com';
const ON = { connections: [{ id: 'conn-ms', provider: 'microsoft', connected_email: 'me@onedrive.com', status: 'connected' }], providers: [{ provider: 'google', available: true }, { provider: 'microsoft', available: true }] };

type Call = { url: string; method: string; body?: Record<string, unknown> };
function boot(opts: { list?: Array<{ status: number; json?: Record<string, unknown> }>; url?: string; open?: boolean } = {}) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="amkOv"></div><aside id="amk" aria-hidden="true"><div id="amkCtx"></div><button id="amkX"></button>'
    + '<div id="amkBody"></div><div class="amk-foot"><div class="amk-in"><textarea id="amkIn"></textarea><button id="amkSend"></button></div></div></aside></body></html>',
    { url: opts.url ?? 'https://getmindy.ai/opportunity-map', runScripts: 'outside-only' },
  );
  const w = dom.window as unknown as Record<string, unknown> & Window & { eval: (s: string) => unknown };
  const store: Record<string, string> = { mi_beta_auth_token: token(ME) };
  Object.defineProperty(w, 'localStorage', { value: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } });
  w.TextDecoder = NodeTextDecoder as never;
  w.__mindyViewCtx = () => ({ count: 3, scope: 'all' });
  const listReplies = [...(opts.list ?? [{ status: 200, json: ON }])];
  const calls: Call[] = [];
  const pending: Promise<unknown>[] = [];
  const reply = (status: number, json: unknown) => Promise.resolve({ ok: status < 300, status, json: async () => json });
  w.fetch = vi.fn((url: string, init: { method?: string; body?: unknown }) => {
    const method = init?.method || 'GET';
    const call: Call = { url, method };
    if (typeof init?.body === 'string') call.body = JSON.parse(init.body);
    calls.push(call);
    let p: Promise<unknown>;
    if (url.startsWith('/api/app/connected-apps?')) { const r = listReplies.length > 1 ? listReplies.shift()! : listReplies[0]; p = reply(r.status, r.json ?? {}); }
    else if (url === '/api/app/connected-apps/browse') {
      p = reply(200, { items: call.body?.folder_id === 'fold-1'
        ? [{ id: 'file-1', name: 'Cap Statement.pdf', kind: 'file', size: 10, modified: null }]
        : [{ id: 'fold-1', name: 'Proposals', kind: 'folder', size: null, modified: null }] });
    } else if (url === '/api/app/connected-apps/selections') p = reply(200, { file_handle: 'fh1.handle.sig', file: { name: 'Cap Statement.pdf' } });
    else if (url === '/api/app/connected-apps/start') p = reply(200, { authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', access_note: 'Google will let Mindy open only the files you pick.' });
    else if (url.startsWith('/api/app/vault/doc-access')) p = reply(200, { success: true, uploads: false });
    else if (url === '/api/app/chat') {
      const enc = new NodeTextEncoder();
      const text = ['{"type":"token","content":"ok"}', '{"type":"done"}'].map((e) => `data: ${e}\n\n`).join('');
      p = Promise.resolve({ ok: true, status: 200, body: new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close(); } }), json: async () => ({}) });
    } else p = reply(200, {});
    pending.push(p.catch(() => undefined));
    return p;
  }) as never;
  w.eval(drawerScript());
  if (opts.open !== false) (w as unknown as { openAskMindy: () => void }).openAskMindy();
  const doc = w.document;
  const settle = async () => { for (let i = 0; i < 10; i++) { await Promise.all(pending); await new Promise((r) => setTimeout(r, 0)); } };
  const btn = (text: string) => [...doc.querySelectorAll('.amk-cf button')].find((b) => (b.textContent || '').includes(text)) as HTMLButtonElement | undefined;
  const click = async (b: HTMLElement | undefined) => { expect(b).toBeTruthy(); b!.click(); await settle(); };
  async function askQ(q: string) {
    (doc.getElementById('amkIn') as HTMLTextAreaElement).value = q;
    (doc.getElementById('amkSend') as HTMLButtonElement).click();
    await settle();
    return calls.filter((c) => c.url === '/api/app/chat').pop()?.body;
  }
  return { w, doc, calls, settle, btn, click, askQ };
}

describe('Map drawer: connected files', () => {
  it('no request until the drawer opens', async () => {
    const { settle, calls } = boot({ open: false });
    await settle();
    expect(calls.some((c) => c.url.startsWith('/api/app/connected-apps'))).toBe(false);
  });

  it('feature off for this account (list 404) → no row at all', async () => {
    const { doc, settle } = boot({ list: [{ status: 404, json: { error: 'not_enabled' } }] });
    await settle();
    expect(doc.querySelector('[data-testid="amk-connected-files"]')).toBeNull();
  });

  it('right after sign-in a 401 is retried, then the row appears', async () => {
    const { doc, settle, calls } = boot({ list: [{ status: 401 }, { status: 200, json: ON }] });
    await settle();
    expect(doc.querySelector('[data-testid="amk-connected-files"]')).toBeNull();
    await new Promise((r) => setTimeout(r, 1700));
    await settle();
    expect(doc.querySelector('[data-testid="amk-connected-files"]')).not.toBeNull();
    expect(calls.filter((c) => c.url.startsWith('/api/app/connected-apps?')).length).toBe(2);
  });

  it('menu: pick from the connected OneDrive, connect the other provider', async () => {
    const { settle, btn, click } = boot();
    await settle();
    await click(btn('Use a file from Drive or OneDrive'));
    expect(btn('Pick from OneDrive (me@onedrive.com)')).toBeTruthy();
    expect(btn('Connect Google Drive')).toBeTruthy();
  });

  it('Connect shows the access note and does not leave the Map until Continue', async () => {
    const { settle, btn, click, calls, doc } = boot();
    await settle();
    await click(btn('Use a file from Drive or OneDrive'));
    await click(btn('Connect Google Drive'));
    const start = calls.find((c) => c.url === '/api/app/connected-apps/start');
    expect(start?.body).toMatchObject({ email: ME, provider: 'google', capabilities: ['file'], returnTo: '/opportunity-map' });
    expect(doc.querySelector('.amk-cf-note')?.textContent).toContain('only the files you pick');
    expect(btn('Continue to Google')).toBeTruthy();
    await click(btn('Cancel'));
    expect((doc.querySelector('.amk-cf-note') as HTMLElement).hidden).toBe(true);
  });

  it('OneDrive pick → chip → the next question carries connectedFiles; removing the chip stops it', async () => {
    const { settle, btn, click, doc, askQ, calls } = boot();
    await settle();
    await click(btn('Use a file from Drive or OneDrive'));
    await click(btn('Pick from OneDrive'));
    await click(btn('Proposals'));
    await click(btn('Cap Statement.pdf'));
    expect(calls.find((c) => c.url === '/api/app/connected-apps/selections')?.body).toEqual({ email: ME, connection_id: 'conn-ms', file_id: 'file-1' });
    const chips = [...doc.querySelectorAll('[data-testid="amk-cf-file"]')].map((c) => c.textContent);
    expect(chips).toEqual(['Cap Statement.pdf×']);
    const body = await askQ('What fits us in Florida?');
    expect(body?.connectedFiles).toEqual(['fh1.handle.sig']);
    // The Microsoft token never reaches the browser: only handles and item names did.
    expect(JSON.stringify(calls)).not.toMatch(/access_token/);
    await click(doc.querySelector('[data-testid="amk-cf-file"] button') as HTMLElement);
    const body2 = await askQ('And Georgia?');
    expect(body2?.connectedFiles).toBeUndefined();
  });

  it('back from the provider (?connect=ok): says so, reopens the drawer, cleans the address bar', async () => {
    const { settle, doc, w } = boot({ url: 'https://getmindy.ai/opportunity-map?connect=ok&provider=google&connection=c1', open: false });
    await settle();
    expect(doc.querySelector('.amk-cf-msg')?.textContent).toBe('Google Drive is connected. Pick a file to use it in this conversation.');
    expect(doc.getElementById('amk')?.classList.contains('show')).toBe(true);
    expect((w.location as Location).search).toBe('');
  });

  it('a refused connection says why in plain words', async () => {
    const { settle, doc } = boot({ url: 'https://getmindy.ai/opportunity-map?connect=error&reason=access_denied', open: false });
    await settle();
    expect(doc.querySelector('.amk-cf-msg')?.textContent).toBe('You cancelled the connection. Nothing was connected.');
  });
});
