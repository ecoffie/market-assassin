/**
 * /api/app/billing  (GET)
 *
 * Returns the signed-in user's current billing state, read live from Stripe:
 *   - whether they have a Stripe customer + active subscription
 *   - plan name, amount, interval, status, current-period-end (renewal date)
 *   - cancel_at_period_end so the UI can show "cancels on …"
 *
 * Powers the Settings → Billing tab. The actual change-plan / cancel / update-
 * card / invoice-download actions are handled by Stripe's hosted Billing Portal
 * (see ./portal/route.ts) — this endpoint is read-only display data.
 *
 * Auth: standard /app verifyUserOwnsEmail gate.
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { verifyUserOwnsEmail } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion });
}

export async function GET(request: NextRequest) {
  const email = String(request.nextUrl.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
  }

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const userEmail = auth.email!;

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ success: true, hasCustomer: false, hasSubscription: false });
  }

  try {
    // Resolve the Stripe customer by email. (We don't always have a stored
    // stripe_customer_id, and email is the durable join used elsewhere.)
    const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
    const customer = customers.data[0] || null;
    if (!customer) {
      return NextResponse.json({ success: true, hasCustomer: false, hasSubscription: false });
    }

    // Most recent subscription (active or otherwise) for this customer.
    // NOTE: Stripe caps expand at 4 levels deep, so we can't expand
    // data.items.data.price.product here (5 levels). Expand the price only,
    // then fetch the product name separately below if needed.
    const subs = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'all',
      limit: 10,
      expand: ['data.items.data.price'],
    });

    // Prefer an active/trialing/past_due sub; else the newest.
    const live = subs.data.find(s => ['active', 'trialing', 'past_due'].includes(s.status));
    const sub = live || subs.data[0] || null;

    if (!sub) {
      return NextResponse.json({
        success: true,
        hasCustomer: true,
        hasSubscription: false,
        customerId: customer.id,
      });
    }

    const item = sub.items.data[0];
    const price = item?.price;
    const amount = typeof price?.unit_amount === 'number' ? price.unit_amount / 100 : null;

    // price.product is a string id here (not expanded — see the 4-level cap
    // above). Resolve the product name with one extra retrieve; fall back to
    // the price nickname so we always have a label.
    let productName: string | null = null;
    if (typeof price?.product === 'string') {
      try {
        const product = await stripe.products.retrieve(price.product);
        if (!product.deleted) productName = product.name;
      } catch { /* fall back to nickname below */ }
    } else if (price?.product && typeof price.product === 'object' && !price.product.deleted) {
      productName = price.product.name;
    }

    // current_period_end moved from the subscription to the subscription item
    // in recent Stripe API versions. Read it off the item, fall back to the
    // subscription field for older shapes.
    const periodEndUnix =
      (item as unknown as { current_period_end?: number })?.current_period_end ??
      (sub as unknown as { current_period_end?: number })?.current_period_end ??
      null;

    return NextResponse.json({
      success: true,
      hasCustomer: true,
      hasSubscription: true,
      customerId: customer.id,
      subscription: {
        id: sub.id,
        status: sub.status,
        planName: productName || price?.nickname || 'Subscription',
        amount,
        currency: (price?.currency || 'usd').toUpperCase(),
        interval: price?.recurring?.interval || null, // 'month' | 'year'
        currentPeriodEnd: periodEndUnix
          ? new Date(periodEndUnix * 1000).toISOString()
          : null,
        cancelAtPeriodEnd: !!sub.cancel_at_period_end,
      },
    });
  } catch (err) {
    console.error('[app/billing] lookup failed:', err);
    return NextResponse.json(
      { success: false, error: 'Could not load billing details' },
      { status: 500 }
    );
  }
}
