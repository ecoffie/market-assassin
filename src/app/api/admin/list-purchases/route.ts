import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { checkAdminRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getAdminClient() {
  if (!supabaseUrl || !supabaseServiceKey) {
    return null;
  }
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });
}

type AdminPurchase = {
  id: string;
  email: string;
  product_id: string;
  product_name: string;
  tier: string;
  amount: number | null;
  currency: string;
  status: string;
  purchased_at: string;
  stripe_customer_id: string | null;
  bundle: string | null;
  metadata: Record<string, unknown> | null;
  source: 'stripe' | 'stripe_cache' | 'supabase';
};

type StripeChargeCacheRow = {
  id: string;
  customer_id: string | null;
  amount: number;
  currency: string | null;
  status: string;
  description: string | null;
  receipt_email: string | null;
  invoice_id: string | null;
  payment_intent_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  refunded: boolean | null;
  amount_refunded: number | null;
  stripe_customers?: {
    email: string | null;
    name: string | null;
  } | null;
};

type CheckoutSessionSummary = {
  id: string;
  paymentIntentId: string | null;
  productName: string;
  productId: string;
  bundle: string | null;
  metadata: Record<string, string>;
};

function stripeProductName(product: string | Stripe.Product | Stripe.DeletedProduct | null | undefined): string | null {
  if (!product || typeof product === 'string') return null;
  return 'name' in product ? product.name : null;
}

function stripeProductId(product: string | Stripe.Product | Stripe.DeletedProduct | null | undefined): string | null {
  if (!product) return null;
  return typeof product === 'string' ? product : product.id;
}

function stripeCustomerEmail(customer: Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!customer) return null;
  return 'email' in customer ? customer.email : null;
}

function classifyProduct(productName: string, metadata: Record<string, unknown> | null): string {
  const name = productName.toLowerCase();
  const tier = String(metadata?.tier || metadata?.bundle || '').toLowerCase();

  if (name.includes('ai tools')) return 'ai_tools';
  if (name.includes('opportunity hunter') || tier.includes('hunter')) return 'hunter_pro';
  if (name.includes('ultimate')) return 'ultimate_giant';
  if (name.includes('pro giant')) return 'pro_giant';
  if (name.includes('market assassin')) return 'market_assassin';
  if (name.includes('market intelligence')) return 'market_intelligence';
  if (name.includes('alert pro')) return 'alert_pro';
  if (name.includes('product supplier')) return 'product_supplier';
  if (name.includes('coaching')) return 'coaching';
  if (name.includes('content') || name.includes('reaper')) return 'content_generator';
  if (name.includes('recompete')) return 'recompete';
  if (name.includes('contractor database')) return 'contractor_database';
  if (name.includes('briefing')) return 'briefings';
  if (
    name.includes('member') ||
    name.includes('membership') ||
    name.includes('monthly') ||
    name.includes('installment') ||
    name.includes('plan')
  ) return 'membership';
  if (name.includes('subscription')) return 'subscription';
  return 'other';
}

function cachedProductName(row: StripeChargeCacheRow): string {
  const metadata = row.metadata || {};
  return String(
    metadata.product_name ||
    metadata.memberpress_product ||
    metadata.product ||
    metadata.product_title ||
    metadata.bundle ||
    metadata.tier ||
    row.description ||
    'Stripe payment'
  );
}

async function fetchCachedStripePurchases(supabase: any, days: number): Promise<AdminPurchase[]> {
  const createdGte = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('stripe_charges')
    .select(`
      id,
      customer_id,
      amount,
      currency,
      status,
      description,
      receipt_email,
      invoice_id,
      payment_intent_id,
      metadata,
      created_at,
      refunded,
      amount_refunded,
      stripe_customers (
        email,
        name
      )
    `)
    .gte('created_at', createdGte)
    .eq('livemode', true)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    console.warn('Stripe cache lookup failed:', error);
    return [];
  }

  return ((data || []) as StripeChargeCacheRow[])
    .filter((row) => row.status === 'succeeded' && row.amount > (row.amount_refunded || 0))
    .map((row) => {
      const metadata = row.metadata || {};
      const productName = cachedProductName(row);

      return {
        id: row.id,
        email: (
          row.receipt_email ||
          row.stripe_customers?.email ||
          String(metadata.email || '')
        ).toLowerCase(),
        product_id: String(metadata.product_id || metadata.price_id || row.invoice_id || ''),
        product_name: productName,
        tier: classifyProduct(productName, metadata),
        amount: (row.amount - (row.amount_refunded || 0)) / 100,
        currency: row.currency || 'usd',
        status: row.refunded ? 'refunded' : row.status,
        purchased_at: row.created_at,
        stripe_customer_id: row.customer_id,
        bundle: String(metadata.bundle || '') || null,
        metadata: {
          ...metadata,
          invoice_id: row.invoice_id,
          payment_intent: row.payment_intent_id,
        },
        source: 'stripe_cache',
      };
    });
}

