import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion,
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Rate limiting - Stripe allows 100 read requests/second in live mode
const BATCH_SIZE = 100;
const DELAY_BETWEEN_BATCHES = 1000; // 1 second

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const mode = searchParams.get('mode') || 'preview'; // preview | backfill | classify
  const type = searchParams.get('type') || 'all'; // all | customers | charges | subscriptions | classify

  if (password !== 'galata-assassin-2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const stats = {
    customers: { fetched: 0, inserted: 0, errors: 0 },
    charges: { fetched: 0, inserted: 0, errors: 0 },
    subscriptions: { fetched: 0, inserted: 0, errors: 0 },
    classifications: { computed: 0, inserted: 0, errors: 0 },
  };

  const errors: string[] = [];

  try {
    // Check if tables exist
    const tablesExist = await checkTablesExist(supabase);
    if (!tablesExist.allExist) {
      return NextResponse.json({
        success: false,
        error: 'Required tables do not exist',
        missingTables: tablesExist.missing,
        instructions: [
          '1. Go to Supabase Dashboard SQL Editor',
          '2. Run the migration from supabase/migrations/20260429_stripe_data_cache.sql',
          '3. Then run this endpoint again',
        ],
      });
    }

    if (mode === 'preview') {
      // Just count what would be synced
      const customerCount = await countStripeCustomers();
      const chargeCount = await countStripeCharges();
      const subscriptionCount = await countStripeSubscriptions();

      // Count existing in Supabase
      const { count: existingCustomers } = await supabase
        .from('stripe_customers')
        .select('*', { count: 'exact', head: true });
      const { count: existingCharges } = await supabase
        .from('stripe_charges')
        .select('*', { count: 'exact', head: true });
      const { count: existingSubscriptions } = await supabase
        .from('stripe_subscriptions')
        .select('*', { count: 'exact', head: true });
      const { count: existingClassifications } = await supabase
        .from('customer_classifications')
        .select('*', { count: 'exact', head: true });

      return NextResponse.json({
        success: true,
        mode: 'preview',
        stripe: {
          customers: customerCount,
          charges: chargeCount,
          subscriptions: subscriptionCount,
        },
        supabase: {
          customers: existingCustomers || 0,
          charges: existingCharges || 0,
          subscriptions: existingSubscriptions || 0,
          classifications: existingClassifications || 0,
        },
        instructions: {
          backfill: 'Use mode=backfill to sync all Stripe data to Supabase',
          backfillType: 'Use mode=backfill&type=customers to sync only customers',
          classify: 'Use mode=classify to compute classifications from existing data',
        },
        estimatedTime: `~${Math.ceil((customerCount + chargeCount + subscriptionCount) / 100)} seconds`,
      });
    }

    if (mode === 'backfill') {
      // Sync data from Stripe to Supabase
      if (type === 'all' || type === 'customers') {
        await backfillCustomers(supabase, stats, errors);
      }

      if (type === 'all' || type === 'charges') {
        await backfillCharges(supabase, stats, errors);
      }

      if (type === 'all' || type === 'subscriptions') {
        await backfillSubscriptions(supabase, stats, errors);
      }

      if (type === 'all' || type === 'classify') {
        await computeAllClassifications(supabase, stats, errors);
      }
    }

    if (mode === 'classify') {
      // Only compute classifications from existing data
      await computeAllClassifications(supabase, stats, errors);
    }

    return NextResponse.json({
      success: errors.length === 0,
      mode,
      type,
      stats,
      errors: errors.slice(0, 10), // Limit errors shown
      totalErrors: errors.length,
    });
  } catch (error) {
    console.error('Backfill error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stats,
      errors: errors.slice(0, 10),
    }, { status: 500 });
  }
}

async function checkTablesExist(supabase: any) {
  const tables = ['stripe_customers', 'stripe_charges', 'stripe_subscriptions', 'customer_classifications'];
  const missing: string[] = [];

  for (const table of tables) {
    const { error } = await supabase.from(table).select('*').limit(1);
    if (error?.code === 'PGRST205' || error?.message?.includes('does not exist')) {
      missing.push(table);
    }
  }

  return { allExist: missing.length === 0, missing };
}

