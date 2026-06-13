/**
 * Mindy lifetime pricing — single source of truth (1-1-1 model).
 *
 * One product (Mindy Pro), two lifetime checkout paths:
 *   - Bootcamp special ($1,497) — time-boxed event offer
 *   - Founders Lifetime ($4,997) — capped founding cohort (100 seats)
 *
 * No $2,997 tier. Historical course lifetime was $4,997; founders matches
 * proven WTP. After the cap closes, sell Pro monthly/annual only unless we
 * reopen lifetime at a higher price.
 */

export const PRO_MONTHLY = 149;
export const PRO_ANNUAL = 1490;

/** Founders Lifetime — standard post-bootcamp lifetime (capped). */
export const FOUNDERS_LIFETIME_PRICE = 4997;
export const FOUNDERS_LIFETIME_CENTS = 499700;
export const FOUNDERS_LIFETIME_CAP = 100;

/** Bootcamp-only lifetime special (Jun 27, 2026 bootcamp cohort). */
export const BOOTCAMP_LIFETIME_PRICE = 1497;
export const BOOTCAMP_LIFETIME_CENTS = 149700;
export const BOOTCAMP_LIFETIME_DEADLINE_ISO = '2026-06-27';

export function bootcampDeadlineLabel(): string {
  const d = new Date(`${BOOTCAMP_LIFETIME_DEADLINE_ISO}T23:59:59-05:00`);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });
}

export function foundersBreakEvenMonths(): number {
  return Math.ceil(FOUNDERS_LIFETIME_PRICE / PRO_MONTHLY);
}
