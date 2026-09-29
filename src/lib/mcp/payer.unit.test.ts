/**
 * resolvePayer — the billing invariant for pooled team credits
 * (tasks/PRD-pooled-team-credits.md). PERSONAL only when positively established; any
 * uncertainty charges nothing. Eligibility = an explicit TEAM membership in an org whose
 * subscription is ACTIVE and configured with more than one seat — any plan, not a price.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Resp = { data: unknown; error: { message: string } | null };
const responses: Record<string, Resp> = {};
const calls: { table: string; method: string; args: unknown[] }[] = [];

function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'not', 'gt', 'order', 'limit']) {
    b[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return b; };
  }
  b.then = (resolve: (r: Resp) => unknown) => resolve(responses[table] ?? { data: [], error: null });
  return b;
}

vi.mock('@/lib/supabase/server-clients', () => ({
  getReadClient: () => ({ from: (t: string) => builder(t) }),
  getWriteClient: () => ({ from: (t: string) => builder(t), rpc: vi.fn() }),
}));

import { resolvePayer } from './payer';

const ORG = { id: 'o1', name: 'Acme', stripe_subscription_id: 'sub_1', seat_limit: 3 };

beforeEach(() => {
  for (const k of Object.keys(responses)) delete responses[k];
  calls.length = 0;
  responses.org_members = { data: [{ org_id: 'o1', status: 'active' }], error: null };
  responses.organizations = { data: [ORG], error: null };
  responses.stripe_subscriptions = { data: [{ id: 'sub_1', status: 'active' }], error: null };
  responses.mcp_credit_pool = { data: [{ pool_id: 'p1', org_id: 'o1' }], error: null };
});

describe('resolvePayer', () => {
  it('pays from the pool for an active member of an active multi-seat subscription (any plan)', async () => {
    expect(await resolvePayer('Member@Acme.com')).toEqual({ kind: 'pool', poolId: 'p1', orgId: 'o1', orgName: 'Acme' });
  });

  it('only counts TEAM roles — never coach-mode memberships', async () => {
    await resolvePayer('m@acme.com');
    const roleFilter = calls.find((c) => c.table === 'org_members' && c.method === 'in');
    expect(roleFilter?.args).toEqual(['role', ['team_owner', 'team_member']]);
  });

  it('personal when the person has no team membership', async () => {
    responses.org_members = { data: [], error: null };
    expect(await resolvePayer('solo@x.com')).toEqual({ kind: 'personal' });
  });

  it('personal when the org is single-seat (seat_limit 1 or unset) — pooling is opt-in per subscription', async () => {
    responses.organizations = { data: [{ ...ORG, seat_limit: 1 }, { ...ORG, id: 'o2', seat_limit: null }], error: null };
    expect(await resolvePayer('m@acme.com')).toEqual({ kind: 'personal' });
  });

  it('personal once the subscription is no longer active (cancellation stops the pool at once)', async () => {
    responses.stripe_subscriptions = { data: [{ id: 'sub_1', status: 'canceled' }], error: null };
    expect(await resolvePayer('m@acme.com')).toEqual({ kind: 'personal' });
  });

  it('charges NOTHING when the subscription state is unknown (no row) — never falls to personal', async () => {
    responses.stripe_subscriptions = { data: [], error: null };
    expect(await resolvePayer('m@acme.com')).toMatchObject({ kind: 'unavailable', reason: 'subscription_state_unknown' });
  });

  it('charges NOTHING when a paid multi-seat org has no pool (provisioning gap)', async () => {
    responses.mcp_credit_pool = { data: [], error: null };
    expect(await resolvePayer('m@acme.com')).toMatchObject({ kind: 'pool_unavailable' });
  });

  it('refuses to pick when the person belongs to two paying teams', async () => {
    responses.org_members = { data: [{ org_id: 'o1' }, { org_id: 'o2' }], error: null };
    responses.organizations = { data: [ORG, { ...ORG, id: 'o2', name: 'Beta', stripe_subscription_id: 'sub_2' }], error: null };
    responses.stripe_subscriptions = { data: [{ id: 'sub_1', status: 'active' }, { id: 'sub_2', status: 'active' }], error: null };
    responses.mcp_credit_pool = { data: [{ pool_id: 'p1', org_id: 'o1' }, { pool_id: 'p2', org_id: 'o2' }], error: null };
    expect(await resolvePayer('m@acme.com')).toMatchObject({ kind: 'selection_required' });
  });

  it.each(['org_members', 'organizations', 'stripe_subscriptions', 'mcp_credit_pool'])(
    'a failed %s read is UNAVAILABLE (charge nothing), never personal',
    async (table) => {
      responses[table] = { data: null, error: { message: 'boom' } };
      expect((await resolvePayer('m@acme.com')).kind).toBe('unavailable');
    },
  );
});
