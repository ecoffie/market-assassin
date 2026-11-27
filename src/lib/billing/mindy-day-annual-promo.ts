/**
 * Mindy Day annual promo (owner decision, 2026-11-27).
 *
 *   Anyone who buys an ANNUAL Mindy plan (Pro annual or Team annual) during Mindy Day week gets
 *   DOUBLE monthly credits for their whole first year. New annual buyers AND existing monthly
 *   customers who switch to annual both count.
 *   Window: Nov 28 – Dec 5 2026, inclusive, America/New_York.
 *
 * THE RULE (one place; every grant path calls it):
 *   A subscription is in the promo when
 *     1. its current item price bills yearly, and
 *     2. it is not in a trial (a trial is not a purchase), and
 *     3. the customer bought it inside the window, meaning EITHER
 *          · the current annual billing period started in the window (first annual payment,
 *            a portal switch, or "Upgrade now" ending a trial early), OR
 *          · that period directly follows a trial (it begins at trial_end) and the trial
 *            started in the window (the day the customer chose annual).
 *
 * Why the billing period and not our checkout: annual Pro/Team is sold through Stripe Payment
 * Links with a 14-day trial, and monthly customers switch in the Stripe billing portal, which
 * never touches our code. Changing the interval resets the billing period in Stripe, so the
 * first annual period starts on the switch day. That period is exactly the first year, and the
 * renewal a year later starts outside the window, so the promo ends on its own.
 *
 * Why the trial clause: the annual trial button is the main way people buy annual. A trial
 * started on Nov 30 is paid on Dec 14, so its first paid period starts outside the window; it
 * still counts, because the customer chose annual during Mindy Day week. Credits during the
 * trial itself are NOT doubled.
 *
 * The promo can only MULTIPLY an allowance a path already decided to grant. It never adds an
 * audience, never changes the idempotency key, and never re-opens a month already granted.
 */

export const MINDY_DAY_TIMEZONE = 'America/New_York';
/** First and last day of the window, inclusive, as New York calendar dates. */
export const MINDY_DAY_FIRST_DAY = '2026-11-28';
export const MINDY_DAY_LAST_DAY = '2026-12-05';
/** 2026-11-28 00:00 in New York (EST, UTC-5; DST ended Nov 1). Inclusive. */
export const MINDY_DAY_WINDOW_START_MS = Date.UTC(2026, 10, 28, 5, 0, 0);
/** 2026-12-06 00:00 in New York (EST, UTC-5). EXCLUSIVE — Dec 5 is the last full day. */
export const MINDY_DAY_WINDOW_END_MS = Date.UTC(2026, 11, 6, 5, 0, 0);
export const MINDY_DAY_MULTIPLIER = 2;

/** How close a period start must be to trial_end to count as "the period right after the trial". */
const TRIAL_HANDOFF_TOLERANCE_S = 24 * 60 * 60;

/** True when the instant lies inside the Mindy Day window (New York time). */
export function isInMindyDayWindow(at: Date | number): boolean {
  const ms = typeof at === 'number' ? at : at.getTime();
  return Number.isFinite(ms) && ms >= MINDY_DAY_WINDOW_START_MS && ms < MINDY_DAY_WINDOW_END_MS;
}

/** True once the window has opened. Before that no subscription can be in the promo. */
export function mindyDayPromoHasStarted(now: Date | number = Date.now()): boolean {
  const ms = typeof now === 'number' ? now : now.getTime();
  return ms >= MINDY_DAY_WINDOW_START_MS;
}

/**
 * The subset of a Stripe subscription this rule reads. Both API shapes are accepted: period
 * dates on the subscription (2025-01-27.acacia, what getStripe() pins) and on the item (newer
 * versions, what the cron's default client returns).
 */
export interface PromoSubscription {
  status?: string | null;
  trial_start?: number | null;
  trial_end?: number | null;
  current_period_start?: number | null;
  items?: {
    data?: Array<{
      current_period_start?: number | null;
      price?: { recurring?: { interval?: string | null } | null } | null;
      plan?: { interval?: string | null } | null;
    }>;
  } | null;
}

function firstItem(sub: PromoSubscription) {
  return sub.items?.data?.[0];
}

/** The billing interval of the subscription's current item price, or null when unknown. */
export function subscriptionInterval(sub: PromoSubscription): string | null {
  const item = firstItem(sub);
  return item?.price?.recurring?.interval ?? item?.plan?.interval ?? null;
}

/** Unix seconds when the current billing period started, or null when unknown. */
export function currentPeriodStart(sub: PromoSubscription): number | null {
  const v = sub.current_period_start ?? firstItem(sub)?.current_period_start ?? null;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * The moments (unix seconds) that count as "bought this annual year": the current period start,
 * plus the trial start when the current period directly follows a trial. [] = unknown.
 */
export function annualPurchaseMoments(sub: PromoSubscription): number[] {
  const start = currentPeriodStart(sub);
  if (start == null) return [];
  const out = [start];
  const { trial_start: ts, trial_end: te } = sub;
  if (typeof ts === 'number' && typeof te === 'number' && Math.abs(start - te) <= TRIAL_HANDOFF_TOLERANCE_S) {
    out.push(ts);
  }
  return out;
}

/** True when this subscription's current annual year was bought during Mindy Day week. */
export function isMindyDayAnnualPromo(sub: PromoSubscription | null | undefined): boolean {
  if (!sub) return false;
  if (sub.status === 'trialing') return false;
  if (subscriptionInterval(sub) !== 'year') return false;
  return annualPurchaseMoments(sub).some((t) => isInMindyDayWindow(t * 1000));
}

/** 2 for a promo subscription, 1 for everything else (including unknown). */
export function promoMultiplier(sub: PromoSubscription | null | undefined): number {
  return isMindyDayAnnualPromo(sub) ? MINDY_DAY_MULTIPLIER : 1;
}

/** The allowance after the promo. Only ever multiplies what was already going to be granted. */
export function applyMindyDayPromo(baseCredits: number, sub: PromoSubscription | null | undefined): number {
  if (!(baseCredits > 0)) return baseCredits;
  return Math.floor(baseCredits) * promoMultiplier(sub);
}

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * The pricing-page line, or null when the window is closed. Numbers come from the allowance
 * constants passed in, so a change to PRO/TEAM_MONTHLY_CREDITS updates the copy too.
 */
export function mindyDayPromoLine(
  now: Date | number,
  credits: { proCredits: number; teamCredits: number },
): string | null {
  if (!isInMindyDayWindow(now)) return null;
  const pro = fmt(credits.proCredits * MINDY_DAY_MULTIPLIER);
  const team = fmt(credits.teamCredits * MINDY_DAY_MULTIPLIER);
  return `Mindy Day: start an annual plan by Dec 5 and get double credits every month of your first paid year (${pro} a month on Pro, ${team} on Team).`;
}
