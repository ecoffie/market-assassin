/**
 * The invoice.paid grant (stripe-webhook → handleAppTierSubscriptionInvoice) applies the same
 * Mindy Day annual promo as the monthly cron, on the same monthly key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const apply = vi.hoisted(() => vi.fn(async () => ({ applied: true, newBalance: 0 })));
const retrieve = vi.hoisted(() => vi.fn());
const find = vi.hoisted(() => vi.fn());
const replenish = vi.hoisted(() => vi.fn(async () => ({ applied: true, granted: 1, newBalance: 1 })));
const ceiling = vi.hoisted(() => vi.fn(async (o: { monthlyCredits: number }, _m: string, mult: number) => o.monthlyCredits * mult));
vi.mock('./credits', () => ({ applyCreditOnce: apply }));
vi.mock('./pro-allowance', () => ({ proAllowanceDecision: async () => ({ grant: true }) }));
vi.mock('./team-pools', () => ({
  findPooledOrgBySubscription: find, provisionPooledOrg: vi.fn(), replenishPool: replenish, promoPoolCeiling: ceiling,
  isPoolSchemaMissing: () => false, subscriptionIdFromInvoice: () => 'sub_x',
}));
vi.mock('@/lib/stripe', () => ({ getStripe: () => ({ subscriptions: { retrieve } }) }));

import { handleAppTierSubscriptionInvoice } from './app-tier-subscription';
import { PRO_MONTHLY_CREDITS, TEAM_MONTHLY_CREDITS } from './packages';

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const invoice = (amount: number, interval: 'month' | 'year') => ({
  id: 'in_1', billing_reason: 'subscription_create', customer_email: 'buyer@x.com', amount_paid: amount,
  lines: { data: [{ price: { unit_amount: amount, recurring: { interval } } }] },
}) as never;
const annualSub = (start: string) => ({
  id: 'sub_x', status: 'active', current_period_start: sec(start),
  items: { data: [{ price: { recurring: { interval: 'year' } } }] },
});

beforeEach(() => {
  apply.mockClear(); retrieve.mockReset(); replenish.mockClear(); ceiling.mockClear(); find.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-01T16:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('app-tier invoice grant: Mindy Day annual promo', () => {
  it('Pro annual bought in the window → 2x on the shared monthly key', async () => {
    retrieve.mockResolvedValue(annualSub('2026-12-01T15:59:00Z'));
    const r = await handleAppTierSubscriptionInvoice(invoice(149000, 'year'));
    expect(r).toMatchObject({ handled: true, applied: true, tier: 'pro', credits: PRO_MONTHLY_CREDITS * 2 });
    expect(apply).toHaveBeenCalledWith('pro:buyer@x.com:2026-12', 'buyer@x.com', PRO_MONTHLY_CREDITS * 2, 'app_tier_pro');
  });

  it('Pro annual renewal whose period started outside the window → 1x', async () => {
    retrieve.mockResolvedValue(annualSub('2026-06-01T00:00:00Z'));
    const r = await handleAppTierSubscriptionInvoice(invoice(149000, 'year'));
    expect(r.credits).toBe(PRO_MONTHLY_CREDITS);
  });

  it('Pro monthly → 1x and Stripe is not even asked', async () => {
    const r = await handleAppTierSubscriptionInvoice(invoice(14900, 'month'));
    expect(r.credits).toBe(PRO_MONTHLY_CREDITS);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('before the window opens nothing is looked up and nothing changes', async () => {
    vi.setSystemTime(new Date('2026-11-27T12:00:00Z'));
    const r = await handleAppTierSubscriptionInvoice(invoice(149000, 'year'));
    expect(r.credits).toBe(PRO_MONTHLY_CREDITS);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('a failed subscription read grants NOTHING (not 1x, which would burn the month) and defers to the cron', async () => {
    retrieve.mockRejectedValue(new Error('stripe down'));
    const r = await handleAppTierSubscriptionInvoice(invoice(149000, 'year'));
    expect(r).toMatchObject({ handled: true, error: 'promo_check_failed' });
    expect(apply).not.toHaveBeenCalled();
  });

  it('a pooled Team annual bought in the window replenishes to the promo ceiling', async () => {
    retrieve.mockResolvedValue(annualSub('2026-12-01T15:00:00Z'));
    const org = { orgId: 'o1', name: 'A', poolId: 'p1', seatLimit: 5, monthlyCredits: TEAM_MONTHLY_CREDITS, planKey: 'team', subscriptionId: 'sub_x' };
    find.mockResolvedValue(org);
    await handleAppTierSubscriptionInvoice(invoice(499000, 'year'));
    expect(ceiling).toHaveBeenCalledWith(org, '2026-12', 2);
    expect((replenish.mock.calls[0] as unknown as [{ monthlyCredits: number }])[0].monthlyCredits).toBe(TEAM_MONTHLY_CREDITS * 2);
    expect(apply).not.toHaveBeenCalled();
  });
});
