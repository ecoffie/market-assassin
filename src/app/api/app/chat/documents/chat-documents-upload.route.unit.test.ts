/**
 * /api/app/chat/documents — attach, list and archive conversation documents, saved to the VAULT.
 * Real handler + real shared upload helper (src/lib/vault/upload.ts); auth, entitlement, acting scope,
 * the KV limiter and the database/storage are faked.
 *
 * Proves: flag off → 404; STRONG auth is required; Pro gate; strict scope (unauthorized header or a
 * resolver error → 409, nothing stored, no conversation created); an authorized coach stores into the
 * CLIENT's Vault; rows are doc_class='reference', source='ask_mindy', chat_session_id = the conversation;
 * a classification/CUI-marked file stores NOTHING (no blob, no row, no new conversation); another
 * user's conversation answers like a missing one; metadata only goes back to the browser.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const ME = 'pro@example.com';
const SID = '0b0b0b0b-1111-4222-8333-444444444444';
const DOC = '0d0d0d0d-1111-4222-8333-444444444444';
const CLIENT_EMAIL = 'ws-1@clients.getmindy.ai';

const state = vi.hoisted(() => ({
  pro: true,
  strongAuthAsked: [] as unknown[],
  scope: 'own' as 'own' | 'client' | 'unavailable',
  sessionOwner: null as string | null,
  sessionInserts: [] as Array<Record<string, unknown>>,
  docInserts: [] as Array<Record<string, unknown>>,
  blobs: [] as string[],
  count: 0 as number | 'unavailable',
  listed: [] as Array<{ sessionId: string; ownerEmail: string }>,
  archived: [] as Array<{ id: string; sessionId: string; ownerEmail: string }>,
}));

vi.mock('@/lib/api-auth', () => ({
  verifyUserOwnsEmail: async (_r: unknown, email: string, opts: unknown) => { state.strongAuthAsked.push(opts); return { authenticated: true, email }; },
}));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: async () => state.pro }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async (_k: string, limit: number) => ({ allowed: true, remaining: limit, limit, resetAt: 0 }) }));
vi.mock('@/lib/chat/chat-acting-scope', async (orig) => ({
  ...(await orig<object>()),
  resolveChatActingScope: async (email: string) =>
    state.scope === 'client' ? { kind: 'client', email, workspaceId: 'ws-1', vaultEmail: CLIENT_EMAIL }
      : state.scope === 'unavailable' ? { kind: 'unavailable', email } : { kind: 'own', email },
}));
vi.mock('@/lib/vault/chat-store', async (orig) => ({
  ...(await orig<object>()),
  countSessionDocuments: async () => (state.count === 'unavailable' ? { ok: false, reason: 'unavailable', message: 'x' } : { ok: true, value: state.count }),
  listChatDocuments: async (_db: unknown, scope: { sessionId: string; ownerEmail: string }) => { state.listed.push(scope); return { ok: true, value: [] }; },
  archiveChatDocument: async (_db: unknown, scope: { id: string; sessionId: string; ownerEmail: string }) => { state.archived.push(scope); return { ok: true, value: true }; },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: state.sessionOwner ? { id: SID, user_email: state.sessionOwner } : null, error: null });
      q.insert = (row: Record<string, unknown>) => {
        if (table === 'mindy_chat_sessions') { state.sessionInserts.push(row); return Promise.resolve({ error: null }); }
        state.docInserts.push(row);
        return { select: () => ({ maybeSingle: async () => ({ data: { id: DOC, created_at: 'now', ...row }, error: null }) }) };
      };
      return q;
    },
    storage: {
      listBuckets: async () => ({ data: [{ name: 'vault-assets' }] }),
      createBucket: async () => ({ error: null }),
      from: () => ({
        upload: async (path: string) => { state.blobs.push(path); return { error: null }; },
        remove: async () => ({ error: null }),
      }),
    },
  }),
}));

import { POST, GET, DELETE } from './route';

function req(method: string, opts: { file?: { name: string; text: string }; headers?: Record<string, string>; query?: string } = {}) {
  const url = `https://getmindy.ai/api/app/chat/documents?email=${encodeURIComponent(ME)}&session_id=${SID}${opts.query ?? ''}`;
  let body: FormData | undefined;
  if (opts.file) { body = new FormData(); body.append('file', new File([opts.file.text], opts.file.name, { type: 'text/plain' })); }
  return new NextRequest(url, { method, body, headers: opts.headers });
}
const txt = (text = 'Section L: proposals are due December 4. Page limit 20.') => ({ name: 'rfp.txt', text });

beforeEach(() => {
  vi.stubEnv('VAULT_ASK_MINDY_UPLOADS', 'true');
  Object.assign(state, { pro: true, scope: 'own', sessionOwner: null, count: 0 });
  state.strongAuthAsked = []; state.sessionInserts = []; state.docInserts = []; state.blobs = []; state.listed = []; state.archived = [];
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/app/chat/documents (Vault-backed)', () => {
  it('flag off → 404, nothing touched', async () => {
    vi.stubEnv('VAULT_ASK_MINDY_UPLOADS', '');
    expect((await POST(req('POST', { file: txt() }))).status).toBe(404);
    expect(state.strongAuthAsked).toEqual([]);
  });

  it('allowlist mode (controlled test): an allowlisted verified email can attach; anyone else gets the same 404 as "off"', async () => {
    vi.stubEnv('VAULT_ASK_MINDY_UPLOADS', 'allowlist');
    vi.stubEnv('VAULT_DOC_ALLOWLIST', 'someone-else@example.com');
    const denied = await POST(req('POST', { file: txt() }));
    expect(denied.status).toBe(404);
    expect(state.docInserts).toEqual([]);
    expect(state.blobs).toEqual([]);
    vi.stubEnv('VAULT_DOC_ALLOWLIST', `someone-else@example.com, ${ME.toUpperCase()}`);
    expect((await POST(req('POST', { file: txt() }))).status).toBe(201);
    expect(state.docInserts[0]).toMatchObject({ user_email: ME, doc_class: 'reference' });
  });

  it('requires STRONG auth and Pro', async () => {
    await POST(req('POST', { file: txt() }));
    expect(state.strongAuthAsked[0]).toEqual({ requireStrongAuth: true });
    state.pro = false;
    expect((await POST(req('POST', { file: txt() }))).status).toBe(403);
  });

  it('no header → saved to the caller Vault as reference, linked to the conversation; metadata only back', async () => {
    const res = await POST(req('POST', { file: txt() }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, saved_to: 'vault', document: { id: DOC, filename: 'rfp.txt', doc_class: 'reference' } });
    expect(JSON.stringify(body)).not.toContain('proposals are due');
    expect(state.docInserts[0]).toMatchObject({ user_email: ME, doc_class: 'reference', source: 'ask_mindy', chat_session_id: SID, version: 1 });
    expect(state.blobs[0].startsWith(`${ME}/`)).toBe(true);
  });

  it('creates the conversation row when attaching before the first question', async () => {
    await POST(req('POST', { file: txt() }));
    expect(state.sessionInserts).toHaveLength(1);
    expect(state.sessionInserts[0]).toMatchObject({ id: SID, user_email: ME });
  });

  it('authorized coach → saved to the CLIENT Vault; the conversation stays the coach\'s', async () => {
    state.scope = 'client';
    const res = await POST(req('POST', { file: txt(), headers: { 'x-active-workspace': 'ws-1' } }));
    expect(res.status).toBe(201);
    expect(state.docInserts[0].user_email).toBe(CLIENT_EMAIL);
    expect(state.blobs[0].startsWith(`${CLIENT_EMAIL}/`)).toBe(true);
    expect(state.sessionInserts[0].user_email).toBe(ME);
  });

  it('unauthorized header → 409, NOTHING stored, no conversation created (never falls back to own Vault)', async () => {
    state.scope = 'own';
    const res = await POST(req('POST', { file: txt(), headers: { 'x-active-workspace': 'someone-else' } }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('workspace_unconfirmed');
    expect(state.docInserts).toEqual([]); expect(state.blobs).toEqual([]); expect(state.sessionInserts).toEqual([]);
  });

  it('resolver error → 409, nothing stored', async () => {
    state.scope = 'unavailable';
    expect((await POST(req('POST', { file: txt(), headers: { 'x-active-workspace': 'ws-1' } }))).status).toBe(409);
    expect(state.docInserts).toEqual([]); expect(state.blobs).toEqual([]);
  });

  it('CUI-marked file → 422 with the reason; NO blob, NO row, NO new conversation', async () => {
    const res = await POST(req('POST', { file: txt('CUI\nStatement of Work\nThe contractor shall...') }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('prohibited_marking');
    expect(body.message).toMatch(/CUI/);
    expect(state.docInserts).toEqual([]); expect(state.blobs).toEqual([]); expect(state.sessionInserts).toEqual([]);
  });

  it('classified-marked file → 422, nothing stored', async () => {
    const res = await POST(req('POST', { file: txt('SECRET//NOFORN\nMission') }));
    expect((await res.json()).error).toBe('prohibited_marking');
    expect(state.blobs).toEqual([]);
  });

  it('another user\'s conversation → 404, nothing stored', async () => {
    state.sessionOwner = 'other@example.com';
    expect((await POST(req('POST', { file: txt() }))).status).toBe(404);
    expect(state.docInserts).toEqual([]);
  });

  it('honest 4 MB limit, document cap, unsupported type', async () => {
    const big = new NextRequest(`https://getmindy.ai/api/app/chat/documents?email=${ME}&session_id=${SID}`, { method: 'POST', headers: { 'content-length': String(5 * 1024 * 1024) } });
    expect((await POST(big)).status).toBe(413);
    state.count = 5;
    expect((await POST(req('POST', { file: txt() }))).status).toBe(409);
    state.count = 0;
    expect((await POST(req('POST', { file: { name: 'x.exe', text: 'MZ' } }))).status).toBe(415);
  });

  it('xlsx and csv uploads succeed (Ask W1 spreadsheet parity)', async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['CLIN', 'Qty', 'Price'], ['0001', 2, 100]]);
    XLSX.utils.book_append_sheet(wb, sheet, 'Rates');
    const xlsxBuf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

    // CSV as text through the existing FormData helper
    Object.assign(state, { sessionOwner: null, count: 0 });
    state.docInserts = []; state.blobs = []; state.sessionInserts = [];
    expect((await POST(req('POST', { file: { name: 'rates.csv', text: 'CLIN,Qty,Price\n0001,2,100\n' } }))).status).toBe(201);
    expect(state.docInserts[0]).toMatchObject({ source: 'ask_mindy', doc_class: 'reference' });

    // Real .xlsx bytes (not CSV disguised as xlsx)
    Object.assign(state, { sessionOwner: null, count: 0 });
    state.docInserts = []; state.blobs = []; state.sessionInserts = [];
    const fd = new FormData();
    fd.append('file', new File([xlsxBuf], 'pricing.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const r = new NextRequest(`https://getmindy.ai/api/app/chat/documents?email=${ME}&session_id=${SID}`, { method: 'POST', body: fd });
    expect((await POST(r)).status).toBe(201);
    expect(state.docInserts[0]).toMatchObject({ source: 'ask_mindy', doc_class: 'reference' });
    expect(state.blobs[0].startsWith(`${ME}/`)).toBe(true);
  });

  it('store unavailable (migration not applied) → 503, never a fake success', async () => {
    state.count = 'unavailable';
    expect((await POST(req('POST', { file: txt() }))).status).toBe(503);
    expect(state.blobs).toEqual([]);
  });

  it('rejects a non-UUID session id', async () => {
    const r = new NextRequest(`https://getmindy.ai/api/app/chat/documents?email=${ME}&session_id=nope`, { method: 'GET' });
    expect((await GET(r)).status).toBe(400);
  });
});

describe('GET and DELETE', () => {
  it('list and archive use the conversation + the acting-scope owner', async () => {
    state.sessionOwner = ME;
    state.scope = 'client';
    await GET(req('GET', { headers: { 'x-active-workspace': 'ws-1' } }));
    await DELETE(req('DELETE', { headers: { 'x-active-workspace': 'ws-1' }, query: `&id=${DOC}` }));
    expect(state.listed).toEqual([{ sessionId: SID, ownerEmail: CLIENT_EMAIL }]);
    expect(state.archived).toEqual([{ id: DOC, sessionId: SID, ownerEmail: CLIENT_EMAIL }]);
  });

  it('unresolved workspace lists and archives nothing', async () => {
    state.sessionOwner = ME;
    state.scope = 'unavailable';
    expect((await GET(req('GET', { headers: { 'x-active-workspace': 'ws-1' } }))).status).toBe(409);
    expect((await DELETE(req('DELETE', { headers: { 'x-active-workspace': 'ws-1' }, query: `&id=${DOC}` }))).status).toBe(409);
    expect(state.listed).toEqual([]); expect(state.archived).toEqual([]);
  });

  it('a new conversation has no documents; a bad document id is not found', async () => {
    expect(await (await GET(req('GET'))).json()).toEqual({ success: true, documents: [] });
    state.sessionOwner = ME;
    expect((await DELETE(req('DELETE', { query: '&id=nope' }))).status).toBe(404);
  });
});
