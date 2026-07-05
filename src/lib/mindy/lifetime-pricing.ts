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
import { MINDY_DAY } from '@/lib/mindy/mindy-day';

export const PRO_MONTHLY = 149;
export const PRO_ANNUAL = 1490;

/** Public lifetime anchor — Founders Lifetime (100 seats). */
export const FOUNDERS_LIFETIME_PRICE = 4997;
export const FOUNDERS_LIFETIME_CENTS = 499700;
export const FOUNDERS_LIFETIME_CAP = 100;

/**
 * @deprecated The $2,997 bootcamp-alumni rate was DISCONTINUED 2026-07-05 —
 * the single lifetime price is now $4,997 Founders. These constants are kept
 * pointing at the Founders price so any lingering consumer renders $4,997.
 * (Stripe webhooks still recognize the raw amount 299700 to keep honoring
 * people who already PAID $2,997 — that's intentional, do not remove.)
 */
export const BOOTCAMP_LIFETIME_PRICE = FOUNDERS_LIFETIME_PRICE; // was 2997 — discontinued
export const BOOTCAMP_LIFETIME_CENTS = FOUNDERS_LIFETIME_CENTS; // was 299700 — discontinued
/** Founders-rate deadline = Mindy Day (offer ends the night of the event). */
export const BOOTCAMP_LIFETIME_DEADLINE_ISO = MINDY_DAY.iso;

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
