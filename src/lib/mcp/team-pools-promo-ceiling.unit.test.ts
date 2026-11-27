/**
 * promoPoolCeiling: the Mindy Day promo doubles a pool's ceiling, but a month already claimed
 * at the normal ceiling is never topped up to the doubled one (mcp_replenish_pool would grant
 * the difference for a new ceiling in an already-claimed month).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows = vi.hoisted(() => ({ data: [] as Array<{ idempotency_key: string }>, error: null as null | { message: string }, likeArg: '' }));
vi.mock('@/lib/supabase/server-clients', () => {
  const q = {
    select: () => q,
    like: (_c: string, v: string) => { rows.likeArg = v; return q; },
    limit: async () => ({ data: rows.data, error: rows.error }),
  };
  return { getReadClient: () => ({ from: () => q }), getWriteClient: vi.fn(), getCountClient: vi.fn() };
});

import { promoPoolCeiling, type PooledOrg } from './team-pools';

const org: PooledOrg = { orgId: 'org-1', name: 'A', poolId: 'p', seatLimit: 5, monthlyCredits: 7000, planKey: 'team', subscriptionId: 's' };

beforeEach(() => { rows.data = []; rows.error = null; rows.likeArg = ''; });

describe('promoPoolCeiling', () => {
  it('multiplier 1 → the normal ceiling, no read', async () => {
    expect(await promoPoolCeiling(org, '2026-12', 1)).toBe(7000);
    expect(rows.likeArg).toBe('');
  });

  it('nothing claimed yet this month → doubled', async () => {
    expect(await promoPoolCeiling(org, '2026-12', 2)).toBe(14000);
    expect(rows.likeArg).toBe('pool:org-1:2026-12:c%');
  });

  it('already claimed at the doubled ceiling → doubled again (an idempotent re-claim)', async () => {
    rows.data = [{ idempotency_key: 'pool:org-1:2026-12:c14000' }];
    expect(await promoPoolCeiling(org, '2026-12', 2)).toBe(14000);
  });

  it('already claimed at the normal ceiling → the normal ceiling (no top-up this month)', async () => {
    rows.data = [{ idempotency_key: 'pool:org-1:2026-12:c7000' }];
    expect(await promoPoolCeiling(org, '2026-12', 2)).toBe(7000);
  });

  it('a failed read throws (never guessed)', async () => {
    rows.error = { message: 'boom' };
    await expect(promoPoolCeiling(org, '2026-12', 2)).rejects.toThrow(/claim lookup failed/);
  });
});
