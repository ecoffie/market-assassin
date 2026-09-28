/**
 * Regression: Command Center Team grants reported "GRANTED" while access_team
 * stayed false (2026-09-28, a paying $499/mo Team subscriber).
 *
 * Cause: applyMemberGrant stamped `user_profiles.tier = 'team'|'pro'`, but that
 * column is the legacy Content Reaper tier with
 *   CHECK (tier IN ('free','content-engine','full-fix'))
 * so Postgres rejected the whole update. Pro survived via its KV key; Team has
 * no KV gate, so the grant was a no-op that still returned success.
 *
 * The fake client below enforces that CHECK exactly like production.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ALLOWED_TIERS = new Set(['free', 'content-engine', 'full-fix']);

type Row = Record<string, unknown>;
const db: { profiles: Row[]; grants: Row[]; updates: Row[] } = { profiles: [], grants: [], updates: [] };

function fakeClient() {
  const table = (name: string) => {
    const state: { filters: Array<[string, unknown]>; payload?: Row; op?: 'update' } = { filters: [] };
    const matchRows = () =>
      name === 'user_profiles'
        ? db.profiles.filter((r) => state.filters.every(([k, v]) => r[k] === v))
        : [];
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (k: string, v: unknown) => {
        state.filters.push([k, v]);
        if (state.op === 'update') return Promise.resolve(runUpdate());
        return builder;
      },
      not: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: matchRows()[0] ?? null, error: null }),
      update: (payload: Row) => {
        state.op = 'update';
        state.payload = payload;
        return builder;
      },
      insert: async (payload: Row) => {
        if (name === 'mi_admin_grants') db.grants.push(payload);
        return { error: null };
      },
    };
    function runUpdate() {
      if (name !== 'user_profiles') return { error: null };
      const payload = state.payload as Row;
      db.updates.push(payload);
      if ('tier' in payload && !ALLOWED_TIERS.has(String(payload.tier))) {
        return {
          error: { message: 'new row for relation "user_profiles" violates check constraint "user_profiles_tier_check"' },
        };
      }
      for (const r of matchRows()) Object.assign(r, payload);
      return { error: null };
    }
    return builder;
  };
  return {
    from: table,
    rpc: async () => ({ error: null }),
    auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }) } },
  };
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeClient() }));
vi.mock('@/lib/briefings/access', () => ({
  grantBriefingsAccess: vi.fn(async () => undefined),
  revokeBriefingsAccess: vi.fn(async () => undefined),
}));
vi.mock('@/lib/app/workspace', () => ({ provisionTeamWorkspace: vi.fn(async () => undefined) }));

const EMAIL = 'team-buyer@example.com';

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  db.profiles = [{ email: EMAIL, user_id: 'u1', tier: 'free', access_briefings: true, access_team: false }];
  db.grants = [];
  db.updates = [];
});

describe('applyMemberGrant — Team', () => {
  it('actually sets access_team (never writes the legacy tier column)', async () => {
    const { applyMemberGrant } = await import('./member-grants');
    const r = await applyMemberGrant({
      targetEmail: EMAIL, actorEmail: 'staff@govcongiants.com', tier: 'team', action: 'grant', sendWelcome: false,
    });
    expect(r.success).toBe(true);
    expect(r.status.accessTeam).toBe(true);
    expect(db.profiles[0].access_team).toBe(true);
    expect(db.profiles[0].tier).toBe('free'); // untouched
    for (const u of db.updates) expect(u).not.toHaveProperty('tier');
  });

  it('reports failure (not GRANTED) when access_team does not land', async () => {
    // A user with no profile row and no auth account: Team cannot be stored.
    db.profiles = [];
    const { applyMemberGrant } = await import('./member-grants');
    const r = await applyMemberGrant({
      targetEmail: 'not-signed-up@example.com', actorEmail: 'staff@govcongiants.com', tier: 'team', action: 'grant',
      sendWelcome: false,
    });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/NOT granted/);
    expect(db.grants.at(-1)?.note).toMatch(/^\[NOT APPLIED:/);
  });
});

describe('applyMemberGrant — Pro', () => {
  it('writes access_briefings without touching the legacy tier column', async () => {
    db.profiles = [{ email: EMAIL, user_id: 'u1', tier: 'content-engine', access_briefings: false, access_team: false }];
    const { applyMemberGrant } = await import('./member-grants');
    const r = await applyMemberGrant({
      targetEmail: EMAIL, actorEmail: 'staff@govcongiants.com', tier: 'pro', action: 'grant', sendWelcome: false,
    });
    expect(r.success).toBe(true);
    expect(r.warning).toBeUndefined();
    expect(db.profiles[0].access_briefings).toBe(true);
    expect(db.profiles[0].tier).toBe('content-engine');
  });
});
