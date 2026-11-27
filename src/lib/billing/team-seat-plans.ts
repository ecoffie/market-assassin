/**
 * Team by seats (owner, 2026-11-24, from the "Mindy Team Tier Seat Selector" mockup): Team starts at
 * $249 for 2 users and goes up from there.
 *
 *   seats   monthly   credits / month (shared)
 *     2      $249         3,000
 *     3      $366         4,500
 *     4      $482         6,000
 *     5      $599         7,500
 *
 * Price per added seat: +$116.67, rounded (owner choice 1a). Credits: 1,500 per user, the same
 * as one Pro seat (owner choice 2a). Annual: 2 months free (monthly × 10), the same rule as the
 * credit plans; ⚠️ an ASSUMPTION for Eric to confirm (today's Team annual is 33% off).
 *
 * ⛔ HELD: the in-flight rule "no public pricing/copy change and no POOLED_PLAN_DEFAULTS change
 * until Eric approves the seat-and-credit proposal" applies. Everything that reads this file is
 * off unless NEXT_PUBLIC_TEAM_SEAT_PRICING === 'on', and checkout needs the Stripe price ids
 * below, which do not exist yet (Eric creates them in Stripe and sets the env vars).
 */
export const TEAM_SEAT_CREDITS_PER_USER = 1500;
export const TEAM_SEAT_COUNTS = [2, 3, 4, 5] as const;
export type TeamSeatCount = (typeof TEAM_SEAT_COUNTS)[number];

const MONTHLY_USD: Record<TeamSeatCount, number> = { 2: 249, 3: 366, 4: 482, 5: 599 };

export interface TeamSeatPlan {
  seats: TeamSeatCount;
  monthlyUsd: number;
  annualUsd: number;
  annualPerMonthUsd: number;
  credits: number;
  /** Stripe price ids: monthly from TEAM_SEAT_MONTHLY_PRICE_IDS (env can override); annual env-only. */
  monthlyPriceId: string | null;
  annualPriceId: string | null;
}

const envPrice = (name: string): string | null => {
  const v = (process.env[name] || '').trim();
  return v.startsWith('price_') ? v : null;
};

/**
 * Live monthly Stripe prices, created 2026-11-27 on the Mindy app product (MINDY_APP_PRODUCT,
 * prod_UI5RXVGKsdywuf) so cancellation and trial-onboarding logic treat them like every other
 * Mindy plan. Price ids are not secrets. An env var STRIPE_TEAM_<N>_SEATS_MONTHLY_PRICE still wins.
 * Annual prices are not created yet (annual pricing is unapproved), so annual stays env-only.
 */
export const TEAM_SEAT_MONTHLY_PRICE_IDS: Record<TeamSeatCount, string> = {
  2: 'price_1UgRmNK5zyiZ50PBB0eGUTYw',
  3: 'price_1UgRmiK5zyiZ50PBUawhanUw',
  4: 'price_1UgRn2K5zyiZ50PBEOLJgMT4',
  5: 'price_1UgRnIK5zyiZ50PB2dZhuXH7',
};

export const TEAM_SEAT_PLANS: TeamSeatPlan[] = TEAM_SEAT_COUNTS.map((seats) => {
  const monthlyUsd = MONTHLY_USD[seats];
  const annualUsd = monthlyUsd * 10;
  return {
    seats,
    monthlyUsd,
    annualUsd,
    annualPerMonthUsd: Math.round(annualUsd / 12),
    credits: seats * TEAM_SEAT_CREDITS_PER_USER,
    monthlyPriceId: envPrice(`STRIPE_TEAM_${seats}_SEATS_MONTHLY_PRICE`) ?? TEAM_SEAT_MONTHLY_PRICE_IDS[seats],
    annualPriceId: envPrice(`STRIPE_TEAM_${seats}_SEATS_ANNUAL_PRICE`),
  };
});

/** Public flag: the seat picker shows on /pricing only when this is 'on'. */
export const TEAM_SEAT_PRICING_ON = process.env.NEXT_PUBLIC_TEAM_SEAT_PRICING === 'on';

export function teamSeatPlan(seats: number | string | null | undefined): TeamSeatPlan | null {
  const n = Number(seats);
  return TEAM_SEAT_PLANS.find((p) => p.seats === n) ?? null;
}

/** The seat plan a Stripe price id belongs to, with its billing interval. null = not a seat price. */
export function teamSeatPlanForPriceId(priceId: string | null | undefined): { plan: TeamSeatPlan; interval: 'month' | 'year' } | null {
  if (!priceId) return null;
  for (const plan of TEAM_SEAT_PLANS) {
    if (plan.monthlyPriceId === priceId) return { plan, interval: 'month' };
    if (plan.annualPriceId === priceId) return { plan, interval: 'year' };
  }
  return null;
}
