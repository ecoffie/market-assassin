/**
 * Ending Mindy app access when a Mindy Pro / Team SUBSCRIPTION ends (2026-11-13).
 *
 * The gap this closes: checkout of a Mindy Pro/Team subscription (including the $0 14-day trial
 * checkout) sets access_briefings=true with no expiry plus the KV `briefings:` key, and the
 * cancellation handler only knew FHC and Alert Pro. So a cancelled trial — or any cancelled Pro
 * subscription — kept Pro forever (found on the first two trial sign-ups, Nov 12).
 *
 * Rule: when a Mindy app subscription reaches a TERMINAL status (canceled / unpaid /
 * incomplete_expired), remove Pro (and Team, for a Team subscription) — UNLESS the person still
 * has another source of Pro. Every check fails SAFE: if a check errors or a source can't be read,
 * access is KEPT and the reason is returned (a paying customer must never be locked out by a
 * lookup failure). past_due is NOT terminal: Stripe is still retrying the card.
 *
 * A trial cancelled mid-way stays `trialing` (cancel_at_period_end) until the trial ends, so
 * access lasts exactly as long as the trial they were given.
 */
import type Stripe from 'stripe';

/** The Stripe product behind every Mindy app plan (Pro and Team, monthly/annual, trial links). */
export const MINDY_APP_PRODUCT = 'prod_UI5RXVGKsdywuf';

/** Team prices (monthly, old annual, new annual) — a Team sub also owns access_team. */
export const MINDY_TEAM_PRICES = new Set([
  'price_1TZxaaK5zyiZ50PBzhQJ1Pk8',
  'price_1TZxcAK5zyiZ50PBcBg0ZvoV',
  'price_1Uaz3WK5zyiZ50PBKQY8W1WX',
]);

const TERMINAL = new Set(['canceled', 'unpaid', 'incomplete_expired']);
const LIVE = new Set(['active', 'trialing', 'past_due']);

/** Purchases that grant Pro on their own (bundles, lifetime) — matched on product id or name. */
const LIFETIME_PRODUCT_IDS = new Set([
  'pro', 'pro-giant-bundle', 'ultimate', 'ultimate-govcon-bundle', 'complete', 'briefings_lifetime',
]);
const LIFETIME_NAME = /ultimate|giant|lifetime|founder|bundle/i;

const productOf = (item: Stripe.SubscriptionItem): string | undefined => {
  const p = item.price?.product;
  return typeof p === 'string' ? p : p?.id;
};

export function isMindyAppSubscription(sub: Pick<Stripe.Subscription, 'items'>): boolean {
  return sub.items.data.some((i) => productOf(i) === MINDY_APP_PRODUCT);
}

export function isTeamSubscription(sub: Pick<Stripe.Subscription, 'items' | 'metadata'>): boolean {
  if ((sub.metadata?.tier || '').startsWith('team')) return true;
  return sub.items.data.some((i) => MINDY_TEAM_PRICES.has(i.price?.id || '') || i.price?.unit_amount === 49900 || i.price?.unit_amount === 402700);
}

export function isTerminalStatus(status: string): boolean {
  return TERMINAL.has(status);
}

export type KeepReason =
  | 'other_live_app_subscription'
  | 'lifetime_purchase'
  | 'advocate'
  | 'check_failed';

export interface EndAccessDeps {
  /** Every subscription (any status) for every Stripe customer with this email. */
  listSubscriptionsForEmail(email: string): Promise<Stripe.Subscription[]>;
  /** Rows from the purchases table for this email. */
  listPurchases(email: string): Promise<Array<{ product_id: string | null; product_name: string | null }>>;
  isAdvocate(email: string): boolean;
  revokePro(email: string): Promise<{ ok: boolean; failures: string[] }>;
  revokeTeam(email: string): Promise<{ ok: boolean; failure?: string }>;
}

export interface EndAccessResult {
  action: 'revoked' | 'kept' | 'not_applicable';
  revokedPro: boolean;
  revokedTeam: boolean;
  keep?: KeepReason;
  detail?: string;
}

/**
 * Decide and apply. `endedSub` is the subscription that just reached a terminal status.
 */
export async function endAppAccessIfNoOtherSource(
  email: string,
  endedSub: Stripe.Subscription,
  deps: EndAccessDeps,
): Promise<EndAccessResult> {
  const none = { revokedPro: false, revokedTeam: false };
  if (!email || !isMindyAppSubscription(endedSub) || !isTerminalStatus(endedSub.status)) {
    return { action: 'not_applicable', ...none };
  }
  const normalized = email.toLowerCase().trim();
  if (deps.isAdvocate(normalized)) return { action: 'kept', ...none, keep: 'advocate' };

  let subs: Stripe.Subscription[];
  let purchases: Array<{ product_id: string | null; product_name: string | null }>;
  try {
    [subs, purchases] = await Promise.all([deps.listSubscriptionsForEmail(normalized), deps.listPurchases(normalized)]);
  } catch (err) {
    return { action: 'kept', ...none, keep: 'check_failed', detail: err instanceof Error ? err.message : String(err) };
  }

  const others = subs.filter((s) => s.id !== endedSub.id && LIVE.has(s.status) && isMindyAppSubscription(s));
  const lifetime = purchases.some((p) =>
    LIFETIME_PRODUCT_IDS.has((p.product_id || '').toLowerCase()) || LIFETIME_NAME.test(p.product_name || ''));

  const endedWasTeam = isTeamSubscription(endedSub);
  const otherTeam = others.some((s) => isTeamSubscription(s));

  // Team access goes when the Team sub ends and no other Team sub is live (Pro may still stay).
  let revokedTeam = false;
  let teamFailure: string | undefined;
  if (endedWasTeam && !otherTeam) {
    const r = await deps.revokeTeam(normalized);
    revokedTeam = r.ok;
    if (!r.ok) teamFailure = r.failure;
  }

  if (others.length > 0) {
    return { action: 'kept', revokedPro: false, revokedTeam, keep: 'other_live_app_subscription', detail: teamFailure };
  }
  if (lifetime) return { action: 'kept', revokedPro: false, revokedTeam, keep: 'lifetime_purchase', detail: teamFailure };

  const r = await deps.revokePro(normalized);
  return {
    action: r.ok ? 'revoked' : 'kept',
    revokedPro: r.ok,
    revokedTeam,
    ...(r.ok ? {} : { keep: 'check_failed' as const }),
    detail: [teamFailure, ...r.failures].filter(Boolean).join('; ') || undefined,
  };
}
