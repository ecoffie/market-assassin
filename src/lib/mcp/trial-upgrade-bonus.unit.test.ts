/**
 * The upgrade bonus: 1,000 credits ONCE PER PERSON on their first paid Pro/Team payment
 * (owner, 2026-11-18). Free member upgrading, trial paying early, trial converting at day 14.
 */
import { describe, it, expect, vi } from 'vitest';
import type Stripe from 'stripe';

vi.mock('./credits', () => ({ applyCreditOnce: vi.fn() }));
vi.mock('@/lib/stripe', () => ({ getStripe: () => { throw new Error('no live Stripe in unit tests'); } }));

const {
  handleTrialUpgradeBonusInvoice, hasEarlyUpgradeFlag, upgradeBonusKey, EARLY_UPGRADE_FLAG, UPGRADE_BONUS_REASON,
} = await import('./trial-upgrade-bonus');
const { UPGRADE_BONUS_CREDITS, TRIAL_UPGRADE_BONUS_CREDITS } = await import('./packages');

function invoice(over: Record<string, unknown> = {}): Stripe.Invoice {
  return {
    id: 'in_1',
    status: 'paid',
    amount_paid: 14900,
    billing_reason: 'subscription_create',
    customer: 'cus_1',
    customer_email: 'buyer@x.com',
    lines: { data: [{ price: { unit_amount: 14900 } }] },
    parent: { subscription_details: { subscription: 'sub_123', metadata: {} } },
    ...over,
  } as unknown as Stripe.Invoice;
}

/** In-memory applyCreditOnce: the key makes the second call a no-op, like mcp_apply_credit. */
function ledger() {
  const seen = new Set<string>();
  let balance = 0;
  const apply = vi.fn(async (key: string, _email: string, credits: number) => {
    if (seen.has(key)) return { applied: false, newBalance: balance };
    seen.add(key);
    balance += credits;
    return { applied: true, newBalance: balance };
  });
  return { apply, get balance() { return balance; } };
}

const deps = (apply: ReturnType<typeof ledger>['apply'], opts: { meta?: Record<string, string>; earlier?: boolean } = {}) => ({
  apply,
  resolveEmail: async (inv: Stripe.Invoice) => inv.customer_email ?? null,
  retrieveSubscriptionMetadata: vi.fn(async () => opts.meta ?? {}),
  hasEarlierPaidInvoice: vi.fn(async () => opts.earlier ?? false),
});

describe('upgrade bonus', () => {
  it('is 1,000, and the trial "Upgrade now" offer shows the same number', () => {
    expect(UPGRADE_BONUS_CREDITS).toBe(1000);
    expect(TRIAL_UPGRADE_BONUS_CREDITS).toBe(UPGRADE_BONUS_CREDITS);
  });

  it.each([
    ['a free member upgrading (first invoice)', 'subscription_create'],
    ['a trial paying early', 'subscription_update'],
    ['a trial converting at day 14', 'subscription_cycle'],
  ])('grants once on %s', async (_label, reason) => {
    const l = ledger();
    const r = await handleTrialUpgradeBonusInvoice(invoice({ billing_reason: reason }), deps(l.apply));
    expect(r).toMatchObject({ handled: true, applied: true, credits: 1000, email: 'buyer@x.com', subscriptionId: 'sub_123' });
    expect(l.apply).toHaveBeenCalledWith(upgradeBonusKey('buyer@x.com'), 'buyer@x.com', 1000, UPGRADE_BONUS_REASON);
  });

  it('never on a renewal: an earlier paid invoice means the first payment already happened', async () => {
    const l = ledger();
    const r = await handleTrialUpgradeBonusInvoice(invoice({ billing_reason: 'subscription_cycle' }), deps(l.apply, { earlier: true }));
    expect(r).toMatchObject({ handled: true, skipped: 'not_first_payment' });
    expect(l.apply).not.toHaveBeenCalled();
  });

  it('once per PERSON: a redelivery or a second subscription does not grant again', async () => {
    const l = ledger();
    await handleTrialUpgradeBonusInvoice(invoice(), deps(l.apply));
    const again = await handleTrialUpgradeBonusInvoice(invoice(), deps(l.apply));
    const otherSub = await handleTrialUpgradeBonusInvoice(
      invoice({ id: 'in_9', parent: { subscription_details: { subscription: 'sub_999', metadata: {} } } }), deps(l.apply));
    expect(again.applied).toBe(false);
    expect(otherSub.applied).toBe(false);
    expect(l.balance).toBe(1000);
    expect(upgradeBonusKey(' Buyer@X.com ')).toBe(upgradeBonusKey('buyer@x.com'));
  });

  it('never on a $0 invoice (the trial-start invoice)', async () => {
    const l = ledger();
    const r = await handleTrialUpgradeBonusInvoice(invoice({ amount_paid: 0 }), deps(l.apply));
    expect(r.handled).toBe(false);
    expect(l.apply).not.toHaveBeenCalled();
  });

  it('never on an invoice that is not paid', async () => {
    const l = ledger();
    const r = await handleTrialUpgradeBonusInvoice(invoice({ status: 'open' }), deps(l.apply));
    expect(r.handled).toBe(false);
  });

  it('never on a non-Pro/Team invoice (e.g. an MCP credits plan)', async () => {
    const l = ledger();
    const d = deps(l.apply);
    const r = await handleTrialUpgradeBonusInvoice(invoice({ amount_paid: 5900, lines: { data: [{ price: { unit_amount: 5900 } }] } }), d);
    expect(r.handled).toBe(false);
    expect(l.apply).not.toHaveBeenCalled();
  });

  it('an early-upgrade invoice with an unusual line still counts via the subscription flag', async () => {
    const l = ledger();
    const d = deps(l.apply, { meta: { [EARLY_UPGRADE_FLAG]: '1000' } });
    const r = await handleTrialUpgradeBonusInvoice(
      invoice({ amount_paid: 7450, billing_reason: 'subscription_update', lines: { data: [{ price: { unit_amount: null } }] } }), d);
    expect(d.retrieveSubscriptionMetadata).toHaveBeenCalledWith('sub_123');
    expect(r).toMatchObject({ handled: true, applied: true, credits: 1000 });
  });

  it('a ledger failure throws (so the webhook returns 500 and Stripe retries)', async () => {
    const apply = vi.fn(async () => { throw new Error('db down'); });
    await expect(handleTrialUpgradeBonusInvoice(invoice(), deps(apply as never))).rejects.toThrow('db down');
  });

  it('no email is reported, not thrown', async () => {
    const l = ledger();
    const r = await handleTrialUpgradeBonusInvoice(invoice(), { ...deps(l.apply), resolveEmail: async () => null });
    expect(r).toMatchObject({ handled: true, error: 'no_email' });
    expect(l.apply).not.toHaveBeenCalled();
  });
});

describe('hasEarlyUpgradeFlag', () => {
  it('requires a non-empty, non-zero value', () => {
    expect(hasEarlyUpgradeFlag({ [EARLY_UPGRADE_FLAG]: '500' })).toBe(true);
    expect(hasEarlyUpgradeFlag({ [EARLY_UPGRADE_FLAG]: '' })).toBe(false);
    expect(hasEarlyUpgradeFlag({ [EARLY_UPGRADE_FLAG]: '0' })).toBe(false);
    expect(hasEarlyUpgradeFlag({})).toBe(false);
    expect(hasEarlyUpgradeFlag(null)).toBe(false);
  });
});