async function countStripeCustomers(): Promise<number> {
  let count = 0;
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const params: Stripe.CustomerListParams = { limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;

    const customers = await stripe.customers.list(params);
    count += customers.data.filter(c => c.livemode !== false).length;
    hasMore = customers.has_more;
    if (customers.data.length > 0) {
      startingAfter = customers.data[customers.data.length - 1].id;
    }
  }

  return count;
}

async function countStripeCharges(): Promise<number> {
  let count = 0;
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const params: Stripe.ChargeListParams = { limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;

    const charges = await stripe.charges.list(params);
    count += charges.data.filter(c => c.livemode !== false && c.status === 'succeeded').length;
    hasMore = charges.has_more;
    if (charges.data.length > 0) {
      startingAfter = charges.data[charges.data.length - 1].id;
    }
  }

  return count;
}

async function countStripeSubscriptions(): Promise<number> {
  let count = 0;
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const params: Stripe.SubscriptionListParams = { limit: 100, status: 'all' };
    if (startingAfter) params.starting_after = startingAfter;

    const subscriptions = await stripe.subscriptions.list(params);
    count += subscriptions.data.filter(s => s.livemode !== false).length;
    hasMore = subscriptions.has_more;
    if (subscriptions.data.length > 0) {
      startingAfter = subscriptions.data[subscriptions.data.length - 1].id;
    }
  }

  return count;
}

async function backfillCustomers(supabase: any, stats: any, errors: string[]) {
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const params: Stripe.CustomerListParams = { limit: BATCH_SIZE };
    if (startingAfter) params.starting_after = startingAfter;

    const customers = await stripe.customers.list(params);

    for (const customer of customers.data) {
      // Skip test mode customers
      if (customer.livemode === false) continue;

      stats.customers.fetched++;

      const { error } = await supabase.from('stripe_customers').upsert({
        id: customer.id,
        email: customer.email || '',
        name: customer.name,
        phone: customer.phone,
        metadata: customer.metadata || {},
        created_at: new Date(customer.created * 1000).toISOString(),
        livemode: customer.livemode,
        deleted: customer.deleted || false,
      });

      if (error) {
        stats.customers.errors++;
        errors.push(`Customer ${customer.id}: ${error.message}`);
      } else {
        stats.customers.inserted++;
      }
    }

    hasMore = customers.has_more;
    if (customers.data.length > 0) {
      startingAfter = customers.data[customers.data.length - 1].id;
    }

    // Rate limiting
    if (hasMore) await sleep(DELAY_BETWEEN_BATCHES);
  }
}

async function backfillCharges(supabase: any, stats: any, errors: string[]) {
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const params: Stripe.ChargeListParams = { limit: BATCH_SIZE };
    if (startingAfter) params.starting_after = startingAfter;

    const charges = await stripe.charges.list(params);

    for (const charge of charges.data) {
      // Skip test mode and failed charges
      if (charge.livemode === false) continue;

      stats.charges.fetched++;
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
        stats.charges.errors++;
        errors.push(`Charge ${charge.id}: ${error.message}`);
      } else {
        stats.charges.inserted++;
      }
    }

    hasMore = charges.has_more;
    if (charges.data.length > 0) {
      startingAfter = charges.data[charges.data.length - 1].id;
    }

    // Rate limiting
    if (hasMore) await sleep(DELAY_BETWEEN_BATCHES);
  }
}

