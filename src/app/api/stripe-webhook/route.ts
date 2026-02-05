import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { sendLicenseKeyEmail } from '@/lib/send-email';
import { getOrCreateProfile, updateAccessFlags } from '@/lib/supabase/user-profiles';

// Webhook secrets
const liveWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const testWebhookSecret = process.env.STRIPE_TEST_WEBHOOK_SECRET || '';

// Supabase admin client
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Lazy-load Stripe
function getStripe(testMode = false) {
  const liveKey = process.env.STRIPE_SECRET_KEY || '';
  const testKey = process.env.STRIPE_TEST_SECRET_KEY || '';
  return new Stripe(testMode ? testKey : liveKey);
}

// Idempotency check
const processedEvents = new Set<string>();

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');

  console.log('Webhook received, signature present:', !!signature);
  console.log('Live secret configured:', !!liveWebhookSecret, liveWebhookSecret ? `(starts with ${liveWebhookSecret.substring(0, 10)}...)` : '(empty)');
  console.log('Test secret configured:', !!testWebhookSecret, testWebhookSecret ? `(starts with ${testWebhookSecret.substring(0, 10)}...)` : '(empty)');

  if (!signature) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  let isTestMode = false;

  // Verify signature
  try {
    const stripe = getStripe(false);
    event = stripe.webhooks.constructEvent(rawBody, signature, liveWebhookSecret);
    console.log('Live signature verified successfully');
  } catch (liveError) {
    console.log('Live signature failed:', liveError instanceof Error ? liveError.message : 'unknown error');
    try {
      const stripeTest = getStripe(true);
      event = stripeTest.webhooks.constructEvent(rawBody, signature, testWebhookSecret);
      isTestMode = true;
      console.log('Test signature verified successfully');
    } catch (testError) {
      console.log('Test signature also failed:', testError instanceof Error ? testError.message : 'unknown error');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }
  }

  // Idempotency
  if (processedEvents.has(event.id)) {
    return NextResponse.json({ received: true, duplicate: true });
  }
  processedEvents.add(event.id);
  if (processedEvents.size > 1000) {
    const first = processedEvents.values().next().value;
    if (first) processedEvents.delete(first);
  }

  const stripe = getStripe(isTestMode);
  const supabase = getSupabase();

  console.log(`Stripe webhook: ${event.type} (test: ${isTestMode})`);

  // Handle checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const tier = session.metadata?.tier;
    const bundle = session.metadata?.bundle;
    const userId = session.metadata?.user_id;
    const email = session.customer_details?.email || session.customer_email;

    if (!email) {
      return NextResponse.json({ error: 'No email' }, { status: 400 });
    }

    console.log(`Checkout completed: ${email}, tier: ${tier}, bundle: ${bundle}`);

    // Get line items for product_id
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
    const productId = lineItems.data[0]?.price?.id || 'unknown';

    // Check if already processed
    if (supabase) {
      const { data: existing } = await supabase
        .from('purchases')
        .select('id')
        .eq('stripe_session_id', session.id)
        .limit(1);

      if (existing && existing.length > 0) {
        console.log('Session already processed, skipping');
        return NextResponse.json({ received: true, duplicate: true });
      }

      // Save purchase
      const { error: insertError } = await supabase.from('purchases').insert({
        user_email: email.toLowerCase(),
        stripe_session_id: session.id,
        stripe_customer_id: typeof session.customer === 'string' ? session.customer : session.customer?.id,
        product_id: productId,
        product_name: lineItems.data[0]?.description,
        tier: tier || 'unknown',
        bundle: bundle || null,
        amount_paid: session.amount_total ? session.amount_total / 100 : null,
        status: 'completed',
        metadata: session.metadata,
      });

      if (insertError) {
        console.error('Error saving purchase:', insertError);
      }
    }

    // Auto-update access flags (always update, user_id is optional)
    await updateAccessFlags(email, tier, bundle);

    // Get/create profile and send license key email
    const profile = await getOrCreateProfile(email);
    if (profile?.license_key) {
      const productName = bundle
        ? `GovCon ${bundle.charAt(0).toUpperCase() + bundle.slice(1)} Bundle`
        : lineItems.data[0]?.description || 'GovCon Product';

      await sendLicenseKeyEmail({
        to: email,
        customerName: session.customer_details?.name || undefined,
        licenseKey: profile.license_key,
        productName,
      });
    }

    return NextResponse.json({
      received: true,
      email,
      tier,
      bundle,
    });
  }

  return NextResponse.json({ received: true });
}
