/**
 * Team seat card on /pricing — DISPLAY ONLY. PROPOSED. Needs Eric's approval AND Stripe prices.
 *
 * Content is the owner's (Branden) "Team card" mockup, 2026-11-25: a "2 users | 5 users" toggle on
 * the Team card, $249 for 2 users and $599 for 5, monthly. 3 and 4 users added on the owner's
 * request (2026-11-25) at the prices #2430 already holds in src/lib/billing/team-seat-plans.ts
 * ($366 / $482).
 *
 * ⛔ Nothing in billing reads this file. It never sets a price, a credit allowance or a seat limit:
 *    - the prices here are LABELS on the page; Stripe, the webhook and POOLED_PLAN_DEFAULTS are
 *      untouched (src/lib/billing/team-seat-plans.ts holds the held billing proposal from #2430,
 *      and a test keeps these labels equal to it so the two cannot drift);
 *    - credits are shown as seats x TEAM_SEAT_CREDITS_PER_USER (1,500), the same number the grant uses;
 *    - `checkoutUrl` is EMPTY. There are no Stripe prices for 2 seats / $249 or 5 seats / $599 yet,
 *      so an empty URL sends the button to contact sales, never to today's $499 Team checkout.
 *      Eric creates the two prices, then fills `checkoutUrl` (e.g. the existing
 *      `/api/checkout/team-seats?seats=2&billing=monthly`).
 *
 * The whole variant is off unless NEXT_PUBLIC_TEAM_SEAT_PRICING === 'on' (unset in every
 * environment today). Off, /pricing renders exactly as before (see SimplePricing.team-seat tests).
 */
import { SALES_URL } from '@/components/public-site/pricing/app-plan-links';

/** The page switch. Read at render, so a test can flip it with vi.stubEnv. */
export function isTeamSeatPricingEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TEAM_SEAT_PRICING === 'on';
}

export type TeamSeatOptionId = '2' | '3' | '4' | '5';

export interface TeamSeatOption {
  id: TeamSeatOptionId;
  seats: number;
  /** Toggle label. */
  label: string;
  /** Display price, monthly. PROPOSED. */
  monthlyUsd: number;
  per: string;
  cta: string;
  /** First feature on the card; changes with the team size. */
  firstFeature: [title: string, detail: string];
  /** EMPTY until Eric creates the Stripe price. Empty = button goes to contact sales. */
  checkoutUrl: string;
}

export const TEAM_SEAT_PRICING = {
  status: 'PROPOSED — display only, needs Eric + Stripe prices',
  header: {
    title: 'Pricing',
    sub: 'Pay monthly, or pay yearly and save up to 33%.',
    /** Mindy Day week (see MINDY_DAY_WINDOW in src/lib/billing/team-seat-plans.ts). */
    subMindyDay: 'Pay monthly, or pay yearly and get 2 months free.',
  },
  /** ⚠️ A claim: Eric must confirm Team really is the most popular plan, or remove it. */
  badge: 'Most popular',
  defaultOption: '2' as TeamSeatOptionId,
  options: [
    {
      id: '2', seats: 2, label: '2 users', monthlyUsd: 249,
      per: '/ mo, billed monthly. Add seats any time.',
      cta: 'Start with 2 seats',
      
      firstFeature: ['2 users included', 'Add up to 5 as the team grows, at any time.'],
      checkoutUrl: '/api/checkout/team-seats?seats=2&billing=monthly',
    },
    {
      id: '3', seats: 3, label: '3 users', monthlyUsd: 366,
      per: '/ mo, billed monthly. Add seats any time.',
      cta: 'Start with 3 seats',
      
      firstFeature: ['3 users included', 'Add up to 5 as the team grows, at any time.'],
      checkoutUrl: '/api/checkout/team-seats?seats=3&billing=monthly',
    },
    {
      id: '4', seats: 4, label: '4 users', monthlyUsd: 482,
      per: '/ mo, billed monthly. Add seats any time.',
      cta: 'Start with 4 seats',
      
      firstFeature: ['4 users included', 'Add up to 5 as the team grows, at any time.'],
      checkoutUrl: '/api/checkout/team-seats?seats=4&billing=monthly',
    },
    {
      id: '5', seats: 5, label: '5 users', monthlyUsd: 599,
      per: '/ mo, billed monthly. Add seats any time.',
      cta: 'Start with 5 seats',
      
      // Mockup: "Room for the whole BD team on one plan." — "BD" spelled out per the /pricing
      // plain-words rule (SimplePricing.plain-words.unit.test.tsx forbids "whole BD team").
      firstFeature: ['5 users included', 'Room for the whole business development team on one plan.'],
      checkoutUrl: '/api/checkout/team-seats?seats=5&billing=monthly',
    },
  ] as TeamSeatOption[],
  lead: 'Win more as a team.',
  base: 'All Pro features, plus',
  /** Features after the first (same for both sizes). */
  features: [
    ['Everyone gets their own alerts', 'Saved searches and a daily briefing per person, not one shared inbox.'],
    ['Shared pipeline', 'Everyone sees the same pursuits and deadlines.'],
    ['Team dashboard and roles', 'See who is working what.'],
  ] as Array<[title: string, detail: string]>,
  contactEmail: 'hello@getmindy.ai',
  footer: 'Questions about a rollout:',
} as const;

export function teamSeatOption(id: string | null | undefined): TeamSeatOption {
  return TEAM_SEAT_PRICING.options.find((o) => o.id === id)
    ?? TEAM_SEAT_PRICING.options.find((o) => o.id === TEAM_SEAT_PRICING.defaultOption)!;
}

/** Where a "Start with N seats" button goes: its checkout when one is configured, else sales. */
export function teamSeatCtaHref(option: TeamSeatOption): string {
  const url = option.checkoutUrl.trim();
  return url ? url : SALES_URL;
}

/** True when the button would take money (a real checkout), so the no-refund note belongs under it. */
export function teamSeatTakesPayment(option: TeamSeatOption): boolean {
  return option.checkoutUrl.trim() !== '';
}
