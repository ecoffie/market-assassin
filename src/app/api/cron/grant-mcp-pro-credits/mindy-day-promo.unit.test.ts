/**
 * The monthly grant cron applies the Mindy Day annual promo: an annual Pro/Team plan bought
 * Nov 28 – Dec 5 2026 (New York) is granted 2x its allowance; every other subscription 1x.
 * Same monthly key either way, and a pooled org never gets a top-up for a month already
 * replenished at the normal allowance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PRO_MONTHLY_CREDITS, TEAM_MONTHLY_CREDITS } from '@/lib/mcp/packages';

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const item = (amount: number, interval: 'month' | 'year', start: string) =>
  ({ price: { unit_amount: amount, recurring: { interval } }, current_period_start: sec(start) });

const subs = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('stripe', () => {
  class StripeMock {
    subscriptions = {
      list: () => ({ async *[Symbol.asyncIterator]() { for (const s of subs.list) yield s; } }),
    };
  }
  return { default: StripeMock };
});

vi.mock('@/lib/api-auth', () => ({ INTERNAL_TEAM_EMAILS: [] }));
vi.mock('@/lib/mindy/advocate-accounts', () => ({ ADVOCATE_ACCOUNTS: [] }));
vi.mock('@/lib/mcp/sponsor-entitlements', () => ({
  activeSponsorEntitlements: vi.fn(async () => ({ entitlements: [], error: null })),
  topUpToCeiling: vi.fn(),
}));
vi.mock('@/lib/mcp/prepaid-entitlements', () => ({
  listActivePrepaidEntitlements: vi.fn(async () => ({ entitlements: [], error: null })),
  catchUpPrepaidMonths: vi.fn(async () => ({ granted: [], alreadyClaimed: [], forfeited: [], errors: [] })),
  dueMonths: vi.fn(() => []),
  monthlyGrantKey: (email: string, month: string) => `pro:${email}:${month}`,
  accessDate: () => '2026-12-02',
  accessIsLive: () => true,
}));
const pools = vi.hoisted(() => ({ bySub: new Map<string, unknown>() }));
const replenishPool = vi.fn(async () => ({ applied: true, granted: 1, newBalance: 1 }));
const promoPoolCeiling = vi.fn(async (org: { monthlyCredits: number }, _m: string, mult: number) => org.monthlyCredits * mult);
vi.mock('@/lib/mcp/team-pools', () => ({
  listPooledOrgsBySubscription: vi.fn(async () => pools.bySub),
  replenishPool,
  promoPoolCeiling,
  routeSubscriptionGrants: (c: Array<{ subscriptionId: string }>, bySub: Map<string, unknown>) => ({
    personal: c.filter((x) => !bySub.has(x.subscriptionId)), pools: [...bySub.values()],
  }),
  isPoolSchemaMissing: () => false,
}));
vi.mock('@/lib/mcp/pro-allowance', () => ({ proAllowanceDecision: vi.fn(async () => ({ grant: true })) }));
const applyCreditOnce = vi.fn(async () => ({ applied: true, newBalance: 0 }));
vi.mock('@/lib/mcp/credits', () => ({ applyCreditOnce }));
vi.mock('@/lib/mcp/credit-health', () => ({
  collectCreditHealth: vi.fn(async () => ({ exhausted: [], lowBalance: [], errors: [] })),
  claimAlertOnce: vi.fn(async () => false),
}));
vi.mock('@/lib/ops-alert', () => ({ sendOpsAlert: vi.fn(async () => ({ ok: true })) }));

const cust = (email: string) => ({ email, deleted: false });

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.ADMIN_PASSWORD = 'pw';
  applyCreditOnce.mockClear();
  replenishPool.mockClear();
  promoPoolCeiling.mockClear();
  pools.bySub = new Map();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-02T14:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

async function run() {
  const { GET } = await import('./route');
  return GET(new NextRequest('http://localhost/api/cron/grant-mcp-pro-credits?password=pw'));
}
const grantFor = (email: string) =>
  (applyCreditOnce.mock.calls as unknown as Array<[string, string, number, string]>).find((c) => c[1] === email);

describe('grant-mcp-pro-credits: Mindy Day annual promo', () => {
  it('grants 2x to an annual sub bought in the window and 1x to everyone else, on the same monthly key', async () => {
    subs.list = [
      { id: 's_promo_pro', status: 'active', items: { data: [item(149000, 'year', '2026-11-29T15:00:00Z')] }, customer: cust('promo.pro@example.com') },
      { id: 's_promo_team', status: 'active', items: { data: [item(499000, 'year', '2026-12-01T15:00:00Z')] }, customer: cust('promo.team@example.com') },
      { id: 's_monthly', status: 'active', items: { data: [item(14900, 'month', '2026-12-01T15:00:00Z')] }, customer: cust('monthly@example.com') },
      { id: 's_old_annual', status: 'active', items: { data: [item(149000, 'year', '2026-06-01T15:00:00Z')] }, customer: cust('old.annual@example.com') },
      // A switcher: subscribed monthly in March, switched to annual in the portal on Dec 3.
      { id: 's_switch', status: 'active', created: sec('2026-03-01T00:00:00Z'), items: { data: [item(149000, 'year', '2026-12-03T15:00:00Z')] }, customer: cust('switcher@example.com') },
    ];
    await run();
    expect(grantFor('promo.pro@example.com')).toEqual(['pro:promo.pro@example.com:2026-12', 'promo.pro@example.com', PRO_MONTHLY_CREDITS * 2, 'pro_monthly']);
    expect(grantFor('promo.team@example.com')?.[2]).toBe(TEAM_MONTHLY_CREDITS * 2);
    expect(grantFor('switcher@example.com')?.[2]).toBe(PRO_MONTHLY_CREDITS * 2);
    expect(grantFor('monthly@example.com')?.[2]).toBe(PRO_MONTHLY_CREDITS);
    expect(grantFor('old.annual@example.com')?.[2]).toBe(PRO_MONTHLY_CREDITS);
  });

  it('a pooled Team org on a promo sub replenishes to the ceiling promoPoolCeiling returns; a non-promo pool is untouched', async () => {
    subs.list = [
      { id: 's_pool_promo', status: 'active', items: { data: [item(499000, 'year', '2026-12-01T15:00:00Z')] }, customer: cust('pool.promo@example.com') },
      { id: 's_pool_plain', status: 'active', items: { data: [item(49900, 'month', '2026-12-01T15:00:00Z')] }, customer: cust('pool.plain@example.com') },
    ];
    const promoOrg = { orgId: 'o1', name: 'A', poolId: 'p1', seatLimit: 5, monthlyCredits: TEAM_MONTHLY_CREDITS, planKey: 'team', subscriptionId: 's_pool_promo' };
    const plainOrg = { orgId: 'o2', name: 'B', poolId: 'p2', seatLimit: 5, monthlyCredits: TEAM_MONTHLY_CREDITS, planKey: 'team', subscriptionId: 's_pool_plain' };
    pools.bySub = new Map<string, unknown>([['s_pool_promo', promoOrg], ['s_pool_plain', plainOrg]]);
    await run();
    expect(promoPoolCeiling).toHaveBeenCalledTimes(1);
    expect(promoPoolCeiling).toHaveBeenCalledWith(promoOrg, '2026-12', 2);
    const calls = replenishPool.mock.calls as unknown as Array<[{ orgId: string; monthlyCredits: number }, string]>;
    expect(calls.find((c) => c[0].orgId === 'o1')?.[0].monthlyCredits).toBe(TEAM_MONTHLY_CREDITS * 2);
    expect(calls.find((c) => c[0].orgId === 'o2')?.[0]).toBe(plainOrg);
    // Pooled subs never also grant personally.
    expect(grantFor('pool.promo@example.com')).toBeUndefined();
  });

  it('a pool already replenished this month at 1x is not topped up (promoPoolCeiling returns the normal ceiling)', async () => {
    subs.list = [
      { id: 's_pool_promo', status: 'active', items: { data: [item(499000, 'year', '2026-12-01T15:00:00Z')] }, customer: cust('pool.promo@example.com') },
    ];
    const org = { orgId: 'o1', name: 'A', poolId: 'p1', seatLimit: 5, monthlyCredits: TEAM_MONTHLY_CREDITS, planKey: 'team', subscriptionId: 's_pool_promo' };
    pools.bySub = new Map<string, unknown>([['s_pool_promo', org]]);
    promoPoolCeiling.mockImplementationOnce(async (o: { monthlyCredits: number }) => o.monthlyCredits);
    await run();
    const calls = replenishPool.mock.calls as unknown as Array<[{ monthlyCredits: number }, string]>;
    expect(calls[0][0]).toBe(org);
  });
});
