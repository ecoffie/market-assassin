/**
 * "Upgrade now, get +500 credits" — the bonus is granted exactly once per subscription, only
 * from a PAID invoice on a subscription flagged by the early-upgrade endpoint.
 */
import { describe, it, expect, vi } from 'vitest';
import type Stripe from 'stripe';

vi.mock('./credits', () => ({ applyCreditOnce: vi.fn() }));
vi.mock('@/lib/stripe', () => ({ getStripe: () => { throw new Error('no live Stripe in unit tests'); } }));

const {
  handleTrialUpgradeBonusInvoice, hasEarlyUpgradeFlag, trialUpgradeBonusKey, EARLY_UPGRADE_FLAG,
} = await import('./trial-upgrade-bonus');
const { TRIAL_UPGRADE_BONUS_CREDITS } = await import('./packages');

function invoice(over: Record<string, unknown> = {}): Stripe.Invoice {
  return {
    id: 'in_1',
    status: 'paid',
    amount_paid: 14900,
    billing_reason: 'subscription_update',
    customer_email: 'buyer@x.com',
    parent: { subscription_details: { subscription: 'sub_123', metadata: { [EARLY_UPGRADE_FLAG]: '500' } } },
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

const deps = (apply: ReturnType<typeof ledger>['apply'], meta: Record<string, string> = {}) => ({
  apply,
  resolveEmail: async (inv: Stripe.Invoice) => inv.customer_email ?? null,
  retrieveSubscriptionMetadata: vi.fn(async () => meta),
});

describe('handleTrialUpgradeBonusInvoice', () => {
  it('grants the constant once for a paid, flagged invoice', async () => {
    const l = ledger();
    const r = await handleTrialUpgradeBonusInvoice(invoice(), deps(l.apply));
    expect(r).toMatchObject({ handled: true, applied: true, credits: 500, email: 'buyer@x.com', subscriptionId: 'sub_123' });
    expect(l.apply).toHaveBeenCalledWith(trialUpgradeBonusKey('sub_123'), 'buyer@x.com', TRIAL_UPGRADE_BONUS_CREDITS, 'trial_upgrade_bonus');
    expect(TRIAL_UPGRADE_BONUS_CREDITS).toBe(500);
  });

  it('a redelivery and a later renewal invoice on the same subscription do not grant again', async () => {
    const l = ledger();
    await handleTrialUpgradeBonusInvoice(invoice(), deps(l.apply));
    const again = await handleTrialUpgradeBonusInvoice(invoice(), deps(l.apply));
    const renewal = await handleTrialUpgradeBonusInvoice(invoice({ id: 'in_2', billing_reason: 'subscription_cycle' }), deps(l.apply));
    expect(again.applied).toBe(false);
    expect(renewal.applied).toBe(false);
    expect(l.balance).toBe(500);
  });

  it('never grants on an unflagged subscription (ordinary trial end or renewal)', async () => {
    const l = ledger();
    const d = deps(l.apply, {});
    const r = await handleTrialUpgradeBonusInvoice(
      invoice({ billing_reason: 'subscription_cycle', parent: { subscription_details: { subscription: 'sub_9', metadata: {} } } }), d);
    expect(r.handled).toBe(false);
    expect(l.apply).not.toHaveBeenCalled();
    expect(d.retrieveSubscriptionMetadata).not.toHaveBeenCalled(); // no Stripe read for every renewal
  });

  it('never grants on a $0 invoice (the trial-start invoice)', async () => {
    const l = ledger();
    const r = await handleTrialUpgradeBonusInvoice(invoice({ amount_paid: 0, billing_reason: 'subscription_create' }), deps(l.apply));
    expect(r.handled).toBe(false);
    expect(l.apply).not.toHaveBeenCalled();
  });

  it('never grants on an invoice that is not paid', async () => {
    const l = ledger();
    const r = await handleTrialUpgradeBonusInvoice(invoice({ status: 'open' }), deps(l.apply));
    expect(r.handled).toBe(false);
    expect(l.apply).not.toHaveBeenCalled();
  });

  it('reads the subscription when the invoice snapshot lacks the flag on the trial-ending invoice', async () => {
    const l = ledger();
    const d = deps(l.apply, { [EARLY_UPGRADE_FLAG]: '500' });
    const r = await handleTrialUpgradeBonusInvoice(
      invoice({ parent: { subscription_details: { subscription: 'sub_7', metadata: {} } } }), d);
    expect(d.retrieveSubscriptionMetadata).toHaveBeenCalledWith('sub_7');
    expect(r).toMatchObject({ handled: true, applied: true });
  });

  it('ignores the metadata VALUE: the amount is always the server constant', async () => {
    const l = ledger();
    await handleTrialUpgradeBonusInvoice(
      invoice({ parent: { subscription_details: { subscription: 'sub_8', metadata: { [EARLY_UPGRADE_FLAG]: '999999' } } } }),
      deps(l.apply));
    expect(l.balance).toBe(TRIAL_UPGRADE_BONUS_CREDITS);
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
