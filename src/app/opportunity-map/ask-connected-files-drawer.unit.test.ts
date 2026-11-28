/**
 * Map drawer: Google Drive / OneDrive (CONNECTED_APPS, Eric 2026-11-28) — the REAL drawer script (ASK_MINDY_JS) in jsdom.
 * Mirrors src/components/app/chat/connected-files.unit.test.tsx for the parts the Map has:
 *   - no control unless the capability check says connected_files AND GET /api/app/connected-apps lists a connected account;
 *   - Google: the picker token, Google's own Picker, then POST /selections → a chip; the handle rides with the question;
 *   - OneDrive: Mindy's server-side chooser (POST /browse) → POST /selections → a chip;
 *   - a grant known to lack file access, a provider 403 or reauth_needed → "Reconnect … to allow file access" in the panel
 *     (the access note first, then the provider), never a raw provider page; a first connect stays in Ask Mindy in the app;
 *   - picks belong to THIS conversation: New chat starts empty.
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

type Reply = { status: number; json: Record<string, unknown> };
type Conn = { id: string; provider: 'google' | 'microsoft'; connected_email: string; status: string; granted_scopes?: string[] };
const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';

function boot(opts: { caps?: boolean; list?: Reply; pickerToken?: Reply; selections?: Reply; browse?: Reply; start?: Reply; pickedId?: string } = {}) {
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
  // Google's Picker, stubbed: building it and making it visible "picks" the configured file.
  let pickerCb: ((d: Record<string, unknown>) => void) | null = null;
  const G = { Response: { ACTION: 'action', DOCUMENTS: 'docs' }, Action: { PICKED: 'picked' }, Document: { ID: 'id' }, ViewId: { DOCS: 'docs' } };
  class DocsView { setIncludeFolders() { return this; } setMimeTypes() { return this; } }
  class PickerBuilder {
    addView() { return this; } setOAuthToken() { return this; } setDeveloperKey() { return this; } setAppId() { return this; } setTitle() { return this; }
    setCallback(cb: (d: Record<string, unknown>) => void) { pickerCb = cb; return this; }
    build() { return { setVisible: () => { pickerCb?.({ action: 'picked', docs: [{ id: opts.pickedId ?? 'gfile-1' }] }); } }; }
  }
  (w as unknown as { gapi: unknown }).gapi = { load: (_l: string, cb: () => void) => cb() };
  (w as unknown as { google: unknown }).google = { picker: { ...G, DocsView, PickerBuilder } };

  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  const pending: Promise<unknown>[] = [];
  const reply = (r: Reply) => Promise.resolve({ ok: r.status < 300, status: r.status, json: async () => r.json });
  w.fetch = vi.fn((url: string, init: { method?: string; body?: unknown }) => {
    const method = init?.method || 'GET';
    calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    let p: Promise<unknown>;
    if (url.startsWith('/api/app/connected-apps/picker-token')) p = reply(opts.pickerToken ?? { status: 200, json: { access_token: 't', developer_key: 'k', app_id: 'a' } });
    else if (url.startsWith('/api/app/connected-apps/selections')) p = reply(opts.selections ?? { status: 200, json: { file_handle: 'h-1', file: { name: 'Capability Statement.pdf' } } });
    else if (url.startsWith('/api/app/connected-apps/start')) p = reply(opts.start ?? { status: 200, json: { authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', access_note: 'Google will let Mindy open only the files you pick.' } });
    else if (url.startsWith('/api/app/connected-apps/browse')) p = reply(opts.browse ?? { status: 200, json: { items: [{ id: 'f1', name: 'Proposals', kind: 'folder' }, { id: 'd1', name: 'Past performance.docx', kind: 'file' }] } });
    else if (url.startsWith('/api/app/connected-apps')) p = reply(opts.list ?? { status: 404, json: {} });
    else if (url.startsWith('/api/app/chat/capabilities')) p = reply({ status: 200, json: { success: true, screenshots: false, actions: false, connected_files: opts.caps ?? !!opts.list } });
    else if (url.startsWith('/api/app/vault/doc-access')) p = reply({ status: 200, json: {} });
    else if (url.startsWith('/api/app/chat/suggestions')) p = reply({ status: 200, json: { suggestions: [] } });
    else {
      const enc = new NodeTextEncoder();
      const text = ['{"type":"token","content":"ok"}', '{"type":"done"}'].map((e) => `data: ${e}\n\n`).join('');
      p = Promise.resolve({ ok: true, status: 200, body: new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close(); } }), json: async () => ({}) });
    }
    pending.push(p.catch(() => undefined));
    return p;
  }) as never;
  w.eval(drawerScript());
  const settle = async () => { for (let i = 0; i < 10; i++) { await Promise.all(pending); await new Promise((r) => setTimeout(r, 0)); } };
  const doc = w.document;
  const q = (sel: string) => doc.querySelector(sel) as HTMLElement | null;
  const ask = async (text: string) => { (doc.getElementById('amkIn') as HTMLTextAreaElement).value = text; (doc.getElementById('amkSend') as HTMLButtonElement).click(); await settle(); };
  const chatBodies = () => calls.filter((c) => c.url === '/api/app/chat' && c.method === 'POST').map((c) => c.body!);
  return { w, doc, q, calls, settle, ask, chatBodies };
}
const listWith = (connections: Conn[]): Reply => ({ status: 200, json: { connections, providers: [{ provider: 'google', available: true }, { provider: 'microsoft', available: true }] } });
const google = (scopes: string[] = [DRIVE_FILE], status = 'connected'): Conn => ({ id: 'c-g', provider: 'google', connected_email: 'pat@acme.example.com', status, granted_scopes: scopes });
const onedrive = (scopes: string[] = ['Files.Read']): Conn => ({ id: 'c-m', provider: 'microsoft', connected_email: 'pat@acme.example.com', status: 'connected', granted_scopes: scopes });
const open = async (t: ReturnType<typeof boot>) => { (t.w as unknown as { openAskMindy: () => void }).openAskMindy(); await t.settle(); };

describe('Map drawer: Drive / OneDrive', () => {
  it('no control, and no account list request, when connected files are off for this account', async () => {
    const t = boot({ caps: false, list: listWith([google()]) });
    await open(t);
    expect(t.q('[data-testid="amk-drive"]')).toBeNull();
    expect(t.calls.some((c) => c.url.startsWith('/api/app/connected-apps'))).toBe(false);
  });

  it('no control when the capability says on but the list endpoint refuses (404)', async () => {
    const t = boot({ caps: true });
    await open(t);
    expect(t.q('[data-testid="amk-drive"]')).toBeNull();
  });

  it('no control when no account is connected (connecting stays in Ask Mindy)', async () => {
    const t = boot({ list: listWith([]) });
    await open(t);
    expect(t.q('[data-testid="amk-drive"]')).toBeNull();
  });

  it('Google: pick → chip → the handle rides with the next question; remove drops it', async () => {
    const t = boot({ list: listWith([google()]) });
    await open(t);
    t.q('[data-testid="amk-drive-open"]')!.click();
    const pick = t.q('[data-testid="amk-drive-pick-google"]')!;
    expect(pick.textContent).toBe('Pick from Google Drive (pat@acme.example.com)');
    pick.click();
    await t.settle();
    const sel = t.calls.find((c) => c.url === '/api/app/connected-apps/selections')!;
    expect(sel.body).toMatchObject({ email: 'pro@example.com', connection_id: 'c-g', file_id: 'gfile-1' });
    expect(t.q('[data-testid="amk-drive-file"]')!.textContent).toContain('Capability Statement.pdf');
    await t.ask('Summarize my capability statement');
    expect(t.chatBodies()[0].connectedFiles).toEqual(['h-1']);
    (t.q('[data-testid="amk-drive-file"] button') as HTMLButtonElement).click();
    expect(t.q('[data-testid="amk-drive-file"]')).toBeNull();
    await t.ask('And again');
    expect(t.chatBodies()[1].connectedFiles).toBeUndefined();
  });

  it('a grant known to lack drive.file offers "Reconnect … to allow file access": the access note first, then the provider', async () => {
    const t = boot({ list: listWith([google(['openid', 'email'])]) });
    await open(t);
    t.q('[data-testid="amk-drive-open"]')!.click();
    expect(t.q('[data-testid="amk-drive-pick-google"]')).toBeNull();
    const re = t.q('[data-testid="amk-drive-reconnect"]')!;
    expect(re.textContent).toBe('Reconnect Google Drive to allow file access (pat@acme.example.com)');
    re.click();
    await t.settle();
    const start = t.calls.find((c) => c.url === '/api/app/connected-apps/start')!;
    expect(start.body).toEqual({ email: 'pro@example.com', provider: 'google', capabilities: ['file'], returnTo: '/opportunity-map' });
    const consent = t.q('[data-testid="amk-drive-consent"]')!;
    expect(consent.hidden).toBe(false);
    expect(consent.textContent).toContain('Google will let Mindy open only the files you pick.');
    expect(t.q('[data-testid="amk-drive-continue"]')!.textContent).toBe('Continue to Google');
    (t.q('[data-testid="amk-drive-cancel"]') as HTMLButtonElement).click();
    expect(t.q('[data-testid="amk-drive-consent"]')!.hidden).toBe(true);
    expect(MAP).not.toMatch(/href='\/app\?panel=chat'/); // the Map never hands Ask off to the /app chat
  });

  it('unknown scopes (none listed) still show the picker', async () => {
    const t = boot({ list: listWith([google([])]) });
    await open(t);
    t.q('[data-testid="amk-drive-open"]')!.click();
    expect(t.q('[data-testid="amk-drive-pick-google"]')).toBeTruthy();
  });

  it('a refused picker token shows the plain message, then the reconnect link; no raw provider page', async () => {
    const t = boot({ list: listWith([google()]), pickerToken: { status: 403, json: { error: 'file_permission_needed' } } });
    await open(t);
    t.q('[data-testid="amk-drive-open"]')!.click();
    t.q('[data-testid="amk-drive-pick-google"]')!.click();
    await t.settle();
    expect(t.q('.amk-drive-msg')!.textContent).toMatch(/does not have permission to open files in this account/);
    expect(t.calls.some((c) => c.url === '/api/app/connected-apps/selections')).toBe(false);
    t.q('[data-testid="amk-drive-open"]')!.click();
    expect(t.q('[data-testid="amk-drive-reconnect"]')).toBeTruthy();
    expect(t.q('[data-testid="amk-drive-pick-google"]')).toBeNull();
  });

  it('reauth_needed shows only the reconnect link', async () => {
    const t = boot({ list: listWith([google([DRIVE_FILE], 'reauth_needed')]) });
    await open(t);
    t.q('[data-testid="amk-drive-open"]')!.click();
    expect(t.q('[data-testid="amk-drive-reconnect"]')).toBeTruthy();
    expect(t.q('[data-testid="amk-drive-pick-google"]')).toBeNull();
  });

  it('OneDrive: server-side chooser → pick a file → chip and handle; the chooser closes', async () => {
    const t = boot({ list: listWith([onedrive()]), selections: { status: 200, json: { file_handle: 'h-od', file: { name: 'Past performance.docx' } } } });
    await open(t);
    t.q('[data-testid="amk-drive-open"]')!.click();
    t.q('[data-testid="amk-drive-pick-onedrive"]')!.click();
    await t.settle();
    const browse = t.calls.find((c) => c.url === '/api/app/connected-apps/browse')!;
    expect(browse.body).toEqual({ email: 'pro@example.com', connection_id: 'c-m' });
    const file = [...t.doc.querySelectorAll('.amk-od-item')].find((b) => b.getAttribute('data-kind') === 'file') as HTMLButtonElement;
    file.click();
    await t.settle();
    expect(t.calls.find((c) => c.url === '/api/app/connected-apps/selections')!.body).toMatchObject({ connection_id: 'c-m', file_id: 'd1' });
    expect(t.q('[data-testid="amk-drive-file"]')!.textContent).toContain('Past performance.docx');
    expect((t.q('.amk-drive-od') as HTMLElement).hidden).toBe(true);
    await t.ask('Use this');
    expect(t.chatBodies()[0].connectedFiles).toEqual(['h-od']);
  });

  it('OneDrive: a 403 from the listing closes the chooser with the plain message and offers the reconnect', async () => {
    const t = boot({ list: listWith([onedrive()]), browse: { status: 403, json: { error: 'file_permission_needed' } } });
    await open(t);
    t.q('[data-testid="amk-drive-open"]')!.click();
    t.q('[data-testid="amk-drive-pick-onedrive"]')!.click();
    await t.settle();
    expect((t.q('.amk-drive-od') as HTMLElement).hidden).toBe(true);
    expect(t.q('.amk-drive-msg')!.textContent).toMatch(/does not have permission to open files in this account/);
    t.q('[data-testid="amk-drive-open"]')!.click();
    expect(t.q('[data-testid="amk-drive-reconnect"]')!.textContent).toBe('Reconnect OneDrive to allow file access (pat@acme.example.com)');
  });

  it('picks belong to this conversation: New chat starts without them', async () => {
    const t = boot({ list: listWith([google()]) });
    await open(t);
    t.q('[data-testid="amk-drive-open"]')!.click();
    t.q('[data-testid="amk-drive-pick-google"]')!.click();
    await t.settle();
    await t.ask('First question');
    expect(t.q('[data-testid="amk-drive-file"]')).toBeTruthy();
    (t.q('[data-testid="amk-new-chat"]') as HTMLButtonElement).click();
    await t.settle();
    expect(t.q('[data-testid="amk-drive-file"]')).toBeNull();
    await t.ask('Fresh question');
    expect(t.chatBodies().at(-1)!.connectedFiles).toBeUndefined();
  });

  it('never stores picks in the browser and never reveals timers (ES5, no JS reveal)', () => {
    const js = drawerScript();
    const a = js.indexOf('var amkDrive=null;');
    const b = js.indexOf('// Pasted screenshots (view mode only)', a);
    const mod = js.slice(a, b);
    expect(mod).not.toMatch(/localStorage\.setItem|sessionStorage/);
    expect(mod).not.toMatch(/=>|\blet\b|\bconst\b|`/);
    expect(mod).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
  });
});
