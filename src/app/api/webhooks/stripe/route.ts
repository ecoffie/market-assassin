import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion,
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(request: Request) {
  const body = await request.text();
  const headersList = await headers();
  const sig = headersList.get('stripe-signature');

  let event: Stripe.Event;

  // Verify webhook signature
  if (webhookSecret && sig) {
    try {
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return NextResponse.json(
        { error: 'Webhook signature verification failed' },
        { status: 400 }
      );
    }
  } else {
    // For development/testing without signature verification
    try {
      event = JSON.parse(body) as Stripe.Event;
    } catch (err) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Log the webhook event
  await supabase.from('stripe_webhook_log').insert({
    event_id: event.id,
    event_type: event.type,
    object_id: (event.data.object as any).id,
    object_type: event.data.object.object,
    livemode: event.livemode,
    raw_payload: event.data.object,
    processed: false,
  });

  try {
    switch (event.type) {
      // Customer events
      case 'customer.created':
      case 'customer.updated':
        await handleCustomer(supabase, event.data.object as Stripe.Customer);
        break;

      case 'customer.deleted':
        await handleCustomerDeleted(supabase, event.data.object as Stripe.Customer);
        break;

      // Charge events
      case 'charge.succeeded':
        await handleChargeSucceeded(supabase, event.data.object as Stripe.Charge);
        break;

      case 'charge.refunded':
        await handleChargeRefunded(supabase, event.data.object as Stripe.Charge);
        break;

      // Subscription events
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscription(supabase, event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(supabase, event.data.object as Stripe.Subscription);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    // Mark as processed
    await supabase
      .from('stripe_webhook_log')
      .update({ processed: true })
      .eq('event_id', event.id);

    // Trigger classification refresh for affected customer
    const customerId = getCustomerIdFromEvent(event);
    if (customerId) {
      await refreshCustomerClassification(supabase, customerId);
    }

    return NextResponse.json({ received: true, type: event.type });
  } catch (error) {
    console.error('Error processing webhook:', error);

    // Log the error
    await supabase
      .from('stripe_webhook_log')
      .update({
        processed: false,
        error_message: error instanceof Error ? error.message : 'Unknown error',
      })
      .eq('event_id', event.id);

    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

// Handle customer create/update
async function handleCustomer(supabase: any, customer: Stripe.Customer) {
  const { error } = await supabase.from('stripe_customers').upsert({
    id: customer.id,
    email: customer.email || '',
    name: customer.name,
    phone: customer.phone,
    metadata: customer.metadata || {},
    created_at: new Date(customer.created * 1000).toISOString(),
    livemode: customer.livemode,
    deleted: false,
  });

  if (error) {
    console.error('Error upserting customer:', error);
    throw error;
  }
}

// Handle customer deletion
async function handleCustomerDeleted(supabase: any, customer: Stripe.Customer) {
  const { error } = await supabase
    .from('stripe_customers')
    .update({ deleted: true })
    .eq('id', customer.id);

  if (error) {
    console.error('Error marking customer as deleted:', error);
    throw error;
  }
}

// Handle successful charge
async function handleChargeSucceeded(supabase: any, charge: Stripe.Charge) {
  // First, ensure customer exists
  if (charge.customer && typeof charge.customer === 'string') {
    const customer = await stripe.customers.retrieve(charge.customer);
    if (!('deleted' in customer)) {
      await handleCustomer(supabase, customer);
    }
  }

  const enrichedMetadata = await enrichChargeMetadata(charge);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chargeAny = charge as any;
  const { error } = await supabase.from('stripe_charges').upsert({
    id: charge.id,
    customer_id: typeof charge.customer === 'string' ? charge.customer : charge.customer?.id,
    amount: charge.amount,
    currency: charge.currency,
    status: charge.status,
    description: charge.description,
    receipt_email: charge.receipt_email,
    invoice_id: typeof chargeAny.invoice === 'string' ? chargeAny.invoice : chargeAny.invoice?.id,
    payment_intent_id: typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id,
    metadata: enrichedMetadata,
    created_at: new Date(charge.created * 1000).toISOString(),
    livemode: charge.livemode,
    refunded: charge.refunded,
    amount_refunded: charge.amount_refunded,
  });

  if (error) {
    console.error('Error upserting charge:', error);
    throw error;
  }
}

async function enrichChargeMetadata(charge: Stripe.Charge): Promise<Record<string, unknown>> {
  const metadata: Record<string, unknown> = { ...(charge.metadata || {}) };
  if (metadata.product_name || metadata.product_id) return metadata;

  const chargeAny = charge as any;
  const invoiceId = typeof chargeAny.invoice === 'string' ? chargeAny.invoice : chargeAny.invoice?.id;
  if (!invoiceId) return metadata;

  try {
    const invoice: any = await stripe.invoices.retrieve(invoiceId, {
      expand: ['lines.data.price.product'],
    });
    const line = invoice.lines?.data?.find((item: any) => item.price?.product) || invoice.lines?.data?.[0];
    const product = line?.price?.product;

    if (product) {
      metadata.product_id = typeof product === 'string' ? product : product.id;
      metadata.product_name = typeof product === 'string' ? line?.description : product.name;
    } else if (line?.description || invoice.description || charge.description) {
      metadata.product_name = line?.description || invoice.description || charge.description;
    }

    if (line?.price?.id) metadata.price_id = line.price.id;
    if (invoice.subscription) {
      metadata.subscription_id = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription.id;
    }
  } catch (error) {
    console.warn(`Unable to enrich charge ${charge.id} from invoice ${invoiceId}:`, error);
  }

  return metadata;
}

// Handle charge refund
async function handleChargeRefunded(supabase: any, charge: Stripe.Charge) {
  const { error } = await supabase
    .from('stripe_charges')
    .update({
      refunded: charge.refunded,
      amount_refunded: charge.amount_refunded,
      status: charge.status,
    })
    .eq('id', charge.id);

  if (error) {
    console.error('Error updating refunded charge:', error);
    throw error;
  }
}

// Handle subscription create/update
async function handleSubscription(supabase: any, subscription: Stripe.Subscription) {
  // Get plan info from first item
  const item = subscription.items?.data?.[0];
  const plan = item?.plan;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sub = subscription as any;
  const { error } = await supabase.from('stripe_subscriptions').upsert({
    id: subscription.id,
    customer_id: typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id,
    status: subscription.status,
    current_period_start: sub.current_period_start
      ? new Date(sub.current_period_start * 1000).toISOString()
      : null,
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
    cancel_at_period_end: subscription.cancel_at_period_end,
    canceled_at: subscription.canceled_at
      ? new Date(subscription.canceled_at * 1000).toISOString()
      : null,
    ended_at: subscription.ended_at
      ? new Date(subscription.ended_at * 1000).toISOString()
      : null,
    trial_start: subscription.trial_start
      ? new Date(subscription.trial_start * 1000).toISOString()
      : null,
    trial_end: subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : null,
    metadata: subscription.metadata || {},
    created_at: new Date(subscription.created * 1000).toISOString(),
    livemode: subscription.livemode,
    plan_id: plan?.id,
    plan_amount: plan?.amount,
    plan_interval: plan?.interval,
  });

  if (error) {
    console.error('Error upserting subscription:', error);
    throw error;
  }
}

// Handle subscription deletion
async function handleSubscriptionDeleted(supabase: any, subscription: Stripe.Subscription) {
  const { error } = await supabase
    .from('stripe_subscriptions')
    .update({
      status: 'canceled',
      ended_at: new Date().toISOString(),
    })
    .eq('id', subscription.id);

  if (error) {
    console.error('Error updating deleted subscription:', error);
    throw error;
  }
}

// Extract customer ID from any event
function getCustomerIdFromEvent(event: Stripe.Event): string | null {
  const obj = event.data.object as any;

  if (obj.object === 'customer') {
    return obj.id;
  }

  if (obj.customer) {
    return typeof obj.customer === 'string' ? obj.customer : obj.customer.id;
  }

  return null;
}

// Refresh customer classification after data changes
async function refreshCustomerClassification(supabase: any, customerId: string) {
  // Get customer email
  const { data: customer } = await supabase
    .from('stripe_customers')
    .select('email')
    .eq('id', customerId)
    .single();

  if (!customer?.email) return;

  // Get all charges for this customer
  const { data: charges } = await supabase
    .from('stripe_charges')
    .select('*')
    .eq('customer_id', customerId)
    .eq('livemode', true)
    .eq('status', 'succeeded')
    .order('created_at', { ascending: false });

  // Get subscriptions
  const { data: subscriptions } = await supabase
    .from('stripe_subscriptions')
    .select('*')
    .eq('customer_id', customerId)
    .eq('livemode', true);

  // Calculate classification
  const classification = classifyCustomer(charges || [], subscriptions || []);

  // Calculate spend stats
  const totalSpend = (charges || []).reduce((sum: number, c: any) => sum + c.amount - c.amount_refunded, 0);
  const chargeCount = (charges || []).length;
  const firstCharge = charges?.[charges.length - 1];
  const lastCharge = charges?.[0];

  // Check for active subscriptions
  const activeSubscriptions = (subscriptions || []).filter((s: any) =>
    s.status === 'active' || s.status === 'trialing'
  );

  // Extract products from descriptions
  const products = extractProductNames(charges || []);

  // Upsert classification
  await supabase.from('customer_classifications').upsert({
    email: customer.email.toLowerCase(),
    customer_id: customerId,
    classification: classification.type,
    briefings_access: classification.briefingsAccess,
    briefings_expiry: classification.briefingsExpiry,
    bundle_tier: classification.bundleTier,
    total_spend: totalSpend,
    charge_count: chargeCount,
    first_charge_at: firstCharge?.created_at,
    last_charge_at: lastCharge?.created_at,
    has_active_subscription: activeSubscriptions.length > 0,
    subscription_type: classification.subscriptionType,
    products_purchased: products,
    classified_at: new Date().toISOString(),
    classification_version: 2,
  });
}

// Classification logic (matches align-treatment-types logic)
function classifyCustomer(charges: any[], subscriptions: any[]) {
  const result = {
    type: 'standalone' as string,
    briefingsAccess: 'none' as string,
    briefingsExpiry: null as string | null,
    bundleTier: null as string | null,
    subscriptionType: null as string | null,
  };

  // Filter out test/refunded charges
  const validCharges = charges.filter(c =>
    c.status === 'succeeded' &&
    c.amount > c.amount_refunded &&
    c.livemode === true
  );

  // Check for Inner Circle ($1500 recurring)
  const innerCircleCharges = validCharges.filter(c => {
    const amount = c.amount;
    const desc = (c.description || '').toLowerCase();
    const hasInvoice = !!c.invoice_id;
    return amount >= 149700 && amount <= 150300 &&
           hasInvoice &&
           (desc.includes('subscription') || desc.includes('inner circle'));
  });

  if (innerCircleCharges.length > 0) {
    // Check if still active
    const hasActiveInnerCircle = subscriptions.some(s =>
      (s.status === 'active' || s.status === 'trialing') &&
      s.plan_amount >= 149700 && s.plan_amount <= 150300
    );

    if (hasActiveInnerCircle) {
      result.type = 'inner_circle_active';
      result.briefingsAccess = 'lifetime';
      result.subscriptionType = 'inner_circle';
      return result;
    } else {
      result.type = 'inner_circle_churned';
      result.briefingsAccess = 'lifetime';
      result.subscriptionType = 'inner_circle';
      return result;
    }
  }

  // Check for Ultimate Bundle ($1497 one-time)
  const ultimateCharges = validCharges.filter(c => {
    const amount = c.amount;
    const desc = (c.description || '').toLowerCase();
    const noInvoice = !c.invoice_id;
    return amount >= 149600 && amount <= 149800 && noInvoice;
  });

  if (ultimateCharges.length > 0) {
    result.type = 'ultimate_giant';
    result.briefingsAccess = 'lifetime';
    result.bundleTier = 'Ultimate Bundle';
    return result;
  }

  // Check for Pro Giant Bundle ($997)
  const proGiantCharges = validCharges.filter(c => {
    const amount = c.amount;
    return amount >= 99600 && amount <= 99800;
  });

  if (proGiantCharges.length > 0) {
    result.type = 'pro_giant';
    result.briefingsAccess = '1_year';
    result.bundleTier = 'Pro Giant Bundle';
    // Set expiry to 1 year from purchase
    const purchaseDate = new Date(proGiantCharges[0].created_at);
    purchaseDate.setFullYear(purchaseDate.getFullYear() + 1);
    result.briefingsExpiry = purchaseDate.toISOString();
    return result;
  }

  // Check for Pro Member subscription ($52/month)
  const proMemberSub = subscriptions.find(s =>
    s.plan_amount >= 5100 && s.plan_amount <= 5300 &&
    s.plan_interval === 'month'
  );

  if (proMemberSub) {
    if (proMemberSub.status === 'active' || proMemberSub.status === 'trialing') {
      result.type = 'pro_member_active';
      result.briefingsAccess = 'subscription';
      result.subscriptionType = 'pro_member';
    } else {
      result.type = 'pro_member_churned';
      result.briefingsAccess = 'none';
      result.subscriptionType = 'pro_member';
    }
    return result;
  }

  // Check for MI subscription ($49/month)
  const miSub = subscriptions.find(s =>
    s.plan_amount >= 4800 && s.plan_amount <= 5000 &&
    s.plan_interval === 'month'
  );

  if (miSub) {
    if (miSub.status === 'active' || miSub.status === 'trialing') {
      result.type = 'mi_subscription';
      result.briefingsAccess = 'subscription';
      result.subscriptionType = 'mi';
    }
    return result;
  }

  // Check for Starter Bundle ($297)
  const starterCharges = validCharges.filter(c => {
    const amount = c.amount;
    return amount >= 29600 && amount <= 29800;
  });

  if (starterCharges.length > 0) {
    result.type = 'starter';
    result.bundleTier = 'Starter Bundle';
    result.briefingsAccess = 'none';
    return result;
  }

  // Default: standalone (other purchases) or free
  if (validCharges.length > 0) {
    result.type = 'standalone';
  } else {
    result.type = 'free';
  }

  return result;
}

// Extract product names from charge descriptions
function extractProductNames(charges: any[]): string[] {
  const products = new Set<string>();

  for (const charge of charges) {
    const desc = charge.description || '';

    // Match common product names
    if (desc.toLowerCase().includes('ultimate')) products.add('Ultimate Bundle');
    if (desc.toLowerCase().includes('pro giant')) products.add('Pro Giant Bundle');
    if (desc.toLowerCase().includes('starter')) products.add('Starter Bundle');
    if (desc.toLowerCase().includes('inner circle')) products.add('Inner Circle');
    if (desc.toLowerCase().includes('market intelligence') || desc.toLowerCase().includes('market assassin')) {
      products.add('Market Intelligence');
    }
    if (desc.toLowerCase().includes('content generator')) products.add('Content Generator');
    if (desc.toLowerCase().includes('contractor database')) products.add('Contractor Database');
    if (desc.toLowerCase().includes('recompete')) products.add('Recompete Tracker');
  }

  return Array.from(products);
}
