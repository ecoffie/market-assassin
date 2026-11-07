/**
 * One subscription price → its monthly recurring value.
 *
 * A Stripe price bills every `interval_count` `interval`s. Reading the interval alone made
 * $799 per 6 months count as $799/mo, overstating MRR by $1,997.50 (mirror $12,726.75 vs
 * Stripe $10,729.25, 94 active subscriptions, 2026-11-07).
 *
 * `basis` keeps an estimate from passing as a measurement:
 *   exact          interval and count both known.
 *   count_unknown  row not yet re-synced (plan_interval_count is NULL). Uses the previous
 *                  interval/large-amount inference, so the figure is no worse than before and
 *                  the caller can disclose it. Self-clears after one daily sync.
 *   unmeasurable   the interval is not one we can convert. monthlyCents is null, never a guess.
 */
export type RecurringBasis = 'exact' | 'count_unknown' | 'unmeasurable';

export interface RecurringPrice {
  plan_amount: number | null | undefined;
  plan_interval?: string | null;
  plan_interval_count?: number | null;
}

const MONTHS_PER: Record<string, number> = {
  month: 1,
  year: 12,
  week: 12 / 52,
  day: 12 / 365,
};

/** Previous behaviour: large amounts were assumed annual. Only for rows with no count yet. */
const LEGACY_ANNUAL_CENTS = 100_000;

export function monthlyRecurring(price: RecurringPrice): { monthlyCents: number | null; basis: RecurringBasis } {
  const cents = price.plan_amount ?? 0;
  const count = price.plan_interval_count;

  if (count === null || count === undefined) {
    const annual = price.plan_interval === 'year' || cents >= LEGACY_ANNUAL_CENTS;
    return { monthlyCents: annual ? cents / 12 : cents, basis: 'count_unknown' };
  }

  const months = price.plan_interval ? MONTHS_PER[price.plan_interval] : undefined;
  if (!months || !Number.isInteger(count) || count < 1) return { monthlyCents: null, basis: 'unmeasurable' };
  return { monthlyCents: cents / (months * count), basis: 'exact' };
}
