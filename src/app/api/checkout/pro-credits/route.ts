/**
 * GET /api/checkout/pro-credits?addon=<entry|mid|growth>&billing=<monthly|annual>
 *
 * ONE Stripe checkout for "Pro + extra monthly credits" (owner, 2026-11-23: the Pro card shows
 * $548, so the checkout must show Pro + the add-on together, not Pro alone).
 *
 * Creates a subscription Checkout Session with two items, both on the same 14-day trial as the
 * Pro trial links: the Pro price and the add-on's existing Entry/Mid/Growth price. Stripe shows
 * "14 days free, then $548.00 per month". Card required (as the trial links), promotion codes
 * allowed (as the trial links).
 *
 * What the rest of billing does with that subscription is covered in subscription-items.ts:
 *   - Pro access: checkout.session.completed with metadata.tier (the same tiers the webhook maps).
 *   - Pro's monthly credits: the Pro line, found by amount (app-tier-subscription.ts).
 *   - The add-on's credits: the add-on line, by price id, only once it is PAID — a $0 trial line
 *     grants nothing (stripe-subscription.ts), so they start when the trial converts.
 *
 * Fails SAFE: an unknown add-on, a Stripe error or an unresolved Pro price sends the visitor to
 * the plain Pro trial link they would have used before, never to an error page.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { addonById } from '@/lib/billing/pro-credit-addons';
import { MINDY_APP_PRODUCT } from '@/lib/billing/app-subscription-end';
import { PRO_TRIAL_ANNUAL, PRO_TRIAL_MONTHLY } from '@/components/public-site/pricing/app-plan-links';

export const dynamic = 'force-dynamic';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai';
const TRIAL_DAYS = 14;
/** Pro list prices in cents: the Pro price is the Mindy app product's recurring price at this amount. */
const PRO_CENTS = { month: 14900, year: 149000 } as const;

type Interval = keyof typeof PRO_CENTS;
const priceCache = new Map<Interval, string>();

/** The live Pro price id: env override first, else the Mindy app product's active price at the Pro amount. */
async function proPriceId(interval: Interval): Promise<string | null> {
  const env = interval === 'month' ? process.env.STRIPE_PRO_PRICE_MONTHLY : process.env.STRIPE_PRO_PRICE_ANNUAL;
  if (env) return env;
  const hit = priceCache.get(interval);
  if (hit) return hit;
  const prices = await getStripe().prices.list({ product: MINDY_APP_PRODUCT, active: true, type: 'recurring', limit: 100 });
  const match = prices.data.filter((p) => p.unit_amount === PRO_CENTS[interval] && p.recurring?.interval === interval);
  // Exactly one candidate, or we do not guess.
  if (match.length !== 1) {
    console.error(`[checkout:pro-credits] ${match.length} Pro ${interval} prices found; falling back to the plain trial link`);
    return null;
  }
  priceCache.set(interval, match[0].id);
  return match[0].id;
}

export async function GET(req: NextRequest) {
  const annual = req.nextUrl.searchParams.get('billing') === 'annual';
  const interval: Interval = annual ? 'year' : 'month';
  const fallback = annual ? PRO_TRIAL_ANNUAL : PRO_TRIAL_MONTHLY;
  const addon = addonById(req.nextUrl.searchParams.get('addon'));
  if (!addon) return NextResponse.redirect(fallback, 303);

  try {
    const [pro, extra] = [await proPriceId(interval), annual ? addon.annualPriceId : addon.monthlyPriceId];
    if (!pro || !extra) return NextResponse.redirect(fallback, 303);

    const tier = annual ? 'briefings_annual' : 'briefings_monthly';
    const metadata = { tier, pro_addon: addon.id, source: 'pricing_pro_card' };
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      // Pro FIRST: anything that still reads the first line item sees the Pro plan.
      line_items: [{ price: pro, quantity: 1 }, { price: extra, quantity: 1 }],
      subscription_data: { trial_period_days: TRIAL_DAYS, metadata },
      payment_method_collection: 'always',
      allow_promotion_codes: true,
      metadata,
      success_url: `${SITE}/app?trial=started`,
      cancel_url: `${SITE}/pricing`,
    });
    if (!session.url) return NextResponse.redirect(fallback, 303);
    return NextResponse.redirect(session.url, 303);
  } catch (e) {
    console.error('[checkout:pro-credits] session create failed; falling back to the plain trial link:', e);
    return NextResponse.redirect(fallback, 303);
  }
}
