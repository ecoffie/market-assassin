/**
 * GET /api/checkout/team-seats?seats=<2..5>&billing=<monthly|annual>
 *
 * Team by seats (owner, 2026-11-24): one Stripe checkout for the chosen team size, on the same
 * 14-day trial as the Team trial links. Card required, promotion codes allowed.
 *
 * ⛔ HELD until Eric approves the seat proposal: the Stripe prices do not exist yet. Until the
 * STRIPE_TEAM_<N>_SEATS_{MONTHLY,ANNUAL}_PRICE env vars are set (prices created on the Mindy app
 * product, so cancellations and access work as for Team today), every request falls back to the
 * existing Team trial link. Any Stripe error falls back the same way: never an error page.
 *
 * metadata.tier = team_monthly | team_annual, so the webhook grants Team access exactly as today;
 * team_seats records the size. Credits (seats x 1,500, shared) and the seat limit come from the
 * price id in app-tier-subscription.ts / grant-mcp-pro-credits.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { teamSeatPlan, teamSeatAnnualOffer } from '@/lib/billing/team-seat-plans';
import { TEAM_TRIAL_ANNUAL, TEAM_TRIAL_MONTHLY } from '@/components/public-site/pricing/app-plan-links';

export const dynamic = 'force-dynamic';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai';
const TRIAL_DAYS = 14;

export async function GET(req: NextRequest) {
  const annual = req.nextUrl.searchParams.get('billing') === 'annual';
  const fallback = annual ? TEAM_TRIAL_ANNUAL : TEAM_TRIAL_MONTHLY;
  const plan = teamSeatPlan(req.nextUrl.searchParams.get('seats'));
  // Yearly: the Mindy Day price during its week, the normal 33%-off price otherwise.
  const price = plan ? (annual ? teamSeatAnnualOffer(plan.seats).priceId : plan.monthlyPriceId) : null;
  if (!plan || !price) return NextResponse.redirect(fallback, 303);

  try {
    const metadata = { tier: annual ? 'team_annual' : 'team_monthly', team_seats: String(plan.seats), source: 'pricing_team_seats' };
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      subscription_data: { trial_period_days: TRIAL_DAYS, metadata },
      payment_method_collection: 'always',
      allow_promotion_codes: true,
      metadata,
      success_url: `${SITE}/app?trial=started`,
      cancel_url: `${SITE}/pricing`,
    });
    return NextResponse.redirect(session.url || fallback, 303);
  } catch (e) {
    console.error('[checkout:team-seats] session create failed; falling back to the Team trial link:', e);
    return NextResponse.redirect(fallback, 303);
  }
}
