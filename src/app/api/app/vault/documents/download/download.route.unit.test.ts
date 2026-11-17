/**
 * Vault download: strong auth, strict scope on every request, owner check IN the query, identical 404
 * for missing / forbidden / archived / blob-less / bad id, a 60-second signed URL from the private
 * bucket, flag off → the same 404.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const ME = 'o@x.com';
const MINE = '11111111-1111-4111-8111-111111111111';
const THEIRS = '22222222-2222-4222-8222-222222222222';
const ARCHIVED = '33333333-3333-4333-8333-333333333333';
const NOBLOB = '44444444-4444-4444-8444-444444444444';

const state = vi.hoisted(() => ({
  strong: [] as unknown[],
  scope: 'own' as 'own' | 'client' | 'unavailable',
  signed: [] as Array<{ path: string; secs: number; opts: unknown }>,
  rows: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: async (_r: unknown, email: string, o: unknown) => { state.strong.push(o); return { authenticated: true, email }; } }));
vi.mock('@/lib/chat/chat-acting-scope', async (orig) => ({
  ...(await orig<object>()),
  resolveChatActingScope: async (email: string) =>
    state.scope === 'client' ? { kind: 'client', email, workspaceId: 'ws', vaultEmail: 'ws@clients.getmindy.ai' }
      : state.scope === 'unavailable' ? { kind: 'unavailable', email } : { kind: 'own', email },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const f: Array<[string, unknown]> = [];
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => { f.push([k, v]); return q; },
        is: (k: string) => { f.push([k, '__null']); return q; },
        maybeSingle: async () => ({ data: state.rows.find((r) => f.every(([k, v]) => (v === '__null' ? r[k] == null : r[k] === v))) ?? null, error: null }),
      };
      return q;
    },
    storage: { from: () => ({ createSignedUrl: async (path: string, secs: number, opts: unknown) => { state.signed.push({ path, secs, opts }); return { data: { signedUrl: `https://signed/${path}?t=${secs}` }, error: null }; } }) },
  }),
}));

import { GET } from './route';

const req = (id: string, headers: Record<string, string> = {}) =>
  new NextRequest(`https://getmindy.ai/api/app/vault/documents/download?email=${encodeURIComponent(ME)}&id=${id}`, { headers });

beforeEach(() => {
  vi.stubEnv('VAULT_GENERATED_FILES', 'true');
  state.strong = []; state.signed = []; state.scope = 'own';
  state.rows = [
    { id: MINE, user_email: ME, original_filename: 'Plan v2.docx', storage_path: `${ME}/generated/1-v2-Plan.docx`, archived_at: null },
    { id: THEIRS, user_email: 'other@x.com', original_filename: 'Theirs.pdf', storage_path: 'other@x.com/t.pdf', archived_at: null },
    { id: ARCHIVED, user_email: ME, original_filename: 'Old.pdf', storage_path: `${ME}/old.pdf`, archived_at: '2026-11-01' },
    { id: NOBLOB, user_email: ME, original_filename: 'NoBlob.pdf', storage_path: null, archived_at: null },
  ];
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/app/vault/documents/download', () => {
  it('own document → 60-second signed URL, attachment with the stored name, no-store, strong auth', async () => {
    const res = await GET(req(MINE));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toMatchObject({ success: true, filename: 'Plan v2.docx', expires_in_seconds: 60 });
    expect(state.signed).toEqual([{ path: `${ME}/generated/1-v2-Plan.docx`, secs: 60, opts: { download: 'Plan v2.docx' } }]);
    expect(state.strong[0]).toEqual({ requireStrongAuth: true });
  });

  it('missing, another account\'s, archived, blob-less and malformed ids → IDENTICAL 404 body', async () => {
    const bodies: string[] = [];
    for (const id of ['99999999-9999-4999-8999-999999999999', THEIRS, ARCHIVED, NOBLOB, 'not-a-uuid']) {
      const res = await GET(req(id));
      expect(res.status, id).toBe(404);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(state.signed).toEqual([]);
  });

  it('authorized coach downloads from the CLIENT Vault only', async () => {
    state.scope = 'client';
    state.rows.push({ id: '55555555-5555-4555-8555-555555555555', user_email: 'ws@clients.getmindy.ai', original_filename: 'Client.pdf', storage_path: 'ws@clients.getmindy.ai/c.pdf', archived_at: null });
    expect((await GET(req('55555555-5555-4555-8555-555555555555', { 'x-active-workspace': 'ws' }))).status).toBe(200);
    expect((await GET(req(MINE, { 'x-active-workspace': 'ws' }))).status).toBe(404); // the coach's own doc is not in the client scope
  });

  it('strict scope: unauthorized header or resolver error → 409, nothing signed', async () => {
    state.scope = 'own';
    expect((await GET(req(MINE, { 'x-active-workspace': 'someone' }))).status).toBe(409);
    state.scope = 'unavailable';
    expect((await GET(req(MINE, { 'x-active-workspace': 'ws' }))).status).toBe(409);
    expect(state.signed).toEqual([]);
  });

  it('flag off → the same 404, no auth work', async () => {
    vi.stubEnv('VAULT_GENERATED_FILES', '');
    vi.stubEnv('VAULT_ASK_MINDY_UPLOADS', '');
    expect((await GET(req(MINE))).status).toBe(404);
    expect(state.strong).toEqual([]);
  });
});
