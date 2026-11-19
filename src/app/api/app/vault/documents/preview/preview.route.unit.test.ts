/**
 * Vault preview (the Map's in-chat report pane): strong auth, strict scope, owner + generated + not-archived
 * IN the query, identical 404 for missing / forbidden / archived / not-generated / model-less / malformed,
 * flag off → the same 404, and the HTML is the stored DocModel rendered by the shared engine.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { SAMPLE_REPORT } from '@/lib/documents/__fixtures__/sample-report';

const ME = 'o@x.com';
const DOCX = '11111111-1111-4111-8111-111111111111';
const PDF = '11111111-1111-4111-8111-111111111112';
const THEIRS = '22222222-2222-4222-8222-222222222222';
const ARCHIVED = '33333333-3333-4333-8333-333333333333';
const UPLOAD = '44444444-4444-4444-8444-444444444444';
const NOMODEL = '55555555-5555-4555-8555-555555555555';
const OLDER = '66666666-6666-4666-8666-666666666666';

const state = vi.hoisted(() => ({
  strong: [] as unknown[],
  scope: 'own' as 'own' | 'client' | 'unavailable',
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
      const match = () => state.rows.filter((r) => f.every(([k, v]) => (v === '__null' ? r[k] == null : r[k] === v)));
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => { f.push([k, v]); return q; },
        is: (k: string) => { f.push([k, '__null']); return q; },
        limit: async () => ({ data: match(), error: null }),
        maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
      };
      return q;
    },
  }),
}));

import { GET } from './route';

const req = (id: string, headers: Record<string, string> = {}) =>
  new NextRequest(`https://getmindy.ai/api/app/vault/documents/preview?email=${encodeURIComponent(ME)}&id=${id}`, { headers });

const gen = (over: Record<string, unknown>) => ({ user_email: ME, doc_class: 'generated', archived_at: null, version: 2, parent_id: 'p', doc_model: SAMPLE_REPORT, ...over });

beforeEach(() => {
  vi.stubEnv('VAULT_GENERATED_FILES', 'true');
  state.strong = []; state.scope = 'own';
  state.rows = [
    gen({ id: DOCX, original_filename: 'Report.docx' }),
    gen({ id: PDF, original_filename: 'Report.pdf' }),
    gen({ id: OLDER, original_filename: 'Report.docx', version: 1, parent_id: null }),
    gen({ id: THEIRS, user_email: 'other@x.com', original_filename: 'Theirs.docx' }),
    gen({ id: ARCHIVED, original_filename: 'Old.docx', archived_at: '2026-11-01' }),
    gen({ id: UPLOAD, original_filename: 'Mine.docx', doc_class: 'company' }),
    gen({ id: NOMODEL, original_filename: 'Bare.docx', doc_model: null }),
  ];
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/app/vault/documents/preview', () => {
  it('own generated document → the stored model rendered as HTML, with export files of the SAME version only', async () => {
    const res = await GET(req(DOCX));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const j = await res.json();
    expect(j).toMatchObject({ success: true, document_id: DOCX, version: 2, title: SAMPLE_REPORT.title });
    expect(j.html).toContain('<!doctype html>');
    expect(j.html).toContain(SAMPLE_REPORT.sections[0].heading);
    expect(j.html).toContain('Content-Security-Policy');
    expect(j.html).toContain('body { padding: 20px 24px 40px; }'); // screen layout
    expect(j.files.map((f: { format: string; document_id: string }) => [f.format, f.document_id])).toEqual([['pdf', PDF], ['docx', DOCX]]);
    expect(state.strong[0]).toEqual({ requireStrongAuth: true });
  });

  it('the older version is still readable by its own id (prior versions stay in the Vault)', async () => {
    const j = await (await GET(req(OLDER))).json();
    expect(j.version).toBe(1);
    expect(j.files.map((f: { document_id: string }) => f.document_id)).toEqual([OLDER]);
  });

  it("missing, another account's, archived, not-generated, model-less and malformed ids → IDENTICAL 404 body", async () => {
    const bodies: string[] = [];
    for (const id of ['99999999-9999-4999-8999-999999999999', THEIRS, ARCHIVED, UPLOAD, NOMODEL, 'not-a-uuid']) {
      const res = await GET(req(id));
      expect(res.status, id).toBe(404);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('strict scope: unauthorized header or resolver error → 409', async () => {
    expect((await GET(req(DOCX, { 'x-active-workspace': 'someone' }))).status).toBe(409);
    state.scope = 'unavailable';
    expect((await GET(req(DOCX, { 'x-active-workspace': 'ws' }))).status).toBe(409);
  });

  it('authorized coach previews from the CLIENT Vault only', async () => {
    state.scope = 'client';
    state.rows.push(gen({ id: '77777777-7777-4777-8777-777777777777', user_email: 'ws@clients.getmindy.ai', original_filename: 'Client.docx' }));
    expect((await GET(req('77777777-7777-4777-8777-777777777777', { 'x-active-workspace': 'ws' }))).status).toBe(200);
    expect((await GET(req(DOCX, { 'x-active-workspace': 'ws' }))).status).toBe(404);
  });

  it('allowlist mode: only an allowlisted verified caller gets a preview; flag off → the same 404, no auth work', async () => {
    vi.stubEnv('VAULT_GENERATED_FILES', 'allowlist');
    vi.stubEnv('VAULT_DOC_ALLOWLIST', 'someone-else@example.com');
    expect((await GET(req(DOCX))).status).toBe(404);
    vi.stubEnv('VAULT_DOC_ALLOWLIST', ME);
    expect((await GET(req(DOCX))).status).toBe(200);
    vi.stubEnv('VAULT_GENERATED_FILES', '');
    state.strong = [];
    expect((await GET(req(DOCX))).status).toBe(404);
    expect(state.strong).toEqual([]);
  });
});