async function fetchStripePurchases(days: number): Promise<AdminPurchase[]> {
  if (!process.env.STRIPE_SECRET_KEY) return [];

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion,
  });
  const createdGte = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
  const sessionsByPaymentIntent = new Map<string, CheckoutSessionSummary>();
  const productNameCache = new Map<string, string>();

  const resolveProductName = async (
    product: string | Stripe.Product | Stripe.DeletedProduct | null | undefined
  ): Promise<string | null> => {
    const expandedName = stripeProductName(product);
    if (expandedName) return expandedName;
    if (!product || typeof product !== 'string') return null;
    if (productNameCache.has(product)) return productNameCache.get(product) || null;

    try {
      const resolved = await stripe.products.retrieve(product);
      const name = 'name' in resolved ? resolved.name : null;
      if (name) productNameCache.set(product, name);
      return name;
    } catch {
      return null;
    }
  };

  let sessionStartingAfter: string | undefined;
  for (let page = 0; page < 1; page++) {
    const sessions = await stripe.checkout.sessions.list({
      limit: 100,
      ...(sessionStartingAfter ? { starting_after: sessionStartingAfter } : {}),
      created: { gte: createdGte },
      expand: ['data.line_items'],
    });

    for (const session of sessions.data) {
      const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id || null;
      if (!paymentIntentId) continue;

      const lineItems = session.line_items?.data || [];
      const productNames = lineItems
        .map((item) => item.description || stripeProductName(item.price?.product))
        .filter(Boolean) as string[];
      const productIds = lineItems
        .map((item) => stripeProductId(item.price?.product))
        .filter(Boolean) as string[];

      sessionsByPaymentIntent.set(paymentIntentId, {
        id: session.id,
        paymentIntentId,
        productName: productNames.join(', ') || 'Checkout payment',
        productId: productIds.join(', ') || '',
        bundle: session.metadata?.bundle || null,
        metadata: session.metadata || {},
      });
    }

    if (!sessions.has_more || sessions.data.length === 0) break;
    sessionStartingAfter = sessions.data[sessions.data.length - 1].id;
  }

  const purchases: AdminPurchase[] = [];
  let chargeStartingAfter: string | undefined;

  for (let page = 0; page < 1; page++) {
    const charges = await stripe.charges.list({
      limit: 100,
      ...(chargeStartingAfter ? { starting_after: chargeStartingAfter } : {}),
      created: { gte: createdGte },
      expand: ['data.customer', 'data.invoice', 'data.invoice.subscription'],
    });

    for (const charge of charges.data) {
      if (charge.status !== 'succeeded') continue;

      const expandedCharge = charge as Stripe.Charge & {
        invoice?: string | (Stripe.Invoice & {
          subscription?: string | (Stripe.Subscription & {
            items?: { data?: Array<{ price?: Stripe.Price }> };
          }) | null;
        }) | null;
        payment_intent?: string | { id?: string } | null;
      };
      const paymentIntentId = typeof expandedCharge.payment_intent === 'string'
        ? expandedCharge.payment_intent
        : expandedCharge.payment_intent?.id || null;
      const session = paymentIntentId ? sessionsByPaymentIntent.get(paymentIntentId) : null;
      const customer = typeof expandedCharge.customer === 'object' ? expandedCharge.customer : null;
      const invoice = typeof expandedCharge.invoice === 'object' ? expandedCharge.invoice : null;
      const subscription = invoice && typeof invoice.subscription === 'object' ? invoice.subscription : null;
      const price = subscription?.items?.data?.[0]?.price;
      const productId =
        session?.productId ||
        String(price?.product || '') ||
        String(charge.metadata?.product_id || '');
      const resolvedProductName = await resolveProductName(price?.product || productId);

      const productName =
        session?.productName ||
        charge.metadata?.product_name ||
        charge.metadata?.memberpress_product ||
        price?.nickname ||
        resolvedProductName ||
        charge.description ||
        'Subscription';
      const metadata: Record<string, unknown> = {
        ...(charge.metadata || {}),
        ...(session?.metadata || {}),
        checkout_session_id: session?.id,
        payment_intent: paymentIntentId,
      };

      purchases.push({
        id: session?.id || charge.id,
        email: (
          charge.billing_details?.email ||
          charge.receipt_email ||
          invoice?.customer_email ||
          stripeCustomerEmail(customer) ||
          ''
        ).toLowerCase(),
        product_id: productId,
        product_name: productName,
        tier: classifyProduct(productName, metadata),
        amount: charge.amount / 100,
        currency: charge.currency || 'usd',
        status: charge.refunded ? 'refunded' : charge.status,
        purchased_at: new Date(charge.created * 1000).toISOString(),
        stripe_customer_id: typeof charge.customer === 'string' ? charge.customer : customer?.id || null,
        bundle: session?.bundle || String(metadata.bundle || '') || null,
        metadata,
        source: 'stripe',
      });
    }

    if (!charges.has_more || charges.data.length === 0) break;
    chargeStartingAfter = charges.data[charges.data.length - 1].id;
  }

  return purchases.sort((a, b) => new Date(b.purchased_at).getTime() - new Date(a.purchased_at).getTime());
}

export async function GET(request: NextRequest) {
  const ip = getClientIP(request);
  const rl = await checkAdminRateLimit(ip);
  if (!rl.allowed) return rateLimitResponse(rl);

  const password = request.headers.get('x-admin-password');
  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days') || 365), 1), 3650);

  try {
    const supabase = getAdminClient();
    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const live = request.nextUrl.searchParams.get('live') === 'true';
    if (live) {
      const stripePurchases = await fetchStripePurchases(days);
      return NextResponse.json({
        purchases: stripePurchases,
        source: 'stripe',
        days,
      });
    }

    const cachedStripePurchases = await fetchCachedStripePurchases(supabase, days);
    if (cachedStripePurchases.length > 0) {
      return NextResponse.json({
        purchases: cachedStripePurchases,
        source: 'stripe_cache',
        days,
      });
    }

    const { data, error } = await supabase
      .from('purchases')
      .select('*')
      .order('purchased_at', { ascending: false })
      .limit(500);

    if (error) {
      console.error('Error fetching purchases:', error);
      return NextResponse.json({ error: 'Failed to fetch purchases' }, { status: 500 });
    }

    return NextResponse.json({
      purchases: (data || []).map((row) => ({ ...row, source: 'supabase' })),
      source: 'supabase',
      days,
    });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
