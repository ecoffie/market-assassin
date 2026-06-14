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
  sendMarketIntelligenceWelcomeEmail,
} from '@/lib/send-email';
import { getOrCreateProfile, updateAccessFlags } from '@/lib/supabase/user-profiles';
import { grantBriefingsAccess } from '@/lib/briefings/access';

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

  let event: Stripe.Event;
  let isTestMode = false;

  // Verify signature
  try {
    if (!signature) throw new Error('No Stripe signature header');
    const stripe = getStripe(false);
    event = stripe.webhooks.constructEvent(rawBody, signature, liveWebhookSecret);
    console.log('Live signature verified successfully');
  } catch (liveError) {
    console.log('Live signature failed:', liveError instanceof Error ? liveError.message : 'unknown error');
    try {
      if (!signature) throw new Error('No Stripe signature header');
      const stripeTest = getStripe(true);
      event = stripeTest.webhooks.constructEvent(rawBody, signature, testWebhookSecret);
      isTestMode = true;
      console.log('Test signature verified successfully');
    } catch (testError) {
      console.log('Test signature also failed:', testError instanceof Error ? testError.message : 'unknown error');
      try {
        const parsed = JSON.parse(rawBody) as { id?: string; livemode?: boolean };
        if (!parsed.id?.startsWith('evt_')) {
          return NextResponse.json({ error: 'Invalid Stripe event' }, { status: 400 });
        }

        // Stripe uses a different signing secret per webhook endpoint. This
        // legacy endpoint may receive valid events signed with an old endpoint
        // secret, so verify authenticity by retrieving the event from Stripe.
        isTestMode = parsed.livemode === false;
        event = await getStripe(isTestMode).events.retrieve(parsed.id);
        console.log(`Recovered Stripe event ${event.id} via Events API`);
      } catch (retrieveError) {
        console.log('Unable to recover Stripe event:', retrieveError instanceof Error ? retrieveError.message : 'unknown error');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
      }
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
    let tier = session.metadata?.tier;
    const bundle = session.metadata?.bundle;
    const email = session.customer_details?.email || session.customer_email;

    if (!email) {
      return NextResponse.json({ error: 'No email' }, { status: 400 });
    }

    console.log(`Checkout completed: ${email}, tier: ${tier}, bundle: ${bundle}`);

    // Get line items for product_id
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
    const productId = lineItems.data[0]?.price?.id || 'unknown';
    const lineItemDescription = lineItems.data[0]?.description || '';
    const normalizedDescription = lineItemDescription.toLowerCase();

    // Payment links for standalone Mindy AI may not inject session metadata.
    // Fall back to the product description so the purchase still grants
    // the right access. Order matters: Team first, then lifetime (before
    // generic briefings/mindy match), then recurring briefings.
    if (!tier && !bundle) {
      if (normalizedDescription.includes('team monthly') || normalizedDescription.includes('team annual')) {
        tier = normalizedDescription.includes('annual') ? 'team_annual' : 'team_monthly';
      } else if (
        normalizedDescription.includes('lifetime') &&
        (normalizedDescription.includes('mindy') ||
          normalizedDescription.includes('briefings') ||
          normalizedDescription.includes('market intelligence') ||
          normalizedDescription.includes('founders'))
      ) {
        tier = 'briefings_lifetime';
      } else if (
        normalizedDescription.includes('market intelligence') ||
        normalizedDescription.includes('daily briefings') ||
        normalizedDescription.includes('mindy ai')
      ) {
        tier = 'briefings';
      }
      // Legacy Ultimate ($1,497) + bootcamp Mindy Lifetime ($2,997) + Founders ($4,997)
      if (!tier && session.amount_total === 149700) {
        tier = 'briefings_lifetime';
      }
      if (!tier && session.amount_total === 299700) {
        tier = 'briefings_lifetime';
      }
      if (!tier && session.amount_total === 499700) {
        tier = 'briefings_lifetime';
      }
    }

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
        product_name: lineItemDescription,
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

    // Cross-site purchase attribution (non-fatal): join the pre-checkout
    // attribution captured by the /checkout hop (client_reference_id) and
    // record this sale in the shared Upstash store so it shows on the unified
    // govcongiants.com /admin/purchases dashboard tagged site="mindy". Wrapped
    // so a tracking hiccup can NEVER block access provisioning below.
    try {
      const { getCheckoutStart, savePurchase } = await import('@/lib/purchase-attribution');
      const attributionId =
        session.client_reference_id || session.metadata?.attribution_id || null;
      const checkoutStart = await getCheckoutStart(attributionId);
      await savePurchase({
        id: session.id,
        event_id: event.id,
        event_type: event.type,
        status: 'paid',
        product_id: checkoutStart?.product_id || productId,
        product_name: checkoutStart?.product_name || lineItemDescription || 'Mindy Purchase',
        product_price: checkoutStart?.product_price,
        amount_cents: session.amount_total ?? checkoutStart?.amount_cents ?? undefined,
        currency: session.currency ?? undefined,
        customer_email: email,
        customer_name: session.customer_details?.name || undefined,
        stripe_checkout_session_id: session.id,
        stripe_customer_id:
          typeof session.customer === 'string' ? session.customer : session.customer?.id,
        attribution_id: attributionId ?? undefined,
        attribution: checkoutStart?.attribution,
        created_at: new Date().toISOString(),
        raw_created: event.created,
      });
    } catch (attrErr) {
      console.error('[stripe-webhook] purchase attribution write failed (non-fatal):', attrErr);
    }

    // Affiliate commission (30% recurring) — non-fatal
    try {
      const { recordAffiliateFromStripePayment } = await import('@/lib/mindy/affiliate-commissions');
      const { getCheckoutStart } = await import('@/lib/purchase-attribution');
      const attributionId =
        session.client_reference_id || session.metadata?.attribution_id || null;
      const checkoutStart = await getCheckoutStart(attributionId);
      const grossCents = session.amount_total ?? checkoutStart?.amount_cents ?? 0;
      if (grossCents > 0 && email) {
        const commission = await recordAffiliateFromStripePayment({
          supabase,
          customerEmail: email,
          grossCents,
          stripeEventId: event.id,
          eventType: 'checkout',
          currency: session.currency ?? undefined,
          productLabel: checkoutStart?.product_name || lineItemDescription,
          partnerCode: checkoutStart?.attribution?.partner_code,
        });
        if (commission) {
          console.log(
            `[stripe-webhook] Affiliate ${commission.commissionPercent}% recorded: `
            + `${commission.partnerCode} +$${(commission.commissionCents / 100).toFixed(2)} `
            + `from ${email}`,
          );
        }
      }
    } catch (affiliateErr) {
      console.error('[stripe-webhook] affiliate commission failed (non-fatal):', affiliateErr);
    }

    // Auto-update access flags (always update, user_id is optional)
    const accessUpdates = await updateAccessFlags(email, tier, bundle);

    // Keep KV in sync with paid briefings entitlement so /briefings access works immediately.
    if (accessUpdates.access_briefings) {
      await grantBriefingsAccess(email);
    }

    // Team purchase: provision the team workspace + migrate the buyer's
    // personal pipeline/contacts/targets into it. updateAccessFlags already
    // set access_team; this creates the actual shared workspace so they land
    // in a team (not their personal one) on next load. Idempotent + non-fatal
    // so a provisioning hiccup never fails the webhook (the /app self-heal and
    // POST /api/app/team/upgrade also call it).
    if (accessUpdates.access_team || tier === 'team_monthly' || tier === 'team_annual') {
      try {
        const { provisionTeamWorkspace } = await import('@/lib/app/workspace');
        await provisionTeamWorkspace(email);
      } catch (provisionErr) {
        console.error('[stripe-webhook] team workspace provisioning failed (non-fatal):', provisionErr);
      }
    }

    // Get/create profile
    const profile = await getOrCreateProfile(email);
    const customerName = session.customer_details?.name || undefined;
    const productName = lineItems.data[0]?.description || 'GovCon Product';

    // AUTO-ENROLL ALL PURCHASERS in notification settings (free daily alerts during beta)
    // This ensures every paying customer gets daily opportunity alerts
    // Note: Uses unified user_notification_settings table (not old user_alert_settings)
    if (supabase) {
      const { data: existingSettings } = await supabase
        .from('user_notification_settings')
        .select('user_email')
        .eq('user_email', email.toLowerCase())
        .limit(1);

      if (!existingSettings || existingSettings.length === 0) {
        // Create new notification settings for this purchaser
        await supabase.from('user_notification_settings').insert({
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
          .from('user_notification_settings')
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
          .from('user_notification_settings')
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
          .from('user_notification_settings')
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
      const accessLink = `https://getmindy.ai/contractor-database?email=${encodeURIComponent(email)}`;
      await sendDatabaseAccessEmail({ to: email, customerName, accessLink });
    } else if (tier === 'assassin_standard' || tier === 'assassin_premium' || tier === 'assassin_premium_upgrade') {
      // Market Assassin - use access code email with tutorial
      const accessLink = `https://getmindy.ai/market-assassin?email=${encodeURIComponent(email)}`;
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
    } else if (
      tier === 'briefings' ||
      tier === 'briefings_monthly' ||
      tier === 'briefings_annual' ||
      tier === 'briefings_lifetime' ||
      tier === 'team_monthly' ||
      tier === 'team_annual'
    ) {
      // Team uses the same welcome email as Pro for now — both
      // unlock the same /app surface. A team-specific welcome
      // (with "5 seats included" + "Invite teammates →" link)
      // is a Phase 2 polish; not blocking for v1 launch.
      await sendMarketIntelligenceWelcomeEmail({ to: email, customerName });
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

  // Recurring affiliate commission on subscription renewals (not first checkout —
  // checkout.session.completed already records the initial payment).
  if (event.type === 'invoice.paid') {
    const invoice = event.data.object as Stripe.Invoice;
    if (invoice.billing_reason === 'subscription_create') {
      return NextResponse.json({ received: true, action: 'invoice_skipped_initial' });
    }

    const grossCents = invoice.amount_paid ?? 0;
    let email = invoice.customer_email || null;
    if (!email && invoice.customer) {
      const customerId = typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer.id;
      const customer = await stripe.customers.retrieve(customerId);
      if (!customer.deleted) email = customer.email;
    }

    if (grossCents > 0 && email) {
      try {
        const { recordAffiliateFromStripePayment } = await import('@/lib/mindy/affiliate-commissions');
        const line = invoice.lines?.data?.[0];
        await recordAffiliateFromStripePayment({
          supabase,
          customerEmail: email,
          grossCents,
          stripeEventId: event.id,
          eventType: 'invoice',
          currency: invoice.currency ?? undefined,
          productLabel: line?.description || undefined,
        });
      } catch (affiliateErr) {
        console.error('[stripe-webhook] invoice affiliate commission failed (non-fatal):', affiliateErr);
      }
    }

    return NextResponse.json({ received: true, action: 'invoice_paid' });
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
              .from('user_notification_settings')
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
        .from('user_notification_settings')
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
