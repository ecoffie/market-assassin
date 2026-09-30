/**
 * provisionPooledOrg must be idempotent for ANY plan: re-affirming an already-configured
 * pool (no overrides) keeps its stored config. It used to validate plan defaults first,
 * so a no-override call failed for plans without built-in defaults (e.g. Growth) — found
 * re-provisioning the internal billing canary on 2026-09-30.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ existing: null as null | Record<string, unknown>, updates: [] as unknown[] }));

function chain(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in']) b[m] = () => b;
  b.maybeSingle = async () => ({ data: table === 'organizations' ? state.existing : null, error: null });
  b.update = (row: unknown) => { state.updates.push(row); return { eq: async () => ({ error: null }) }; };
  b.upsert = async () => ({ error: null });
  b.then = (resolve: (r: unknown) => unknown) => resolve({ data: table === 'mcp_credit_pool' ? [{ pool_id: 'p1', org_id: 'o1' }] : [], error: null });
  return b;
}
vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: () => ({ from: chain }), getReadClient: () => ({ from: chain }), getCountClient: () => ({ from: chain }),
}));
vi.mock('@/lib/stripe/subscription-mirror', () => ({ mirrorSubscription: async (id: string) => ({ ok: true, subscriptionId: id, status: 'active' }) }));

import { provisionPooledOrg } from './team-pools';

beforeEach(() => { state.existing = null; state.updates = []; });

describe('provisionPooledOrg idempotency', () => {
  it('re-affirms a configured Growth pool with no overrides, keeping its stored config', async () => {
    state.existing = { id: 'o1', seat_limit: 2, pool_monthly_credits: 20 };
    const r = await provisionPooledOrg({ subscriptionId: 'sub_g', ownerEmail: 'o@x.com', planKey: 'growth' });
    expect(r).toMatchObject({ orgId: 'o1', created: false, seatLimit: 2, monthlyCredits: 20, mirror: { ok: true } });
    expect(state.updates).toEqual([]); // nothing rewritten
  });

  it('still refuses to CREATE a pool for a plan with no seat configuration', async () => {
    await expect(provisionPooledOrg({ subscriptionId: 'sub_new', ownerEmail: 'o@x.com', planKey: 'growth' }))
      .rejects.toThrow('has no multi-seat configuration');
  });

  it('explicit overrides on an existing pool are applied', async () => {
    state.existing = { id: 'o1', seat_limit: 2, pool_monthly_credits: 20 };
    const r = await provisionPooledOrg({ subscriptionId: 'sub_g', ownerEmail: 'o@x.com', planKey: 'growth', seatLimit: 3, monthlyCredits: 3500 });
    expect(r).toMatchObject({ seatLimit: 3, monthlyCredits: 3500 });
    expect(state.updates).toEqual([{ seat_limit: 3, pool_monthly_credits: 3500, pool_plan_key: 'growth' }]);
  });
});
