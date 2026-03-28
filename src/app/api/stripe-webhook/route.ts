import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import {
  sendLicenseKeyEmail,
  sendOpportunityHunterProEmail,
  sendDatabaseAccessEmail,
  sendAccessCodeEmail,
  sendContentReaperEmail,
  sendRecompeteEmail,
  sendBundleEmail,
  sendFHCWelcomeEmail,
  sendAlertProWelcomeEmail,
} from '@/lib/send-email';
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

    // Get/create profile
    const profile = await getOrCreateProfile(email);
    const customerName = session.customer_details?.name || undefined;
    const productName = lineItems.data[0]?.description || 'GovCon Product';

    // AUTO-ENROLL ALL PURCHASERS in alert settings (free daily alerts during beta)
    // This ensures every paying customer gets daily opportunity alerts
    if (supabase) {
      const { data: existingSettings } = await supabase
        .from('user_alert_settings')
        .select('user_email')
        .eq('user_email', email.toLowerCase())
        .limit(1);

      if (!existingSettings || existingSettings.length === 0) {
        // Create new alert settings for this purchaser
        await supabase.from('user_alert_settings').insert({
          user_email: email.toLowerCase(),
          alerts_enabled: true,
          briefings_enabled: true,
          alert_frequency: 'daily',
          is_active: true,
          subscription_status: 'beta', // Beta access for purchasers
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        console.log(`✅ Auto-enrolled purchaser in alerts: ${email}`);
      } else {
        // Ensure existing users have alerts enabled
        await supabase
          .from('user_alert_settings')
          .update({
            alerts_enabled: true,
            briefings_enabled: true,
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq('user_email', email.toLowerCase());
        console.log(`✅ Enabled alerts for existing user: ${email}`);
      }
    }

    // Check if this is an Alert Pro subscription
    const isAlertPro = tier === 'alert_pro' ||
      productName?.toLowerCase().includes('alert pro') ||
      lineItems.data.some(item => (item.price?.product as string) === 'prod_U9rOClXY6MFcRu');

    // Check if this is a Federal Help Center membership
    const isFHCMembership = tier === 'fhc_membership' ||
      productName?.toLowerCase().includes('federal help center') ||
      productName?.toLowerCase().includes('fhc');

    if (isAlertPro) {
      // Alert Pro subscription - set user to daily frequency
      if (supabase) {
        await supabase
          .from('user_alert_settings')
          .update({
            alert_frequency: 'daily',
            subscription_status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('user_email', email.toLowerCase());
      }

      // Set KV access for Alert Pro + Opportunity Hunter Pro (Alert Pro includes OH Pro)
      try {
        await kv.set(`alertpro:${email.toLowerCase()}`, 'true');
        await kv.set(`ospro:${email.toLowerCase()}`, 'true');
        console.log(`✅ Alert Pro + OH Pro activated for: ${email}`);
      } catch (kvError) {
        console.error('KV error (non-fatal):', kvError);
      }

      // Also update Supabase access flags for OH Pro
      await updateAccessFlags(email, 'hunter_pro');

      // Send welcome email
      await sendAlertProWelcomeEmail({ to: email, customerName });
    } else if (isFHCMembership) {
      // Grant MA Standard + Alert Pro for FHC members ($99/mo includes Alert Pro as a benefit)
      await updateAccessFlags(email, 'assassin_standard');
      await updateAccessFlags(email, 'hunter_pro'); // Alert Pro includes OH Pro

      // Set KV access for MA + Alert Pro (FHC members get daily alerts as a premium benefit)
      try {
        await kv.set(`ma:${email.toLowerCase()}`, 'true');
        await kv.set(`alertpro:${email.toLowerCase()}`, 'true');
        await kv.set(`ospro:${email.toLowerCase()}`, 'true'); // Alert Pro includes OH Pro
        console.log(`✅ KV access set for FHC member (MA + Alert Pro): ${email}`);
      } catch (kvError) {
        console.error('KV error (non-fatal):', kvError);
      }

      // Set alert frequency to daily for FHC members
      if (supabase) {
        await supabase
          .from('user_alert_settings')
          .upsert({
            user_email: email.toLowerCase(),
            alert_frequency: 'daily',
            subscription_status: 'active',
            is_active: true,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'user_email',
          });
      }

      // Send FHC welcome email
      await sendFHCWelcomeEmail({ to: email, customerName });
    } else if (bundle) {
      // Bundle purchase - send bundle email with all tool links
      await sendBundleEmail({ to: email, customerName, bundle });
    } else if (tier === 'hunter_pro') {
      // Opportunity Hunter Pro
      await sendOpportunityHunterProEmail({ to: email, customerName });
    } else if (tier === 'contractor_db') {
      // Federal Contractor Database
      const accessLink = `https://tools.govcongiants.org/contractor-database?email=${encodeURIComponent(email)}`;
      await sendDatabaseAccessEmail({ to: email, customerName, accessLink });
    } else if (tier === 'assassin_standard' || tier === 'assassin_premium' || tier === 'assassin_premium_upgrade') {
      // Market Assassin - use access code email with tutorial
      const accessLink = `https://tools.govcongiants.org/market-assassin?email=${encodeURIComponent(email)}`;
      await sendAccessCodeEmail({
        to: email,
        companyName: customerName,
        accessCode: profile?.license_key || 'See email for access',
        accessLink,
      });
    } else if (tier === 'content_standard' || tier === 'content_full_fix' || tier === 'content_full_fix_upgrade') {
      // Content Reaper
      const contentTier = (tier === 'content_full_fix' || tier === 'content_full_fix_upgrade') ? 'full_fix' : 'standard';
      await sendContentReaperEmail({ to: email, customerName, tier: contentTier });
    } else if (tier === 'recompete') {
      // Recompete Tracker
      await sendRecompeteEmail({ to: email, customerName });
    } else if (profile?.license_key) {
      // Fallback to generic license key email
      await sendLicenseKeyEmail({
        to: email,
        customerName,
        licenseKey: profile.license_key,
        productName,
      });
    }

    console.log(`✅ Purchase processed: ${email}, tier: ${tier}, bundle: ${bundle}`);

    return NextResponse.json({
      received: true,
      email,
      tier,
      bundle,
      isFHCMembership,
    });
  }

  // Handle subscription cancellation - revoke FHC access
  if (event.type === 'customer.subscription.deleted' ||
      event.type === 'customer.subscription.updated') {
    const subscription = event.data.object as Stripe.Subscription;

    // Only process if subscription is canceled/ended
    if (event.type === 'customer.subscription.updated' &&
        subscription.status !== 'canceled' &&
        subscription.status !== 'unpaid' &&
        subscription.status !== 'past_due') {
      // Not a cancellation, just a regular update
      return NextResponse.json({ received: true, action: 'ignored' });
    }

    // Check if this is an FHC subscription by looking at product metadata
    const items = subscription.items.data;
    let isFHCSubscription = false;

    for (const item of items) {
      const price = item.price;
      const productId = typeof price.product === 'string' ? price.product : price.product?.id;

      // FHC product IDs
      if (productId === 'prod_TaiXlKb350EIQs' || productId === 'prod_TMUmxKTtooTx6C') {
        isFHCSubscription = true;
        break;
      }

      // Also check metadata
      if (price.metadata?.tier === 'fhc_membership') {
        isFHCSubscription = true;
        break;
      }
    }

    // Check if this is an Alert Pro subscription
    let isAlertProSubscription = false;
    for (const item of items) {
      const price = item.price;
      const productId = typeof price.product === 'string' ? price.product : price.product?.id;
      if (productId === 'prod_U9rOClXY6MFcRu') {
        isAlertProSubscription = true;
        break;
      }
      if (price.metadata?.tier === 'alert_pro') {
        isAlertProSubscription = true;
        break;
      }
    }

    if (!isFHCSubscription && !isAlertProSubscription) {
      console.log('Non-FHC/AlertPro subscription event, ignoring');
      return NextResponse.json({ received: true, action: 'ignored' });
    }

    // Handle Alert Pro cancellation
    if (isAlertProSubscription) {
      const customerId = typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id;

      if (customerId) {
        const customer = await stripe.customers.retrieve(customerId);
        if (!customer.deleted && customer.email) {
          const email = customer.email.toLowerCase();
          console.log(`🚫 Alert Pro subscription canceled for: ${email}`);

          // Revert to weekly/free tier
          if (supabase) {
            await supabase
              .from('user_alert_settings')
              .update({
                alert_frequency: 'weekly',
                subscription_status: 'canceled',
                updated_at: new Date().toISOString(),
              })
              .eq('user_email', email);
          }

          // Remove KV access
          try {
            await kv.del(`alertpro:${email}`);
            console.log(`✅ Revoked Alert Pro for: ${email}`);
          } catch (kvError) {
            console.error('KV error:', kvError);
          }
        }
      }

      return NextResponse.json({
        received: true,
        action: 'alert_pro_revoked',
        reason: subscription.status,
      });
    }

    // Get customer email
    const customerId = typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id;

    if (!customerId) {
      return NextResponse.json({ error: 'No customer ID' }, { status: 400 });
    }

    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted || !customer.email) {
      return NextResponse.json({ error: 'Customer not found or no email' }, { status: 400 });
    }

    const email = customer.email.toLowerCase();
    console.log(`🚫 FHC subscription canceled for: ${email}`);

    // Revoke MA Standard + Alert Pro access (FHC members get Alert Pro, not briefings)
    if (supabase) {
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          access_assassin_standard: false,
          access_hunter_pro: false,
          updated_at: new Date().toISOString(),
        })
        .eq('email', email);

      if (updateError) {
        console.error('Error revoking access:', updateError);
      } else {
        console.log(`✅ Revoked Supabase access for: ${email}`);
      }

      // Revert alert frequency to weekly
      await supabase
        .from('user_alert_settings')
        .update({
          alert_frequency: 'weekly',
          subscription_status: 'canceled',
          updated_at: new Date().toISOString(),
        })
        .eq('user_email', email);
    }

    // Remove KV access (MA + Alert Pro + OH Pro)
    try {
      await kv.del(`ma:${email}`);
      await kv.del(`alertpro:${email}`);
      await kv.del(`ospro:${email}`);
      console.log(`✅ Revoked KV access for FHC member: ${email}`);
    } catch (kvError) {
      console.error('KV error revoking access:', kvError);
    }

    return NextResponse.json({
      received: true,
      action: 'revoked',
      email,
      reason: subscription.status,
    });
  }

  return NextResponse.json({ received: true });
}
