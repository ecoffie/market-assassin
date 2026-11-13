/**
 * "Upgrade now, get +500 credits" — the CHARGE side (owner, 2026-11-13).
 *
 * Ends the caller's own Pro/Team Stripe trial now so the first invoice is charged today. The
 * bonus is NOT granted here: this only stamps `metadata.early_upgrade_bonus` in the same Stripe
 * update that ends the trial, and the webhook grants the credits once that invoice is PAID
 * (src/lib/mcp/trial-upgrade-bonus.ts).
 *
 * Safety:
 *   - Ownership: the subscription's customer must be one of the Stripe customer records behind
 *     the caller's verified email or verified linked emails. A subscription id alone proves nothing.
 *   - `payment_behavior: 'error_if_incomplete'`: if the card is declined or needs authentication,
 *     Stripe rejects the whole update (HTTP 402). The trial continues, no metadata is written,
 *     nothing is charged, and no bonus can follow.
 *   - Idempotent: a second click finds the subscription no longer trialing and reports
 *     `already_upgraded` without calling update. Two clicks in the same minute share a Stripe
 *     idempotency key, so even a race makes one update. The bonus key is per subscription.
 */
import type Stripe from 'stripe';
import { resolveStripeCustomerByEmail } from '@/lib/stripe/resolve-customer';
import { appTierForAmount } from '@/lib/mcp/app-tier-subscription';
import { EARLY_UPGRADE_FLAG, hasEarlyUpgradeFlag } from '@/lib/mcp/trial-upgrade-bonus';
import { TRIAL_UPGRADE_BONUS_CREDITS } from '@/lib/mcp/packages';
import { subscriptionKind } from './subscription-list';
import type { TrialUpgradeOffer } from './trial-upgrade-offer';

type SubLike = Pick<Stripe.Subscription, 'id' | 'status' | 'metadata' | 'items' | 'cancel_at_period_end' | 'trial_end' | 'customer'>;

function firstPrice(sub: Pick<Stripe.Subscription, 'items'>): Stripe.Price | null {
  const p = sub.items?.data?.[0]?.price;
  return p && typeof p === 'object' ? p : null;
}

/** The app tier a subscription is billed at (by price amount), or null. */
export function subscriptionAppTier(sub: Pick<Stripe.Subscription, 'items' | 'metadata'>): 'pro' | 'team' | null {
  if (subscriptionKind(sub) !== 'app') return null;
  return appTierForAmount(firstPrice(sub)?.unit_amount ?? null);
}

/**
 * Eligible = a live Pro/Team trial that has not been upgraded already and is not set to cancel.
 * (A trial set to cancel would be charged and then end — never offer that.)
 */
export function isTrialUpgradeEligible(sub: SubLike): boolean {
  return sub.status === 'trialing'
    && !sub.cancel_at_period_end
    && !hasEarlyUpgradeFlag(sub.metadata)
    && subscriptionAppTier(sub) !== null;
}

export function offerFromSubscription(sub: SubLike, planName: string | null, billedTo: string): TrialUpgradeOffer | null {
  const tier = subscriptionAppTier(sub);
  if (!tier || !isTrialUpgradeEligible(sub)) return null;
  const price = firstPrice(sub);
  return {
    subscriptionId: sub.id,
    tier,
    planName: planName || price?.nickname || (tier === 'team' ? 'Mindy Team' : 'Mindy Pro'),
    amount: typeof price?.unit_amount === 'number' ? price.unit_amount / 100 : null,
    interval: price?.recurring?.interval ?? null,
    trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    billedTo,
  };
}

/** Every Stripe customer id behind the caller's verified emails (duplicates included). */
export async function callerCustomers(stripe: Stripe, emails: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>(); // customer id → email
  for (const email of emails) {
    const r = await resolveStripeCustomerByEmail(stripe, email);
    for (const c of r.all) if (!out.has(c.id)) out.set(c.id, email);
    if (r.customer && !out.has(r.customer.id)) out.set(r.customer.id, email);
  }
  return out;
}

/** The caller's live trial offers (normally zero or one). */
export async function listTrialUpgradeOffers(stripe: Stripe, emails: string[]): Promise<TrialUpgradeOffer[]> {
  const customers = await callerCustomers(stripe, emails);
  const offers: TrialUpgradeOffer[] = [];
  for (const [customerId, email] of customers) {
    const subs = await stripe.subscriptions.list({
      customer: customerId, status: 'trialing', limit: 10, expand: ['data.items.data.price'],
    });
    for (const sub of subs.data) {
      if (!isTrialUpgradeEligible(sub)) continue;
      const productId = firstPrice(sub)?.product;
      let name: string | null = null;
      if (typeof productId === 'string') {
        try {
          const p = await stripe.products.retrieve(productId);
          name = p.deleted ? null : p.name;
        } catch { /* fall back to a generic label */ }
      }
      const offer = offerFromSubscription(sub, name, email);
      if (offer) offers.push(offer);
    }
  }
  return offers;
}

export type TrialUpgradeResult =
  | { ok: true; status: 'upgraded' | 'already_upgraded'; subscriptionId: string; amountCharged: number | null; bonusCredits: number }
  | { ok: false; httpStatus: 400 | 402 | 403 | 404 | 409 | 502; code: string; message: string };

const customerIdOf = (c: Stripe.Subscription['customer']) => (typeof c === 'string' ? c : c?.id);