async function enrichChargeMetadata(charge: Stripe.Charge): Promise<Record<string, unknown>> {
  const metadata: Record<string, unknown> = { ...(charge.metadata || {}) };
  if (metadata.product_name || metadata.product_id) return metadata;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

async function backfillSubscriptions(supabase: any, stats: any, errors: string[]) {
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const params: Stripe.SubscriptionListParams = { limit: BATCH_SIZE, status: 'all' };
    if (startingAfter) params.starting_after = startingAfter;

    const subscriptions = await stripe.subscriptions.list(params);

    for (const subscription of subscriptions.data) {
      // Skip test mode
      if (subscription.livemode === false) continue;

      stats.subscriptions.fetched++;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sub = subscription as any;
      const item = sub.items?.data?.[0];
      const plan = item?.plan;

      const { error } = await supabase.from('stripe_subscriptions').upsert({
        id: sub.id,
        customer_id: typeof sub.customer === 'string'
          ? sub.customer
          : sub.customer?.id,
        status: sub.status,
        current_period_start: sub.current_period_start
          ? new Date(sub.current_period_start * 1000).toISOString()
          : null,
        current_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
        cancel_at_period_end: sub.cancel_at_period_end,
        canceled_at: sub.canceled_at
          ? new Date(sub.canceled_at * 1000).toISOString()
          : null,
        ended_at: sub.ended_at
          ? new Date(sub.ended_at * 1000).toISOString()
          : null,
        trial_start: sub.trial_start
          ? new Date(sub.trial_start * 1000).toISOString()
          : null,
        trial_end: sub.trial_end
          ? new Date(sub.trial_end * 1000).toISOString()
          : null,
        metadata: sub.metadata || {},
        created_at: new Date(sub.created * 1000).toISOString(),
        livemode: sub.livemode,
        plan_id: plan?.id,
        plan_amount: plan?.amount,
        plan_interval: plan?.interval,
      });

      if (error) {
        stats.subscriptions.errors++;
        errors.push(`Subscription ${subscription.id}: ${error.message}`);
      } else {
        stats.subscriptions.inserted++;
      }
    }

    hasMore = subscriptions.has_more;
    if (subscriptions.data.length > 0) {
      startingAfter = subscriptions.data[subscriptions.data.length - 1].id;
    }

    // Rate limiting
    if (hasMore) await sleep(DELAY_BETWEEN_BATCHES);
  }
}

async function computeAllClassifications(supabase: any, stats: any, errors: string[]) {
  // Get all customers with email
  const { data: customers } = await supabase
    .from('stripe_customers')
    .select('id, email')
    .eq('livemode', true)
    .eq('deleted', false)
    .not('email', 'is', null)
    .not('email', 'eq', '');

  if (!customers) return;

  for (const customer of customers) {
    try {
      stats.classifications.computed++;

      // Get charges
      const { data: charges } = await supabase
        .from('stripe_charges')
        .select('*')
        .eq('customer_id', customer.id)
        .eq('livemode', true)
        .order('created_at', { ascending: false });

      // Get subscriptions
      const { data: subscriptions } = await supabase
        .from('stripe_subscriptions')
        .select('*')
        .eq('customer_id', customer.id)
        .eq('livemode', true);

      // Compute classification
      const classification = classifyCustomer(charges || [], subscriptions || []);

      // Calculate stats
      const validCharges = (charges || []).filter((c: any) =>
        c.status === 'succeeded' && c.amount > c.amount_refunded
      );
      const totalSpend = validCharges.reduce((sum: number, c: any) =>
        sum + c.amount - c.amount_refunded, 0
      );

      const activeSubscriptions = (subscriptions || []).filter((s: any) =>
        s.status === 'active' || s.status === 'trialing'
      );

      const { error } = await supabase.from('customer_classifications').upsert({
        email: customer.email.toLowerCase(),
        customer_id: customer.id,
        classification: classification.type,
        briefings_access: classification.briefingsAccess,
        briefings_expiry: classification.briefingsExpiry,
        bundle_tier: classification.bundleTier,
        total_spend: totalSpend,
        charge_count: validCharges.length,
        first_charge_at: validCharges[validCharges.length - 1]?.created_at,
        last_charge_at: validCharges[0]?.created_at,
        has_active_subscription: activeSubscriptions.length > 0,
        subscription_type: classification.subscriptionType,
        products_purchased: extractProductNames(charges || []),
        classified_at: new Date().toISOString(),
        classification_version: 2,
      });

      if (error) {
        stats.classifications.errors++;
        errors.push(`Classification ${customer.email}: ${error.message}`);
      } else {
        stats.classifications.inserted++;
      }
    } catch (err) {
      stats.classifications.errors++;
      errors.push(`Classification ${customer.email}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }
}

function classifyCustomer(charges: any[], subscriptions: any[]) {
  const result = {
    type: 'standalone' as string,
    briefingsAccess: 'none' as string,
    briefingsExpiry: null as string | null,
    bundleTier: null as string | null,
    subscriptionType: null as string | null,
  };

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

  if (validCharges.length > 0) {
    result.type = 'standalone';
  } else {
    result.type = 'free';
  }

  return result;
}

function extractProductNames(charges: any[]): string[] {
  const products = new Set<string>();

  for (const charge of charges) {
    const desc = charge.description || '';
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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
