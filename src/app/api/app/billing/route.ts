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
import { resolveStripeCustomerByEmail } from '@/lib/stripe/resolve-customer';
import { getLinkedEmails } from '@/lib/mindy/linked-emails';

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
    //
    // MUST go through resolveStripeCustomerByEmail — 13% of live emails have MORE THAN ONE
    // Stripe customer record, and `limit: 1` returned the NEWEST, which is often the empty
    // one. That showed a paying subscriber "no subscription" on this very endpoint.
    //
    // …and fan out over LINKED emails, not just the signed-in one. Buying with one address and
    // signing in with another is normal user behaviour (Eric, 2026-07-29), so resolving only
    // the session email shows the WRONG subscription — Alisha Martin saw an old $99 coaching
    // sub while her live $149 Mindy sub sat on another address, with no way to cancel it.
    // getLinkedEmails returns the signed-in address FIRST, so the user's own billing still
    // wins; a linked address is only consulted when their own has nothing live.
    const candidateEmails = await getLinkedEmails(userEmail);
    let customer: Stripe.Customer | null = null;
    let resolvedVia: string = userEmail;
    for (const candidate of candidateEmails) {
      const r = await resolveStripeCustomerByEmail(stripe, candidate);
      if (!r.customer) continue;
      // Prefer a candidate that actually has a LIVE subscription; otherwise remember the first
      // customer found and keep looking, so "has a record but no plan" never masks a real plan
      // sitting on a linked address.
      const live = await stripe.subscriptions.list({ customer: r.customer.id, status: 'active', limit: 1 });
      if (live.data.length) { customer = r.customer; resolvedVia = candidate; break; }
      if (!customer) { customer = r.customer; resolvedVia = candidate; }
    }
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
        resolvedVia,
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
      // Which address this plan actually lives on. Differs from the signed-in email when it
      // was found via a linked address — the UI says so instead of silently implying it is
      // the user's own, which is how Alisha ended up unable to find her cancel button.
      resolvedVia,
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
