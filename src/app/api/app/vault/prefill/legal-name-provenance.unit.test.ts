/**
 * P0-I — the SAM prefill confirm form posts a CLIENT-SUPPLIED legal_name (pre-filled from SAM,
 * editable). It may be stamped `sam` only when it equals SAM's legalBusinessName for that UEI.
 * An edited name is user_entered; a failed/absent lookup leaves provenance unknown (NULL).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const idRows: Record<string, unknown>[] = [];
const entity: { value: unknown; throws: boolean } = { value: null, throws: false };

function from(name: string) {
  let op = 'select'; let payload: Record<string, unknown> = {};
  const f: Array<(r: Record<string, unknown>) => boolean> = [];
  const run = () => {
    if (name !== 'user_identity_profile') return { data: null, error: null, count: 0 };
    if (op === 'select') return { data: idRows.find((r) => f.every((x) => x(r))) ?? null, error: null };
    const i = idRows.findIndex((r) => r.user_email === payload.user_email);
    if (i >= 0) idRows[i] = { ...idRows[i], ...payload }; else idRows.push({ ...payload });
    return { data: null, error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q, eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return q; },
    upsert: (p: Record<string, unknown>) => { op = 'upsert'; payload = p; return q; },
    maybeSingle: () => Promise.resolve(run()),
    then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
  };
  return q;
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from }) }));
vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: async (_r: unknown, e: string) => ({ authenticated: true, email: e }) }));
vi.mock('@/lib/app/workspace', () => ({ resolveActiveWorkspace: async () => ({ workspaceId: null, asClient: false }), clientNotificationEmail: () => '' }));
vi.mock('@/lib/sam/entity-api', () => ({
  getEntityByUEI: async () => { if (entity.throws) throw new Error('SAM down'); return entity.value; },
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
const { POST } = await import('./route');

const post = (legal_name: string) => POST(new NextRequest('https://getmindy.ai/api/app/vault/prefill', {
  method: 'POST', body: JSON.stringify({ email: 'a@example.com', uei: 'ABCDEF123456', identity: { uei: 'ABCDEF123456', legal_name } }),
}));

beforeEach(() => { idRows.length = 0; entity.value = { legalBusinessName: 'ACME FEDERAL SERVICES LLC' }; entity.throws = false; });

describe('prefill legal_name provenance', () => {
  it("matches SAM's registered name → sam", async () => {
    await post('Acme Federal Services LLC');
    expect(idRows[0]).toMatchObject({ legal_name: 'Acme Federal Services LLC', legal_name_source: 'sam' });
  });
  it('edited by the user → user_entered, never sam', async () => {
    await post('Acme Holdings');
    expect(idRows[0]).toMatchObject({ legal_name: 'Acme Holdings', legal_name_source: 'user_entered' });
  });
  it('SAM lookup failure → provenance unknown (NULL), never sam', async () => {
    entity.throws = true;
    await post('Acme Federal Services LLC');
    expect(idRows[0]).toMatchObject({ legal_name: 'Acme Federal Services LLC', legal_name_source: null });
  });
  it('no SAM entity → unknown, never sam', async () => {
    entity.value = null;
    await post('Acme Federal Services LLC');
    expect(idRows[0].legal_name_source).toBeNull();
  });
  it('a grounded SAM name supersedes an earlier typed one', async () => {
    idRows.push({ user_email: 'a@example.com', legal_name: 'Acme', legal_name_source: 'user_entered' });
    await post('ACME FEDERAL SERVICES LLC');
    expect(idRows[0]).toMatchObject({ legal_name: 'ACME FEDERAL SERVICES LLC', legal_name_source: 'sam' });
  });
  it('an admin-set name survives prefill', async () => {
    idRows.push({ user_email: 'a@example.com', legal_name: 'Acme (restored)', legal_name_source: 'admin' });
    await post('ACME FEDERAL SERVICES LLC');
    expect(idRows[0]).toMatchObject({ legal_name: 'Acme (restored)', legal_name_source: 'admin' });
  });
});
