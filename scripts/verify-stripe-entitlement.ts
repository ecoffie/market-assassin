/**
 * Read-only Stripe entitlement check. A missing stripe_customer_id on
 * user_profiles does not settle whether the person paid.
 *
 *   npx tsx --env-file=.env.local scripts/verify-stripe-entitlement.ts \
 *     --email=john.k.miley@gmail.com
 *
 * Never writes classifications, KV, or credits.
 */
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { briefingGrantForPurchase } from '@/lib/briefings/product-entitlement';

const email = (process.argv.find((a) => a.startsWith('--email='))?.slice('--email='.length) || '')
  .toLowerCase()
  .trim();
if (!email) {
  console.error('usage: --email=<addr>');
  process.exit(2);
}

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error('missing STRIPE_SECRET_KEY');
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('missing supabase env');
  process.exit(2);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
const stripe = new Stripe(stripeKey);

async function main() {
  const [{ data: profile, error: pErr }, { data: purchases, error: purchErr }, { data: classification, error: cErr }] =
    await Promise.all([
      sb.from('user_profiles').select('email, access_briefings, tier, stripe_customer_id').eq('email', email).limit(1).maybeSingle(),
      sb.from('purchases').select('user_email, product_name, amount_paid, stripe_customer_id, stripe_session_id, created_at').eq('user_email', email).range(0, 49),
      sb.from('customer_classifications').select('email, briefings_access, has_active_subscription, customer_id').eq('email', email).limit(1).maybeSingle(),
    ]);
  if (pErr) throw pErr;
  if (purchErr) throw purchErr;
  if (cErr) throw cErr;

  const customersByEmail = await stripe.customers.list({ email, limit: 20 });
  const extraIds = [...new Set(
    [
      profile?.stripe_customer_id,
      classification?.customer_id,
      ...(purchases || []).map((p) => p.stripe_customer_id),
    ].filter((id): id is string => Boolean(id)),
  )];
  const customers = [...customersByEmail.data];
  for (const id of extraIds) {
    if (customers.some((c) => c.id === id)) continue;
    try {
      const fetched = await stripe.customers.retrieve(id);
      if (!fetched.deleted) customers.push(fetched);
    } catch (err) {
      console.error('customer retrieve failed', id, err instanceof Error ? err.message : err);
    }
  }

  const checkoutSessions = [];
  for (const purchase of purchases || []) {
    const sessionId = String(purchase.stripe_session_id || '').trim();
    if (!sessionId.startsWith('cs_')) continue;
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      checkoutSessions.push({
        id: session.id,
        paymentStatus: session.payment_status,
        status: session.status,
        mode: session.mode,
        customerEmail: session.customer_email || session.customer_details?.email || null,
        customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id || null,
        subscriptionId: typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id || null,
        amountTotal: session.amount_total,
        created: new Date(session.created * 1000).toISOString(),
      });
      const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
      if (customerId && !customers.some((c) => c.id === customerId)) {
        try {
          const fetched = await stripe.customers.retrieve(customerId);
          if (!fetched.deleted) customers.push(fetched);
        } catch {
          // session had no retrievable customer
        }
      }
    } catch (err) {
      checkoutSessions.push({
        id: sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const subscriptions = [];
  for (const customer of customers) {
    const listed = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'all',
      limit: 20,
      expand: ['data.items.data.price.product'],
    });
    for (const sub of listed.data) {
      subscriptions.push({
        customerId: customer.id,
        customerEmail: customer.email,
        subscriptionId: sub.id,
        status: sub.status,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        currentPeriodEnd: (() => {
          const raw = sub as unknown as { current_period_end?: number; items?: { data?: Array<{ current_period_end?: number }> } };
          const end = raw.current_period_end ?? raw.items?.data?.[0]?.current_period_end;
          return typeof end === 'number' ? new Date(end * 1000).toISOString() : null;
        })(),
        products: sub.items.data.map((item) => {
          const product = item.price.product;
          const name = typeof product === 'string' ? product : product && !product.deleted ? product.name : null;
          return {
            productId: typeof product === 'string' ? product : product?.id,
            name,
            priceId: item.price.id,
            amount: item.price.unit_amount,
            interval: item.price.recurring?.interval || null,
          };
        }),
      });
    }
  }

  const purchaseGrants = (purchases || []).map((p) => ({
    productName: p.product_name,
    amountPaid: p.amount_paid,
    stripeCustomerId: p.stripe_customer_id,
    stripeSessionId: p.stripe_session_id,
    createdAt: p.created_at,
    grant: briefingGrantForPurchase(p.product_name, Number(p.amount_paid) || 0),
  }));

  const active = subscriptions.filter((s) => s.status === 'active' || s.status === 'trialing' || s.status === 'past_due');
  const entitlement = {
    stripeCustomersFound: customers.length,
    activeOrPastDueSubscriptions: active.length,
    currentEntitlementProven: active.length > 0,
    grantAllowed: active.length > 0,
    reason: active.length > 0
      ? 'Stripe subscription currently active/trialing/past_due'
      : customers.length === 0
        ? 'no Stripe customer for this email or stored ids'
        : 'Stripe customer exists but no current active/trialing/past_due subscription',
  };

  console.log(JSON.stringify({
    asOf: new Date().toISOString(),
    email,
    profile: profile || null,
    classification: classification || null,
    purchases: purchaseGrants,
    checkoutSessions,
    stripeCustomers: customers.map((c) => ({
      id: c.id,
      email: c.email,
      created: new Date(c.created * 1000).toISOString(),
      deleted: Boolean(c.deleted),
    })),
    subscriptions,
    entitlement,
    didNotWrite: true,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
