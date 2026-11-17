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
function boot(opts: { flag: boolean; uploadReply?: { status: number; json: Record<string, unknown> }; store?: Record<string, string> }) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="amkOv"></div><aside id="amk" aria-hidden="true"><div id="amkCtx"></div><button id="amkX"></button>'
    + '<div id="amkBody"></div><div class="amk-foot"><div class="amk-in"><textarea id="amkIn"></textarea><button id="amkSend"></button></div></div></aside></body></html>',
    { url: 'https://getmindy.ai/opportunity-map', runScripts: 'outside-only' },
  );
  const w = dom.window as unknown as Record<string, unknown> & Window & { eval: (s: string) => unknown };
  const store: Record<string, string> = { mi_beta_auth_token: token('pro@example.com'), ...(opts.store ?? {}) };
  Object.defineProperty(w, 'localStorage', { value: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } });
  w.TextDecoder = NodeTextDecoder as never;
  w.__VAULT_ATTACH = opts.flag;
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
    if (url.startsWith('/api/app/chat/documents')) {
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
    pending.push(p);
    return p;
  }) as never;
  w.eval(drawerScript());
  const settle = async () => { for (let i = 0; i < 8; i++) { await Promise.all(pending); await new Promise((r) => setTimeout(r, 0)); } };
  const doc = w.document;
  async function attach(name: string, size = 10) {
    const input = doc.querySelector('.amk-attach input[type=file]') as HTMLInputElement;
    const file = new w.File(['x'.repeat(size)], name, { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new w.Event('change'));
    await settle();
  }
  return { w, doc, calls, settle, attach };
}

describe('Map drawer attach', () => {
  it('flag off → no attach row at all', () => {
    const { doc } = boot({ flag: false });
    expect(doc.querySelector('[data-testid="amk-attach"]')).toBeNull();
  });

  it('flag on → says "Saved privately to your Vault"', () => {
    const { doc } = boot({ flag: true });
    expect(doc.querySelector('[data-testid="amk-attach"]')?.textContent).toContain('Saved privately to your Vault');
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

  it('coach working AS A CLIENT: attach is disabled with a pointer to the main panel; nothing is uploaded (never the coach\'s own Vault)', async () => {
    const { doc, calls, attach } = boot({ flag: true, store: { mindy_active_workspace: 'ws-client-1', mindy_active_workspace_owner: 'pro@example.com' } });
    const row = doc.querySelector('[data-testid="amk-attach"]') as HTMLElement;
    const clip = row.querySelector('.amk-clip') as HTMLButtonElement;
    expect(row.getAttribute('data-client-mode')).toBe('1');
    expect(clip.disabled).toBe(true);
    expect(row.textContent).toContain('Switch to the main Ask Mindy panel to attach files for this client.');
    await attach('client-sow.pdf'); // even a forced change event uploads nothing
    expect(calls.some((c) => c.url.startsWith('/api/app/chat/documents') && c.method === 'POST')).toBe(false);
  });

  it('a workspace stamp left by ANOTHER user does not block the owner (same rule as #2101)', () => {
    const { doc } = boot({ flag: true, store: { mindy_active_workspace: 'ws-x', mindy_active_workspace_owner: 'someone@else.com' } });
    expect((doc.querySelector('.amk-clip') as HTMLButtonElement).disabled).toBe(false);
  });

  it('own workspace: the upload carries no x-active-workspace (matches the drawer chat scope)', async () => {
    const { calls, attach, w } = boot({ flag: true });
    await attach('sow.pdf');
    const f = (w.fetch as unknown as { mock: { calls: Array<[string, { headers?: Record<string, string> }]> } }).mock.calls.find(([u, i]) => u.startsWith('/api/app/chat/documents') && (i as { method?: string }).method === 'POST')!;
    expect(f[1].headers?.['x-active-workspace']).toBeUndefined();
    expect(calls.length).toBeGreaterThan(0);
  });
});
