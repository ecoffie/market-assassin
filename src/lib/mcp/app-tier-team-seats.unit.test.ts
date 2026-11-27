/** Team by seats (2026-11-24): a seat price is Team by price id, with seats x 1,500 shared credits and that seat limit. */
import { describe, it, expect, vi } from 'vitest';

const provision = vi.hoisted(() => vi.fn(async () => ({})));
const find = vi.hoisted(() => vi.fn());
const replenish = vi.hoisted(() => vi.fn(async () => ({ applied: true, granted: 4500, newBalance: 4500 })));
vi.mock('./credits', () => ({ applyCreditOnce: vi.fn() }));
vi.mock('./pro-allowance', () => ({ proAllowanceDecision: async () => ({ grant: true }) }));
vi.mock('./team-pools', () => ({
  findPooledOrgBySubscription: find, provisionPooledOrg: provision, replenishPool: replenish,
  isPoolSchemaMissing: () => false, subscriptionIdFromInvoice: () => 'sub_team3',
}));
vi.mock('@/lib/stripe', () => ({ getStripe: vi.fn() }));
vi.stubEnv('STRIPE_TEAM_3_SEATS_MONTHLY_PRICE', 'price_team3m');

describe('Team seat invoice', () => {
  it('provisions the pool with 3 seats and 4,500 credits, matched by price id ($366 is no Team amount)', async () => {
    const { handleAppTierSubscriptionInvoice } = await import('./app-tier-subscription');
    find.mockResolvedValueOnce(null).mockResolvedValueOnce({ orgId: 'o1' });
    const r = await handleAppTierSubscriptionInvoice({
      id: 'in_t', billing_reason: 'subscription_cycle', customer_email: 'lead@x.co', customer: 'cus_1', amount_paid: 36600,
      lines: { data: [{ price: { id: 'price_team3m', unit_amount: 36600 } }] },
    } as never);
    expect(provision).toHaveBeenCalledWith(expect.objectContaining({ seatLimit: 3, monthlyCredits: 4500, planKey: 'team' }));
    expect(r).toMatchObject({ handled: true, tier: 'team', credits: 4500 });
  });
});
