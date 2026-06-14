/**
 * Mindy lifetime pricing — single source of truth (1-1-1 model).
 *
 * PERCEPTION RULE: Public surfaces anchor on Founders Lifetime ($4,997) — the
 * same price lifetime course buyers already paid. Never lead with bootcamp rate;
 * that trains the market to treat Mindy as a ~$3K product.
 *
 *   - Founders Lifetime ($4,997) — public anchor, capped at 100 seats
 *   - Bootcamp alumni ($2,997) — private post-bootcamp email only, not homepage
 */

export const PRO_MONTHLY = 149;
export const PRO_ANNUAL = 1490;

/** Public lifetime anchor — Founders Lifetime (100 seats). */
export const FOUNDERS_LIFETIME_PRICE = 4997;
export const FOUNDERS_LIFETIME_CENTS = 499700;
export const FOUNDERS_LIFETIME_CAP = 100;

/** Bootcamp alumni rate — email-only; do not hero on /lifetime or funnels. */
export const BOOTCAMP_LIFETIME_PRICE = 2997;
export const BOOTCAMP_LIFETIME_CENTS = 299700;
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

export function bootcampBreakEvenMonths(): number {
  return Math.ceil(BOOTCAMP_LIFETIME_PRICE / PRO_MONTHLY);
}

export function bootcampLifetimeSavings(): number {
  return FOUNDERS_LIFETIME_PRICE - BOOTCAMP_LIFETIME_PRICE;
}
