import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createAccessCode, createDatabaseToken, grantOpportunityHunterProAccess, grantMarketAssassinAccess } from '@/lib/access-codes';
import { sendAccessCodeEmail, sendDatabaseAccessEmail, sendOpportunityHunterProEmail } from '@/lib/send-email';

// Webhook secrets from environment
const liveWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const testWebhookSecret = process.env.STRIPE_TEST_WEBHOOK_SECRET || '';

// Product IDs for Federal Market Assassin - legacy access codes (deprecated, use Standard/Premium tiers)
const MARKET_ASSASSIN_PRODUCT_IDS: string[] = [
  // Legacy product moved to Premium tier
];

// Product IDs for Federal Contractor Database - direct access link
const DATABASE_PRODUCT_IDS = [
  'prod_Tj551jheCp9wdQ', // Live product
];

// Product IDs for Opportunity Hunter Pro
const OPPORTUNITY_SCOUT_PRO_PRODUCT_IDS = [
  'prod_TlVBTsPCtgmKuY', // Live product
];

// Product IDs for Market Assassin Standard ($297)
const MARKET_ASSASSIN_STANDARD_PRODUCT_IDS: string[] = [
  'prod_TlWsJM5a0JEvs7', // Live product
];

// Product IDs for Market Assassin Premium ($497)
const MARKET_ASSASSIN_PREMIUM_PRODUCT_IDS: string[] = [
  'prod_TiOjPpnyLnO3eb', // Live product
];

// Lazy-load Stripe to avoid build-time errors
function getStripe(testMode: boolean = false) {
  const liveKey = process.env.STRIPE_SECRET_KEY || '';
  const testKey = process.env.STRIPE_TEST_SECRET_KEY || '';
  return new Stripe(testMode ? testKey : liveKey);
}

// Simple in-memory idempotency check (for serverless, consider using a database)
const processedEvents = new Set<string>();

