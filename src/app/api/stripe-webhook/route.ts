import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createAccessCode } from '@/lib/access-codes';
import { sendAccessCodeEmail } from '@/lib/send-email';

// Live and test webhook secrets (must be set in environment variables)
const liveWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const testWebhookSecret = process.env.STRIPE_TEST_WEBHOOK_SECRET || '';

// Product IDs for Federal Market Assassin - only these products trigger access codes
const MARKET_ASSASSIN_PRODUCT_IDS = [
  'prod_TiOjPpnyLnO3eb', // Live product
  // Test products will be allowed if event is from test mode
];

// Lazy-load Stripe to avoid build-time errors
function getStripe(testMode: boolean = false) {
  const liveKey = process.env.STRIPE_SECRET_KEY || '';
  const testKey = process.env.STRIPE_TEST_SECRET_KEY || '';
  return new Stripe(testMode ? testKey : liveKey);
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    console.error('❌ No Stripe signature found');
    return NextResponse.json({ error: 'No signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  let isTestMode = false;

  // Try live secret first, then test secret
  try {
    const stripe = getStripe(false);
    event = stripe.webhooks.constructEvent(body, signature, liveWebhookSecret);
  } catch (liveErr: any) {
    try {
      const stripeTest = getStripe(true);
      event = stripeTest.webhooks.constructEvent(body, signature, testWebhookSecret);
      isTestMode = true;
      console.log('🧪 Using test webhook secret');
    } catch (testErr: any) {
      console.error('❌ Webhook signature verification failed:', liveErr.message);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }
  }

  // Use the appropriate Stripe instance
  const stripe = getStripe(isTestMode);

  console.log(`📥 Received Stripe event: ${event.type}`);

  // Handle checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    // Retrieve line items to check product ID
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
      expand: ['data.price.product'],
    });

    // Check if this is a test mode event

    // Check if this purchase includes the Market Assassin product
    const hasMarketAssassinProduct = lineItems.data.some((item) => {
      const product = item.price?.product;
      const productId = typeof product === 'string' ? product : product?.id;
      return MARKET_ASSASSIN_PRODUCT_IDS.includes(productId || '');
    });

    // In test mode, allow any product for testing purposes
    if (!hasMarketAssassinProduct && !isTestMode) {
      console.log('📦 Purchase does not include Market Assassin product, skipping access code');
      return NextResponse.json({ received: true, message: 'Not a Market Assassin purchase' });
    }

    if (isTestMode) {
      console.log('🧪 Test mode purchase - allowing access code generation');
    }

    const customerEmail = session.customer_email || session.customer_details?.email;
    const customerName = session.customer_details?.name;

    if (!customerEmail) {
      console.error('❌ No customer email found in checkout session');
      return NextResponse.json({ error: 'No customer email' }, { status: 400 });
    }

    console.log(`💳 Market Assassin purchase completed for: ${customerEmail}`);

    // Create access code
    const accessCode = await createAccessCode(customerEmail, customerName || undefined);
    const accessLink = `https://tools.govcongiants.org/access/${accessCode.code}`;

    console.log(`🔑 Created access code: ${accessCode.code} for ${customerEmail}`);

    // Send email with access link
    const emailSent = await sendAccessCodeEmail({
      to: customerEmail,
      companyName: customerName || undefined,
      accessCode: accessCode.code,
      accessLink,
    });

    if (emailSent) {
      console.log(`✅ Access email sent to ${customerEmail}`);
    } else {
      console.error(`❌ Failed to send access email to ${customerEmail}`);
    }

    return NextResponse.json({
      success: true,
      message: 'Access code created and email sent',
      accessCode: accessCode.code,
    });
  }

  // Return 200 for other events
  return NextResponse.json({ received: true });
}