/** Minute bucket: concurrent clicks share a Stripe idempotency key; a retry later gets a new one. */
export function trialUpgradeIdempotencyKey(subscriptionId: string, now: Date = new Date()): string {
  return `trial-upgrade:${subscriptionId}:${Math.floor(now.getTime() / 60_000)}`;
}

function isCardError(err: unknown): boolean {
  const e = err as { type?: string; statusCode?: number; code?: string };
  return e?.type === 'StripeCardError' || e?.statusCode === 402 || e?.code === 'card_declined';
}

/**
 * End the caller's trial now. `subscriptionId` is optional: without it the caller's single
 * eligible trial is used (more than one → 409, pick it in billing settings).
 */
export async function upgradeTrialNow(
  stripe: Stripe,
  emails: string[],
  subscriptionId?: string | null,
  now: Date = new Date(),
): Promise<TrialUpgradeResult> {
  let customers: Map<string, string>;
  try {
    customers = await callerCustomers(stripe, emails);
  } catch (err) {
    console.error('[trial-upgrade] customer lookup failed:', err);
    return { ok: false, httpStatus: 502, code: 'stripe_unavailable', message: 'We could not reach billing. Nothing was charged. Please try again.' };
  }
  if (customers.size === 0) {
    return { ok: false, httpStatus: 404, code: 'no_trial', message: 'We could not find a free trial on your account.' };
  }

  let id = (subscriptionId || '').trim();
  if (!id) {
    let offers: TrialUpgradeOffer[];
    try {
      offers = await listTrialUpgradeOffers(stripe, emails);
    } catch (err) {
      console.error('[trial-upgrade] trial lookup failed:', err);
      return { ok: false, httpStatus: 502, code: 'stripe_unavailable', message: 'We could not reach billing. Nothing was charged. Please try again.' };
    }
    if (offers.length === 0) return { ok: false, httpStatus: 404, code: 'no_trial', message: 'We could not find a free trial on your account.' };
    if (offers.length > 1) return { ok: false, httpStatus: 409, code: 'multiple_trials', message: 'You have more than one trial. Choose which one to upgrade in Settings → Billing.' };
    id = offers[0].subscriptionId;
  }
  if (!/^sub_[A-Za-z0-9]+$/.test(id)) {
    return { ok: false, httpStatus: 400, code: 'bad_subscription', message: 'That subscription id is not valid.' };
  }

  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(id, { expand: ['items.data.price'] });
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode;
    if (status === 404) return { ok: false, httpStatus: 404, code: 'no_trial', message: 'We could not find that subscription on your account.' };
    console.error('[trial-upgrade] retrieve failed:', err);
    return { ok: false, httpStatus: 502, code: 'stripe_unavailable', message: 'We could not reach billing. Nothing was charged. Please try again.' };
  }

  // Ownership. Same 404 as "not found" so subscription ids can't be probed.
  const owner = customerIdOf(sub.customer);
  if (!owner || !customers.has(owner)) {
    return { ok: false, httpStatus: 404, code: 'no_trial', message: 'We could not find that subscription on your account.' };
  }

  // Idempotent repeat: already upgraded through this offer.
  if (sub.status !== 'trialing') {
    if (hasEarlyUpgradeFlag(sub.metadata) && (sub.status === 'active' || sub.status === 'past_due')) {
      return { ok: true, status: 'already_upgraded', subscriptionId: sub.id, amountCharged: null, bonusCredits: TRIAL_UPGRADE_BONUS_CREDITS };
    }
    return { ok: false, httpStatus: 409, code: 'not_trialing', message: 'This plan is not in a free trial, so there is nothing to upgrade.' };
  }
  if (subscriptionAppTier(sub) === null) {
    return { ok: false, httpStatus: 409, code: 'not_eligible', message: 'This offer is for Mindy Pro and Team trials only.' };
  }
  if (sub.cancel_at_period_end) {
    return { ok: false, httpStatus: 409, code: 'cancelling', message: 'This trial is set to cancel. Turn cancellation off in Manage billing before upgrading.' };
  }

  try {
    const updated = await stripe.subscriptions.update(
      sub.id,
      {
        trial_end: 'now',
        proration_behavior: 'none',
        payment_behavior: 'error_if_incomplete',
        metadata: { [EARLY_UPGRADE_FLAG]: String(TRIAL_UPGRADE_BONUS_CREDITS) },
        expand: ['latest_invoice'],
      },
      { idempotencyKey: trialUpgradeIdempotencyKey(sub.id, now) },
    );
    const inv = updated.latest_invoice && typeof updated.latest_invoice === 'object' ? updated.latest_invoice : null;
    const paid = typeof inv?.amount_paid === 'number' ? inv.amount_paid / 100 : null;
    return { ok: true, status: 'upgraded', subscriptionId: updated.id, amountCharged: paid, bonusCredits: TRIAL_UPGRADE_BONUS_CREDITS };
  } catch (err) {
    if (isCardError(err)) {
      return {
        ok: false, httpStatus: 402, code: 'payment_failed',
        message: 'Your card was not charged and your trial continues. Update your card in Manage billing, then try again.',
      };
    }
    console.error('[trial-upgrade] update failed:', err);
    return { ok: false, httpStatus: 502, code: 'stripe_error', message: 'We could not upgrade your plan right now. Nothing was changed. Please try again.' };
  }
}
