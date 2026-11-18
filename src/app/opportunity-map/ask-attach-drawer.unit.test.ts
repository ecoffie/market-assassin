/**
 * Map drawer "Attach" — the REAL drawer script (ASK_MINDY_JS) in jsdom.
 * Flag off → no attach row. Flag on → "Saved privately to your Vault", a file uploads to THIS
 * conversation (minting one for a new chat), a refusal shows the server reason, remove sends DELETE,
 * and the next question carries the same conversation id so the documents ground the answer.
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

type Call = { url: string; method: string; file?: string; body?: Record<string, unknown> };
function boot(opts: { flag: boolean; signedIn?: boolean; accessFails?: boolean; uploadReply?: { status: number; json: Record<string, unknown> }; store?: Record<string, string> }) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="amkOv"></div><aside id="amk" aria-hidden="true"><div id="amkCtx"></div><button id="amkX"></button>'
    + '<div id="amkBody"></div><div class="amk-foot"><div class="amk-in"><textarea id="amkIn"></textarea><button id="amkSend"></button></div></div></aside></body></html>',
    { url: 'https://getmindy.ai/opportunity-map', runScripts: 'outside-only' },
  );
  const w = dom.window as unknown as Record<string, unknown> & Window & { eval: (s: string) => unknown };
  const store: Record<string, string> = { ...(opts.signedIn === false ? {} : { mi_beta_auth_token: token('pro@example.com') }), ...(opts.store ?? {}) };
  Object.defineProperty(w, 'localStorage', { value: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } });
  w.TextDecoder = NodeTextDecoder as never;
  w.__mindyViewCtx = () => ({ count: 3, scope: 'all' });
  const calls: Call[] = [];
  const pending: Promise<unknown>[] = [];
  w.fetch = vi.fn((url: string, init: { method?: string; body?: unknown }) => {
    const method = init?.method || 'GET';
    const isForm = init?.body && typeof (init.body as { get?: unknown }).get === 'function';
    const call: Call = { url, method };
    if (isForm) call.file = ((init.body as FormData).get('file') as File).name;
    else if (typeof init?.body === 'string') call.body = JSON.parse(init.body);
    calls.push(call);
    let p: Promise<unknown>;
    if (url.startsWith('/api/app/vault/doc-access')) {
      // The server capability check: the drawer's ONLY source of on/off for the attach row.
      p = opts.accessFails ? Promise.reject(new Error('network')) : Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, uploads: opts.flag, generate: false }) });
    } else if (url.startsWith('/api/app/chat/documents')) {
      if (method === 'POST') {
        const r = opts.uploadReply ?? { status: 201, json: { success: true, document: { id: 'd1', filename: 'sow.pdf' } } };
        p = Promise.resolve({ ok: r.status < 300, status: r.status, json: async () => r.json });
      } else if (method === 'DELETE') p = Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
      else p = Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, documents: [] }) });
    } else {
      const enc = new NodeTextEncoder();
      const text = ['{"type":"token","content":"ok"}', '{"type":"done"}'].map((e) => `data: ${e}\n\n`).join('');
      p = Promise.resolve({ ok: true, status: 200, body: new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close(); } }), json: async () => ({}) });
    }
    pending.push(p.catch(() => undefined)); // settle() waits; a simulated failure must not reject the harness
    return p;
  }) as never;
  w.eval(drawerScript());
  const settle = async () => { for (let i = 0; i < 8; i++) { await Promise.all(pending); await new Promise((r) => setTimeout(r, 0)); } };
  const doc = w.document;
  async function attach(name: string, size = 10) {
    await settle(); // the attach row exists only after the server capability check resolves
    const input = doc.querySelector('.amk-attach input[type=file]') as HTMLInputElement;
    const file = new w.File(['x'.repeat(size)], name, { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new w.Event('change'));
    await settle();
  }
  return { w, doc, calls, settle, attach };
}

describe('Map drawer attach', () => {
  it('server says no (flag off or not allowlisted) → no attach row at all', async () => {
    const { doc, calls, settle } = boot({ flag: false });
    await settle();
    expect(calls.some((c) => c.url.startsWith('/api/app/vault/doc-access?email=pro%40example.com'))).toBe(true);
    expect(doc.querySelector('[data-testid="amk-attach"]')).toBeNull();
  });

  it('server says yes → says "Saved privately to your Vault"', async () => {
    const { doc, settle } = boot({ flag: true });
    await settle();
    expect(doc.querySelector('[data-testid="amk-attach"]')?.textContent).toContain('Saved privately to your Vault');
  });

  it('nothing is baked into the page: no window flag turns the row on, and a failed check shows nothing', async () => {
    expect(MAP).not.toContain('__VAULT_ATTACH');
    expect(MAP).not.toContain('NEXT_PUBLIC_VAULT_ASK_MINDY_UPLOADS');
    const failed = boot({ flag: true, accessFails: true });
    await failed.settle();
    expect(failed.doc.querySelector('[data-testid="amk-attach"]')).toBeNull();
  });

  it('signed out → no check and no row', async () => {
    const { doc, calls, settle } = boot({ flag: true, signedIn: false });
    await settle();
    expect(calls.some((c) => c.url.startsWith('/api/app/vault/doc-access'))).toBe(false);
    expect(doc.querySelector('[data-testid="amk-attach"]')).toBeNull();
  });

  it('new chat: mints a conversation id, uploads to it, and the next question uses the SAME id', async () => {
    const { doc, calls, attach, settle, w } = boot({ flag: true });
    await attach('sow.pdf');
    const post = calls.find((c) => c.method === 'POST' && c.url.startsWith('/api/app/chat/documents'))!;
    expect(post.file).toBe('sow.pdf');
    const sid = new URL(post.url, 'https://x').searchParams.get('session_id')!;
    expect(sid).toMatch(/^[0-9a-f-]{36}$/);
    expect(doc.querySelectorAll('[data-testid="amk-doc"]')).toHaveLength(1);
    (doc.getElementById('amkIn') as HTMLTextAreaElement).value = 'What is the page limit?';
    (doc.getElementById('amkSend') as HTMLButtonElement).click();
    await settle();
    const chat = calls.find((c) => c.url === '/api/app/chat')!;
    expect(chat.body?.sessionId).toBe(sid);
    void w;
  });

  it('a refused file shows the server reason and adds no chip', async () => {
    const { doc, attach } = boot({ flag: true, uploadReply: { status: 422, json: { success: false, error: 'prohibited_marking', message: 'This file carries a classification marking, so Mindy did not accept it. Nothing from this file was saved.' } } });
    await attach('brief.pdf');
    expect(doc.querySelector('.amk-attach-err')?.textContent).toMatch(/classification marking.*Nothing from this file was saved/);
    expect(doc.querySelectorAll('[data-testid="amk-doc"]')).toHaveLength(0);
  });

  it('over 4 MB is stopped in the browser; nothing is sent', async () => {
    const { doc, calls, attach } = boot({ flag: true });
    await attach('big.pdf', 4 * 1024 * 1024 + 1);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(doc.querySelector('.amk-attach-err')?.textContent).toMatch(/up to 4 MB/);
  });

  it('remove sends DELETE for that conversation and document', async () => {
    const { doc, calls, attach, settle } = boot({ flag: true });
    await attach('sow.pdf');
    (doc.querySelector('[data-testid="amk-doc"] button') as HTMLButtonElement).click();
    await settle();
    const del = calls.find((c) => c.method === 'DELETE')!;
    expect(del.url).toContain('id=d1');
    expect(doc.querySelectorAll('[data-testid="amk-doc"]')).toHaveLength(0);
  });

  // Server half (already pinned in #2112): an authorized coach's upload is stored under the CLIENT's Vault
  // email (chat-documents-upload.route.unit.test.ts) and chat reads documents under the CLIENT scope
  // (chat-documents.route.unit.test.ts); an unconfirmed header is 409 on upload. This pins the browser half:
  // the drawer sends the active workspace on BOTH its chat and its upload requests.
  const headersOf = (w: Record<string, unknown>, pred: (u: string, i: { method?: string }) => boolean) =>
    ((w.fetch as unknown as { mock: { calls: Array<[string, { method?: string; headers?: Record<string, string> }]> } }).mock.calls
      .filter(([u, i]) => pred(u, i)).map(([, i]) => i.headers ?? {}));

  it('coach working AS A CLIENT: the drawer upload AND the drawer chat both carry x-active-workspace', async () => {
    const { doc, attach, settle, w } = boot({ flag: true, store: { mindy_active_workspace: 'ws-client-1', mindy_active_workspace_owner: 'pro@example.com' } });
    await attach('client-sow.pdf');
    (doc.getElementById('amkIn') as HTMLTextAreaElement).value = 'Summarize the attached SOW';
    (doc.getElementById('amkSend') as HTMLButtonElement).click();
    await settle();
    const up = headersOf(w, (u, i) => u.startsWith('/api/app/chat/documents') && i.method === 'POST');
    const chat = headersOf(w, (u) => u === '/api/app/chat');
    expect(up).toHaveLength(1);
    expect(up[0]['x-active-workspace']).toBe('ws-client-1');
    expect(chat).toHaveLength(1);
    expect(chat[0]['x-active-workspace']).toBe('ws-client-1');
  });

  it('a workspace stamp left by ANOTHER user is not sent (same rule as #2101)', async () => {
    const { doc, attach, settle, w } = boot({ flag: true, store: { mindy_active_workspace: 'ws-x', mindy_active_workspace_owner: 'someone@else.com' } });
    await attach('sow.pdf');
    (doc.getElementById('amkIn') as HTMLTextAreaElement).value = 'hi';
    (doc.getElementById('amkSend') as HTMLButtonElement).click();
    await settle();
    for (const h of headersOf(w, (u) => u.startsWith('/api/app/chat'))) expect(h['x-active-workspace']).toBeUndefined();
  });

  it('own workspace: no x-active-workspace on upload or chat', async () => {
    const { doc, attach, settle, w } = boot({ flag: true });
    await attach('sow.pdf');
    (doc.getElementById('amkIn') as HTMLTextAreaElement).value = 'hi';
    (doc.getElementById('amkSend') as HTMLButtonElement).click();
    await settle();
    for (const h of headersOf(w, (u) => u.startsWith('/api/app/chat'))) expect(h['x-active-workspace']).toBeUndefined();
  });

  it('an unconfirmed workspace (server 409) shows the reason and adds no chip — never filed elsewhere', async () => {
    const { doc, attach } = boot({ flag: true, store: { mindy_active_workspace: 'ws-gone' }, uploadReply: { status: 409, json: { success: false, error: 'workspace_unconfirmed', message: "The active workspace couldn't be confirmed, so no Vault, profile or pursuit data was loaded. Ask the user to retry." } } });
    await attach('sow.pdf');
    expect(doc.querySelector('.amk-attach-err')?.textContent).toMatch(/couldn't be confirmed/);
    expect(doc.querySelectorAll('[data-testid="amk-doc"]')).toHaveLength(0);
  });
});
