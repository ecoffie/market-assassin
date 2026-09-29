/**
 * Pure logic for pooled team credits (tasks/PRD-pooled-team-credits.md): grant routing,
 * invoice → subscription id across Stripe API shapes, legacy-schema detection, and the
 * FIFO attribution that decides how many Team credits the one-time migration may move.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server-clients', () => ({ getReadClient: vi.fn(), getWriteClient: vi.fn() }));

import {
  routeSubscriptionGrants, subscriptionIdFromInvoice, isPoolSchemaMissing, poolReplenishKey,
  hashInviteToken, isPoolEligibleConfig, type PooledOrg,
} from './team-pools';
import { computeTeamEntitlement, planTeamTransfer } from './team-pool-migration';

const org = (subscriptionId: string): PooledOrg => ({
  orgId: `o-${subscriptionId}`, name: 'Acme', poolId: 'p', seatLimit: 3, monthlyCredits: 3500, planKey: 'growth', subscriptionId,
});

describe('routeSubscriptionGrants', () => {
  const candidates = [
    { email: 'pro@x.com', amount: 1500, group: 'pro-sub', subscriptionId: 'sub_pro' },
    { email: 'team@x.com', amount: 1000, group: 'team-sub', subscriptionId: 'sub_team' },
  ];

  it('a pooled subscription replenishes its pool and never also grants the buyer personally', () => {
    const r = routeSubscriptionGrants(candidates, new Map([['sub_team', org('sub_team')]]), new Set(['sub_pro', 'sub_team']));
    expect(r.personal.map((c) => c.email)).toEqual(['pro@x.com']);
    expect(r.pools.map((p) => p.subscriptionId)).toEqual(['sub_team']);
  });

  it('pools ANY active plan (e.g. a 2-seat Growth deal), not only Team prices', () => {
    const r = routeSubscriptionGrants(candidates, new Map([['sub_growth', org('sub_growth')]]), new Set(['sub_growth']));
    expect(r.pools.map((p) => p.subscriptionId)).toEqual(['sub_growth']);
    expect(r.personal).toHaveLength(2); // unrelated subscriptions unchanged
  });

  it('an inactive pooled subscription is not replenished', () => {
    const r = routeSubscriptionGrants(candidates, new Map([['sub_gone', org('sub_gone')]]), new Set(['sub_pro']));
    expect(r.pools).toEqual([]);
  });
});

describe('subscriptionIdFromInvoice', () => {
  it('reads the 2025+ parent.subscription_details shape', () => {
    expect(subscriptionIdFromInvoice({ parent: { subscription_details: { subscription: 'sub_new' } } })).toBe('sub_new');
  });
  it('reads the legacy top-level shape (string or expanded)', () => {
    expect(subscriptionIdFromInvoice({ subscription: 'sub_old' })).toBe('sub_old');
    expect(subscriptionIdFromInvoice({ subscription: { id: 'sub_exp' } })).toBe('sub_exp');
  });
  it('falls back to the line item', () => {
    expect(subscriptionIdFromInvoice({ lines: { data: [{ parent: { subscription_item_details: { subscription: 'sub_line' } } }] } })).toBe('sub_line');
  });
  it('is null for a one-off invoice', () => {
    expect(subscriptionIdFromInvoice({ lines: { data: [{}] } })).toBeNull();
  });
});

describe('helpers', () => {
  it('detects the pre-migration (legacy) schema without swallowing other errors', () => {
    expect(isPoolSchemaMissing(new Error('column organizations.seat_limit does not exist'))).toBe(true);
    expect(isPoolSchemaMissing(new Error('Could not find the function public.mcp_replenish_pool in the schema cache'))).toBe(true);
    expect(isPoolSchemaMissing(new Error('connection reset'))).toBe(false);
  });
  it('keys replenishment per org per month', () => {
    expect(poolReplenishKey('o1', '2026-10')).toBe('pool:o1:2026-10');
  });
  it('stores only a hash of invite tokens', () => {
    expect(hashInviteToken('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken('abc')).not.toContain('abc');
  });
  it('treats only more than one seat as pool-eligible', () => {
    expect([null, undefined, 0, 1].map((n) => isPoolEligibleConfig(n as number))).toEqual([false, false, false, false]);
    expect(isPoolEligibleConfig(2)).toBe(true);
  });
});

describe('computeTeamEntitlement (migration attribution)', () => {
  const isTeam = (e: { reason: string }) => e.reason === 'app_tier_team';

  it('the real subscriber shape: two unspent Team grants → all 2,000 are Team', () => {
    const r = computeTeamEntitlement([
      { created_at: '2026-08-03', delta: 1000, reason: 'app_tier_team' },
      { created_at: '2026-09-01', delta: 1000, reason: 'app_tier_team' },
    ], isTeam);
    expect(r).toMatchObject({ teamRemaining: 2000, otherAllowanceRemaining: 0, purchasedRemaining: 0 });
    expect(planTeamTransfer(r, 2000, 0)).toMatchObject({ amount: 2000, replayMismatch: false });
  });

  it('spending consumes the OLDEST allowance first, leaving newer credits in place', () => {
    const r = computeTeamEntitlement([
      { created_at: '2026-07-01', delta: 100, reason: 'signup_grant' },
      { created_at: '2026-08-01', delta: 1000, reason: 'app_tier_team' },
      { created_at: '2026-08-15', delta: -300, reason: 'tool_call' },
    ], isTeam);
    expect(r).toMatchObject({ teamRemaining: 800, otherAllowanceRemaining: 0 });
  });

  it('never counts purchased credits as Team, and allowance is spent before purchases', () => {
    const r = computeTeamEntitlement([
      { created_at: '2026-08-01', delta: 1000, reason: 'app_tier_team' },
      { created_at: '2026-08-02', delta: 1000, reason: 'stripe_topup' },
      { created_at: '2026-08-03', delta: -1200, reason: 'tool_call' },
    ], isTeam);
    expect(r).toMatchObject({ teamRemaining: 0, purchasedRemaining: 800 });
    expect(planTeamTransfer(r, 800, 800).amount).toBe(0);
  });

  it('caps the move by the real allowance and reports a replay mismatch instead of hiding it', () => {
    const r = computeTeamEntitlement([{ created_at: '2026-08-01', delta: 1000, reason: 'app_tier_team' }], isTeam);
    const plan = planTeamTransfer(r, 600, 0); // live balance disagrees with the replay
    expect(plan).toMatchObject({ amount: 600, replayMismatch: true });
  });
});