export async function POST(request: NextRequest) {
  console.log('=== STRIPE WEBHOOK RECEIVED ===');
  console.log('Timestamp:', new Date().toISOString());

  // Get the raw body as text - MUST be done before any other body reading
  const rawBody = await request.text();

  // Debug logging
  console.log('Raw body length:', rawBody.length);
  console.log('Raw body preview (first 100 chars):', rawBody.substring(0, 100));

  // Get signature header
  const signature = request.headers.get('stripe-signature');
  console.log('Stripe-Signature header present:', !!signature);
  console.log('Stripe-Signature value:', signature?.substring(0, 50) + '...');

  // Log all headers for debugging
  console.log('All headers:');
  request.headers.forEach((value, key) => {
    if (key.toLowerCase().includes('stripe') || key.toLowerCase() === 'content-type') {
      console.log(`  ${key}: ${value}`);
    }
  });

  if (!signature) {
    console.error('No Stripe signature found in headers');
    return NextResponse.json({ error: 'No signature' }, { status: 400 });
  }

  // Check if secrets are configured
  console.log('Live webhook secret configured:', !!liveWebhookSecret, 'length:', liveWebhookSecret.length);
  console.log('Test webhook secret configured:', !!testWebhookSecret, 'length:', testWebhookSecret.length);
  console.log('Live secret starts with:', liveWebhookSecret.substring(0, 10) + '...');

  let event: Stripe.Event;
  let isTestMode = false;

  // Try live secret first, then test secret
  try {
    console.log('Attempting verification with LIVE webhook secret...');
    const stripe = getStripe(false);
    event = stripe.webhooks.constructEvent(rawBody, signature, liveWebhookSecret);
    console.log('SUCCESS: Verified with live webhook secret');
  } catch (liveErr: unknown) {
    const liveError = liveErr as Error;
    console.log('FAILED with live secret:', liveError.message);

    try {
      console.log('Attempting verification with TEST webhook secret...');
      const stripeTest = getStripe(true);
      event = stripeTest.webhooks.constructEvent(rawBody, signature, testWebhookSecret);
      isTestMode = true;
      console.log('SUCCESS: Verified with test webhook secret');
    } catch (testErr: unknown) {
      const testError = testErr as Error;
      console.error('FAILED with test secret:', testError.message);
      console.error('=== WEBHOOK SIGNATURE VERIFICATION FAILED ===');
      console.error('Possible causes:');
      console.error('1. Webhook secret mismatch - verify STRIPE_WEBHOOK_SECRET in Vercel matches Stripe Dashboard');
      console.error('2. Request body was modified before reaching this handler');
      console.error('3. Clock skew (unlikely but possible)');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }
  }

  // Idempotency check - prevent duplicate processing
  if (processedEvents.has(event.id)) {
    console.log(`Event ${event.id} already processed, skipping (idempotency)`);
    return NextResponse.json({ received: true, duplicate: true });
  }
  processedEvents.add(event.id);

  // Clean up old events (keep last 1000)
  if (processedEvents.size > 1000) {
    const firstEvent = processedEvents.values().next().value;
    if (firstEvent) processedEvents.delete(firstEvent);
  }

  // Use the appropriate Stripe instance
  const stripe = getStripe(isTestMode);

  console.log(`Event verified successfully!`);
  console.log(`Event ID: ${event.id}`);
  console.log(`Event Type: ${event.type}`);
  console.log(`Test Mode: ${isTestMode}`);

  // Handle checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    console.log('=== CHECKOUT SESSION COMPLETED ===');
    console.log('Session ID:', session.id);
    console.log('Customer Email:', session.customer_email || session.customer_details?.email);
    console.log('Customer Name:', session.customer_details?.name);
    console.log('Amount Total:', session.amount_total);
    console.log('Currency:', session.currency);
    console.log('Payment Status:', session.payment_status);

    // Retrieve line items to check product ID
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
      expand: ['data.price.product'],
    });

    console.log('Line items count:', lineItems.data.length);

    // Check which product was purchased
    let purchasedProductId: string | null = null;
    lineItems.data.forEach((item, index) => {
      const product = item.price?.product;
      const productId = typeof product === 'string' ? product : product?.id;
      console.log(`Line item ${index}: Product ID = ${productId}, Description = ${item.description}`);
      if (productId) purchasedProductId = productId;
    });

    const hasMarketAssassinProduct = MARKET_ASSASSIN_PRODUCT_IDS.includes(purchasedProductId || '');
    const hasDatabaseProduct = DATABASE_PRODUCT_IDS.includes(purchasedProductId || '');
    const hasOpportunityScoutPro = OPPORTUNITY_SCOUT_PRO_PRODUCT_IDS.includes(purchasedProductId || '');
    const hasMarketAssassinStandard = MARKET_ASSASSIN_STANDARD_PRODUCT_IDS.includes(purchasedProductId || '');
    const hasMarketAssassinPremium = MARKET_ASSASSIN_PREMIUM_PRODUCT_IDS.includes(purchasedProductId || '');

    console.log('Product matching:', {
      hasMarketAssassinProduct,
      hasDatabaseProduct,
      hasOpportunityScoutPro,
      hasMarketAssassinStandard,
      hasMarketAssassinPremium,
    });

    const customerEmail = session.customer_email || session.customer_details?.email;
    const customerName = session.customer_details?.name;

    if (!customerEmail) {
      console.error('No customer email found in checkout session');
      return NextResponse.json({ error: 'No customer email' }, { status: 400 });
    }

    // Handle Opportunity Hunter Pro purchase
    if (hasOpportunityScoutPro) {
      console.log(`Processing Opportunity Hunter Pro purchase for: ${customerEmail}`);

      await grantOpportunityHunterProAccess(customerEmail, customerName || undefined);

      const emailSent = await sendOpportunityHunterProEmail({
        to: customerEmail,
        customerName: customerName || undefined,
      });

      console.log(`Opportunity Hunter Pro - Email sent: ${emailSent}`);

      return NextResponse.json({
        success: true,
        message: 'Opportunity Hunter Pro access granted and email sent',
        product: 'opportunity-scout-pro',
      });
    }

    // Handle Market Assassin Standard purchase ($297)
    if (hasMarketAssassinStandard) {
      console.log(`Processing Market Assassin Standard purchase for: ${customerEmail}`);

      await grantMarketAssassinAccess(customerEmail, 'standard', customerName || undefined);

      console.log(`Market Assassin Standard access granted to ${customerEmail}`);

      return NextResponse.json({
        success: true,
        message: 'Market Assassin Standard access granted',
        product: 'market-assassin-standard',
        tier: 'standard',
      });
    }

    // Handle Market Assassin Premium purchase ($497)
    if (hasMarketAssassinPremium) {
      console.log(`Processing Market Assassin Premium purchase for: ${customerEmail}`);

      await grantMarketAssassinAccess(customerEmail, 'premium', customerName || undefined);

      console.log(`Market Assassin Premium access granted to ${customerEmail}`);

      return NextResponse.json({
        success: true,
        message: 'Market Assassin Premium access granted',
        product: 'market-assassin-premium',
        tier: 'premium',
      });
    }

    // Handle Federal Contractor Database purchase
    if (hasDatabaseProduct) {
      console.log(`Processing Federal Contractor Database purchase for: ${customerEmail}`);

      const dbToken = await createDatabaseToken(customerEmail, customerName || undefined);
      const accessLink = `https://tools.govcongiants.org/api/database-access/${dbToken.token}`;

      console.log(`Database access token created: ${dbToken.token}`);

      const emailSent = await sendDatabaseAccessEmail({
        to: customerEmail,
        customerName: customerName || undefined,
        accessLink,
      });

      console.log(`Database access email sent: ${emailSent}`);

      return NextResponse.json({
        success: true,
        message: 'Database access email sent',
        product: 'federal-contractor-database',
        token: dbToken.token,
      });
    }

    // Handle Market Assassin purchase (legacy)
    if (hasMarketAssassinProduct || isTestMode) {
      if (isTestMode && !hasMarketAssassinProduct) {
        console.log('Test mode purchase - allowing access code generation');
      }

      console.log(`Processing Market Assassin (legacy) purchase for: ${customerEmail}`);

      const accessCode = await createAccessCode(customerEmail, customerName || undefined);
      const accessLink = `https://tools.govcongiants.org/access/${accessCode.code}`;

      console.log(`Access code created: ${accessCode.code}`);

      const emailSent = await sendAccessCodeEmail({
        to: customerEmail,
        companyName: customerName || undefined,
        accessCode: accessCode.code,
        accessLink,
      });

      console.log(`Access email sent: ${emailSent}`);

      return NextResponse.json({
        success: true,
        message: 'Access code created and email sent',
        accessCode: accessCode.code,
      });
    }

    // Unknown product
    console.log(`Purchase does not match any known product (${purchasedProductId}), skipping`);
    return NextResponse.json({ received: true, message: 'Product not configured for access' });
  }

  // Return 200 for other events
  console.log(`Event type ${event.type} received but not handled, returning 200`);
  return NextResponse.json({ received: true });
}
