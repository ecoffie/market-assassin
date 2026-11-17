/**
 * /start-trial?plan=pro|team&cycle=monthly|annual — Mindy's own 14-day-trial checkout (2026-11-17).
 *
 * A branded page with Stripe's Payment Element (card fields hosted by Stripe, in an iframe), on
 * a Checkout Session that copies the plan's existing payment link (lib/billing/trial-checkout).
 * Without a publishable key it sends the buyer to that payment link, so the page can never be a
 * dead end.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import TrialCheckout from '@/components/billing/TrialCheckout';
import { fallbackLink, parseCycle, parsePlan } from '@/lib/billing/trial-checkout';
import { PRO_MONTHLY_CREDITS, TEAM_MONTHLY_CREDITS } from '@/lib/mcp/packages';
import {
  PRO_ANNUAL_USD, PRO_MONTHLY_USD, TEAM_ANNUAL_USD, TEAM_MONTHLY_USD,
} from '@/components/public-site/pricing/app-plan-links';

export const metadata: Metadata = {
  title: 'Start your free trial | Mindy',
  description: 'Start your 14-day free trial of Mindy.',
  robots: { index: false, follow: false },
};

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function StartTrialPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined;
  const plan = parsePlan(one('plan'));
  const cycle = parseCycle(one('cycle'));
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';
  if (!/^pk_(live|test)_/.test(key)) redirect(fallbackLink(plan, cycle));

  return (
    <TrialCheckout
      publishableKey={key}
      initialPlan={plan}
      initialCycle={cycle}
      source={(one('src') || '').slice(0, 60) || null}
      prefillEmail={(one('email') || '').slice(0, 200) || null}
      prices={{
        pro: { monthly: PRO_MONTHLY_USD, annual: PRO_ANNUAL_USD, credits: PRO_MONTHLY_CREDITS },
        team: { monthly: TEAM_MONTHLY_USD, annual: TEAM_ANNUAL_USD, credits: TEAM_MONTHLY_CREDITS },
      }}
      fallbacks={{
        'pro:monthly': fallbackLink('pro', 'monthly'), 'pro:annual': fallbackLink('pro', 'annual'),
        'team:monthly': fallbackLink('team', 'monthly'), 'team:annual': fallbackLink('team', 'annual'),
      }}
    />
  );
}
