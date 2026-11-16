import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/app/workspace', () => ({ resolveActiveWorkspace: vi.fn() }));

import { canAccessPursuit, authorizePursuitRead, isPipelineId } from './pursuit-access';

const ID = '11111111-2222-4333-8444-555555555555';
const req = { headers: { get: () => null } };
const noWorkspace = vi.fn(async () => ({ workspaceId: '', asClient: false }));
const inWorkspace = (ws: string) => vi.fn(async () => ({ workspaceId: ws, asClient: true }));

function fakeSb(row: unknown, error: { message: string } | null = null) {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: row, error }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => q } as any;
}

describe('canAccessPursuit', () => {
  it('owner may read (case-insensitive)', async () => {
    expect(await canAccessPursuit({ user_email: 'Owner@X.com' }, 'owner@x.com', req, noWorkspace)).toBe(true);
  });
  it('another user may not read a personal pursuit', async () => {
    expect(await canAccessPursuit({ user_email: 'owner@x.com', workspace_id: null }, 'other@y.com', req, noWorkspace)).toBe(false);
  });
  it('a member of the pursuit workspace (e.g. an authorized coach) may read', async () => {
    expect(await canAccessPursuit({ user_email: 'client@x.com', workspace_id: 'ws-1' }, 'coach@y.com', req, inWorkspace('ws-1'))).toBe(true);
  });
  it('a different workspace may not read', async () => {
    expect(await canAccessPursuit({ user_email: 'client@x.com', workspace_id: 'ws-1' }, 'coach@y.com', req, inWorkspace('ws-2'))).toBe(false);
  });
  it('workspace lookup failure denies', async () => {
    const boom = vi.fn(async () => { throw new Error('db'); });
    expect(await canAccessPursuit({ user_email: 'client@x.com', workspace_id: 'ws-1' }, 'coach@y.com', req, boom)).toBe(false);
  });
  it('empty caller email never matches an empty owner', async () => {
    expect(await canAccessPursuit({ user_email: '' }, '', req, noWorkspace)).toBe(false);
  });
});

describe('authorizePursuitRead', () => {
  it('rejects a non-UUID id without querying', async () => {
    expect(isPipelineId('abc')).toBe(false);
    expect(await authorizePursuitRead(fakeSb(null), req, 'a@b.com', 'abc', noWorkspace)).toEqual({ ok: false, reason: 'not_found' });
  });
  it('missing pursuit and foreign pursuit look identical', async () => {
    const missing = await authorizePursuitRead(fakeSb(null), req, 'a@b.com', ID, noWorkspace);
    const foreign = await authorizePursuitRead(fakeSb({ id: ID, user_email: 'z@z.com', workspace_id: null }), req, 'a@b.com', ID, noWorkspace);
    expect(missing).toEqual({ ok: false, reason: 'not_found' });
    expect(foreign).toEqual(missing);
  });
  it('owner is allowed', async () => {
    expect(await authorizePursuitRead(fakeSb({ id: ID, user_email: 'a@b.com', workspace_id: null }), req, 'a@b.com', ID, noWorkspace)).toEqual({ ok: true });
  });
  it('a query error is reported as an error, not as access', async () => {
    expect(await authorizePursuitRead(fakeSb(null, { message: 'x' }), req, 'a@b.com', ID, noWorkspace)).toEqual({ ok: false, reason: 'error' });
  });
});
