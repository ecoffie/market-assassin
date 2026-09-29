import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./credits', () => ({ applyCreditOnce: vi.fn() }));
vi.mock('./credit-emails', () => ({ sendCreditReceiptEmail: vi.fn() }));
// Pooled team credits: keep the pure helpers real, stub the pool lookups/writes.
vi.mock('./team-pools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./team-pools')>()),
  findPooledOrgBySubscription: vi.fn().mockResolvedValue(null),
  replenishPool: vi.fn(),
}));
// Stub the Stripe client so the customer-email fallback is testable offline.
const retrieve = vi.fn();
vi.mock('@/lib/stripe', () => ({ getStripe: () => ({ customers: { retrieve } }) }));

import { handleMcpSubscriptionInvoice } from './stripe-subscription';
import * as credits from './credits';
import * as pools from './team-pools';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = (fn: unknown) => fn as any;

// Real price ids from SUBSCRIPTION_PLANS (packages.ts). GOS #015 ladder: Entry $99/500,
// Mid $249/1,500, Agency $999/8,000 — MONTHLY ONLY (annual deferred). The old $59 Starter
// + $19 Plus subs were archived 2026-07-19.
const ENTRY_MONTHLY = 'price_1TuxApK5zyiZ50PB8iMg8WqG';
const MID_MONTHLY = 'price_1TuxApK5zyiZ50PBPV40eCvG';
const ENTRY_CR = 500;
const MID_CR = 2000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoice = (over: any) => ({
  id: 'in_1',
  billing_reason: 'subscription_create',
  customer_email: 'buyer@x.com',
  lines: { data: [{ price: { id: ENTRY_MONTHLY } }] },
  ...over,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

beforeEach(() => {
  vi.clearAllMocks();
  m(credits.applyCreditOnce).mockResolvedValue({ applied: true, newBalance: ENTRY_CR });
});

describe('handleMcpSubscriptionInvoice', () => {
  it('grants a month of Entry credits on the monthly invoice, keyed by invoice id', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({}));
    expect(r).toMatchObject({ handled: true, applied: true, credits: ENTRY_CR, email: 'buyer@x.com', plan: 'entry', interval: 'month' });
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('in_1', 'buyer@x.com', ENTRY_CR, 'mcp_sub_monthly');
  });

  it('grants the correct allowance for a different tier (Mid = 2,000)', async () => {
    m(credits.applyCreditOnce).mockResolvedValue({ applied: true, newBalance: MID_CR });
    const r = await handleMcpSubscriptionInvoice(invoice({ lines: { data: [{ price: { id: MID_MONTHLY } }] } }));
    expect(r).toMatchObject({ handled: true, credits: MID_CR, plan: 'mid', interval: 'month' });
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('in_1', 'buyer@x.com', MID_CR, 'mcp_sub_monthly');
  });

  it('grants again on renewal (subscription_cycle) — fresh invoice id, fresh credits', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({ id: 'in_2', billing_reason: 'subscription_cycle' }));
    expect(r).toMatchObject({ handled: true, plan: 'entry', interval: 'month' });
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('in_2', 'buyer@x.com', ENTRY_CR, 'mcp_sub_monthly');
  });

  it('falls back to price metadata plan+interval when the price id is unrecognized', async () => {
    m(credits.applyCreditOnce).mockResolvedValue({ applied: true, newBalance: ENTRY_CR });
    const r = await handleMcpSubscriptionInvoice(invoice({
      lines: { data: [{ price: { id: 'price_unknown', metadata: { plan: 'entry', interval: 'month' } } }] },
    }));
    expect(r).toMatchObject({ handled: true, plan: 'entry', interval: 'month', credits: ENTRY_CR });
  });

  it('ignores non-subscription invoices (billing_reason=manual) — nothing granted', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({ billing_reason: 'manual' }));
    expect(r.handled).toBe(false);
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });

  it('ignores a subscription invoice whose lines map to no MCP plan (incl. the retired Starter/Plus prices)', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({ lines: { data: [{ price: { id: 'price_other_product' } }] } }));
    expect(r.handled).toBe(false);
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });

  it('retrieves the customer email when the invoice omits it', async () => {
    retrieve.mockResolvedValue({ email: 'FromCustomer@X.com' });
    await handleMcpSubscriptionInvoice(invoice({ customer_email: null, customer: 'cus_1' }));
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('in_1', 'fromcustomer@x.com', ENTRY_CR, 'mcp_sub_monthly');
  });

  it('errors cleanly (grants nothing) when no email can be resolved', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({ customer_email: null, customer: null }));
    expect(r).toMatchObject({ handled: true, plan: 'entry', error: 'no_email' });
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });
});

describe('handleMcpSubscriptionInvoice — pooled (multi-seat) subscriptions', () => {
  const pooledOrg = { orgId: 'o1', name: 'Acme', poolId: 'p1', seatLimit: 2, monthlyCredits: 3500, planKey: 'growth', subscriptionId: 'sub_growth' };

  it('funds the POOL monthly and never grants the buyer personally', async () => {
    m(pools.findPooledOrgBySubscription).mockResolvedValueOnce(pooledOrg);
    m(pools.replenishPool).mockResolvedValueOnce({ applied: true, granted: 3500, newBalance: 3500 });
    const r = await handleMcpSubscriptionInvoice(invoice({ parent: { subscription_details: { subscription: 'sub_growth' } } }));
    expect(r).toMatchObject({ handled: true, applied: true, credits: 3500 });
    expect(pools.replenishPool).toHaveBeenCalledWith(pooledOrg);
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });

  it('a pool lookup failure grants NOTHING personally (the cron self-heals) — no double allowance', async () => {
    m(pools.findPooledOrgBySubscription).mockRejectedValueOnce(new Error('connection reset'));
    const r = await handleMcpSubscriptionInvoice(invoice({ parent: { subscription_details: { subscription: 'sub_growth' } } }));
    expect(r).toMatchObject({ handled: true, error: 'pool_grant_failed' });
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });

  it('before the migration is applied (legacy schema) the personal grant is unchanged', async () => {
    m(pools.findPooledOrgBySubscription).mockRejectedValueOnce(new Error('column organizations.seat_limit does not exist'));
    const r = await handleMcpSubscriptionInvoice(invoice({ parent: { subscription_details: { subscription: 'sub_growth' } } }));
    expect(r).toMatchObject({ handled: true, applied: true, credits: ENTRY_CR });
    expect(credits.applyCreditOnce).toHaveBeenCalledTimes(1);
  });
});
