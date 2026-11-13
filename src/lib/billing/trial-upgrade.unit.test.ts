/**
 * Ending a trial early: ownership, eligibility, payment failure and idempotency, against a
 * fake Stripe client (no live Stripe).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

vi.mock('@/lib/stripe', () => ({ getStripe: () => { throw new Error('no live Stripe'); } }));
vi.mock('@/lib/mcp/credits', () => ({ applyCreditOnce: vi.fn() }));
vi.mock('@/lib/stripe/resolve-customer', () => ({
  resolveStripeCustomerByEmail: vi.fn(async (_s: unknown, email: string) => {
    const map: Record<string, string[]> = { 'me@x.com': ['cus_me', 'cus_me_dup'], 'alt@x.com': ['cus_alt'] };
    const ids = map[email] ?? [];
    const all = ids.map((id) => ({ id }));
    return { customer: all[0] ?? null, all };
  }),
}));

const { upgradeTrialNow, listTrialUpgradeOffers, isTrialUpgradeEligible, trialUpgradeIdempotencyKey } = await import('./trial-upgrade');
const { EARLY_UPGRADE_FLAG } = await import('@/lib/mcp/trial-upgrade-bonus');

function sub(over: Partial<Record<string, unknown>> = {}): Stripe.Subscription {
  return {
    id: 'sub_abc',
    status: 'trialing',
    customer: 'cus_me',
    cancel_at_period_end: false,
    trial_end: 1_900_000_000,
    metadata: {},
    items: { data: [{ price: { id: 'price_pro', unit_amount: 14900, currency: 'usd', recurring: { interval: 'month' }, product: 'prod_pro', nickname: null } }] },
    ...over,
  } as unknown as Stripe.Subscription;
}

function fakeStripe(current: Stripe.Subscription, opts: { updateError?: unknown } = {}) {
  const state = { sub: current };
  const update = vi.fn(async (id: string, params: Record<string, unknown>) => {
    if (opts.updateError) throw opts.updateError;
    state.sub = { ...state.sub, status: 'active', metadata: { ...state.sub.metadata, ...(params.metadata as object) } } as Stripe.Subscription;
    return { ...state.sub, id, latest_invoice: { amount_paid: 14900 } };
  });
  const stripe = {
    subscriptions: {
      retrieve: vi.fn(async () => state.sub),
      update,
      list: vi.fn(async ({ customer }: { customer: string }) => ({
        data: customerOf(state.sub) === customer && state.sub.status === 'trialing' ? [state.sub] : [],
      })),
    },
    products: { retrieve: vi.fn(async () => ({ name: 'Mindy Pro', deleted: false })) },
  };
  return { stripe: stripe as unknown as Stripe, update, state };
}
const customerOf = (s: Stripe.Subscription) => (typeof s.customer === 'string' ? s.customer : s.customer.id);

beforeEach(() => vi.clearAllMocks());

describe('upgradeTrialNow', () => {
  it('ends the trial now, with no proration, refusing to leave an unpaid invoice, and stamps the flag', async () => {
    const { stripe, update } = fakeStripe(sub());
    const r = await upgradeTrialNow(stripe, ['me@x.com'], 'sub_abc', new Date(120_000));
    expect(r).toMatchObject({ ok: true, status: 'upgraded', amountCharged: 149, bonusCredits: 500 });
    expect(update).toHaveBeenCalledTimes(1);
    const [id, params, options] = update.mock.calls[0] as unknown as [string, Record<string, unknown>, Record<string, unknown>];
    expect(id).toBe('sub_abc');
    expect(params).toMatchObject({
      trial_end: 'now', proration_behavior: 'none', payment_behavior: 'error_if_incomplete',
      metadata: { [EARLY_UPGRADE_FLAG]: '500' },
    });
    expect(options).toEqual({ idempotencyKey: trialUpgradeIdempotencyKey('sub_abc', new Date(120_000)) });
  });

  it('owns a subscription on a duplicate customer record or a linked email', async () => {
    const dup = fakeStripe(sub({ customer: 'cus_me_dup' }));
    expect((await upgradeTrialNow(dup.stripe, ['me@x.com'], 'sub_abc')).ok).toBe(true);
    const linked = fakeStripe(sub({ customer: 'cus_alt' }));
    expect((await upgradeTrialNow(linked.stripe, ['me@x.com', 'alt@x.com'], 'sub_abc')).ok).toBe(true);
  });

  it('refuses someone else\'s subscription with a 404 and never updates it', async () => {
    const { stripe, update } = fakeStripe(sub({ customer: 'cus_stranger' }));
    const r = await upgradeTrialNow(stripe, ['me@x.com'], 'sub_abc');
    expect(r).toMatchObject({ ok: false, httpStatus: 404, code: 'no_trial' });
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a subscription that is not trialing (409)', async () => {
    const { stripe, update } = fakeStripe(sub({ status: 'active' }));
    const r = await upgradeTrialNow(stripe, ['me@x.com'], 'sub_abc');
    expect(r).toMatchObject({ ok: false, httpStatus: 409, code: 'not_trialing' });
    expect(update).not.toHaveBeenCalled();
  });

  it('a second click after success is already_upgraded and does not charge again', async () => {
    const f = fakeStripe(sub());
    await upgradeTrialNow(f.stripe, ['me@x.com'], 'sub_abc');
    const second = await upgradeTrialNow(f.stripe, ['me@x.com'], 'sub_abc');
    expect(second).toMatchObject({ ok: true, status: 'already_upgraded' });
    expect(f.update).toHaveBeenCalledTimes(1);
  });

  it('refuses an MCP credits plan / non-app price (409 not_eligible)', async () => {
    const { stripe, update } = fakeStripe(sub({ items: { data: [{ price: { id: 'price_x', unit_amount: 5900, recurring: { interval: 'month' }, product: 'p' } }] } }));
    const r = await upgradeTrialNow(stripe, ['me@x.com'], 'sub_abc');
    expect(r).toMatchObject({ ok: false, httpStatus: 409, code: 'not_eligible' });
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a trial set to cancel', async () => {
    const { stripe, update } = fakeStripe(sub({ cancel_at_period_end: true }));
    expect(await upgradeTrialNow(stripe, ['me@x.com'], 'sub_abc')).toMatchObject({ ok: false, code: 'cancelling' });
    expect(update).not.toHaveBeenCalled();
  });

  it('a declined card is a 402 that says nothing was charged', async () => {
    const { stripe } = fakeStripe(sub(), { updateError: Object.assign(new Error('declined'), { type: 'StripeCardError', statusCode: 402 }) });
    const r = await upgradeTrialNow(stripe, ['me@x.com'], 'sub_abc');
    expect(r).toMatchObject({ ok: false, httpStatus: 402, code: 'payment_failed' });
    if (!r.ok) expect(r.message).toMatch(/not charged/);
  });

  it('any other Stripe failure is a 502', async () => {
    const { stripe } = fakeStripe(sub(), { updateError: new Error('boom') });
    expect(await upgradeTrialNow(stripe, ['me@x.com'], 'sub_abc')).toMatchObject({ ok: false, httpStatus: 502 });
  });

  it('without an id, upgrades the caller\'s single trial', async () => {
    const { stripe, update } = fakeStripe(sub());
    expect(await upgradeTrialNow(stripe, ['me@x.com'])).toMatchObject({ ok: true, status: 'upgraded' });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('no Stripe customer at all is a 404', async () => {
    const { stripe } = fakeStripe(sub());
    expect(await upgradeTrialNow(stripe, ['nobody@x.com'], 'sub_abc')).toMatchObject({ ok: false, httpStatus: 404 });
  });

  it('rejects a malformed subscription id', async () => {
    const { stripe } = fakeStripe(sub());
    expect(await upgradeTrialNow(stripe, ['me@x.com'], 'not-a-sub')).toMatchObject({ ok: false, httpStatus: 400 });
  });
});

describe('offers', () => {
  it('lists the caller\'s eligible trial with price + plan name', async () => {
    const { stripe } = fakeStripe(sub({ items: { data: [{ price: { id: 'p', unit_amount: 499000, recurring: { interval: 'year' }, product: 'prod_team' } }] } }));
    const offers = await listTrialUpgradeOffers(stripe, ['me@x.com']);
    expect(offers).toEqual([expect.objectContaining({ subscriptionId: 'sub_abc', tier: 'team', amount: 4990, interval: 'year', planName: 'Mindy Pro', billedTo: 'me@x.com' })]);
  });

  it('an already-flagged trial is not eligible', () => {
    expect(isTrialUpgradeEligible(sub())).toBe(true);
    expect(isTrialUpgradeEligible(sub({ metadata: { [EARLY_UPGRADE_FLAG]: '500' } }))).toBe(false);
  });

  it('idempotency key is stable within a minute and changes after', () => {
    expect(trialUpgradeIdempotencyKey('sub_a', new Date(60_000))).toBe(trialUpgradeIdempotencyKey('sub_a', new Date(119_999)));
    expect(trialUpgradeIdempotencyKey('sub_a', new Date(60_000))).not.toBe(trialUpgradeIdempotencyKey('sub_a', new Date(120_000)));
  });
});
