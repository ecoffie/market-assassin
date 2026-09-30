/**
 * The Pro renewal invoice must apply the same "Team supersedes Pro" rule as the monthly
 * run, or an Oct 10 renewal would grant what the Oct 1 run withheld.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const apply = vi.hoisted(() => vi.fn(async () => ({ applied: true, newBalance: 1500 })));
const decision = vi.hoisted(() => ({ next: { grant: true } as Record<string, unknown> }));
vi.mock('./credits', () => ({ applyCreditOnce: apply }));
vi.mock('./pro-allowance', () => ({ proAllowanceDecision: async () => decision.next }));
vi.mock('./team-pools', () => ({
  findPooledOrgBySubscription: vi.fn(), provisionPooledOrg: vi.fn(), replenishPool: vi.fn(),
  isPoolSchemaMissing: () => false, subscriptionIdFromInvoice: () => 'sub_pro',
}));
vi.mock('@/lib/stripe', () => ({ getStripe: vi.fn() }));

import { handleAppTierSubscriptionInvoice } from './app-tier-subscription';
import { PRO_MONTHLY_CREDITS } from './packages';

const proInvoice = {
  id: 'in_1', billing_reason: 'subscription_cycle', customer_email: 'MG@x.com', amount_paid: 14900,
  lines: { data: [{ price: { unit_amount: 14900 } }] },
} as never;

beforeEach(() => { apply.mockClear(); });

describe('Pro invoice allowance', () => {
  it('a personal payer gets the Pro allowance on the shared monthly key', async () => {
    decision.next = { grant: true };
    const r = await handleAppTierSubscriptionInvoice(proInvoice);
    expect(r).toMatchObject({ handled: true, applied: true, tier: 'pro' });
    const month = new Date().toISOString().slice(0, 7);
    expect(apply).toHaveBeenCalledWith(`pro:mg@x.com:${month}`, 'mg@x.com', PRO_MONTHLY_CREDITS, 'app_tier_pro');
  });

  it('a pooled team member gets NO Pro allowance (Team supersedes Pro)', async () => {
    decision.next = { grant: false, reason: 'team_pool_supersedes_pro', orgId: 'o1', detail: 'billed to team pool p1' };
    const r = await handleAppTierSubscriptionInvoice(proInvoice);
    expect(r).toMatchObject({ handled: true, applied: false, credits: 0, skipped: 'team_pool_supersedes_pro' });
    expect(apply).not.toHaveBeenCalled();
  });

  it('an unresolved billing context grants nothing (the daily run retries)', async () => {
    decision.next = { grant: false, reason: 'payer_unresolved', orgId: null, detail: 'x' };
    expect(await handleAppTierSubscriptionInvoice(proInvoice)).toMatchObject({ skipped: 'payer_unresolved' });
    expect(apply).not.toHaveBeenCalled();
  });
});
