import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { sendMarketIntelligenceWelcomeEmail } from '@/lib/send-email';
import { grantBriefingsAccess } from '@/lib/briefings/access';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion,
});

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function normalizeEmail(email: string) {
  return email.toLowerCase().trim();
}

function isInternalEmail(email: string) {
  const normalized = normalizeEmail(email);
  const domain = normalized.split('@')[1] || '';
  return (domain === 'govcongiants.com' || domain === 'govcongiants.org') &&
    !normalized.includes('healthcheck') &&
    !normalized.includes('+shoptest');
}

function isMarketIntelligencePurchase(productName: string, metadata: Record<string, unknown>, amount: number) {
  const name = productName.toLowerCase();
  const bundle = String(metadata.bundle || '').toLowerCase();
  const tier = String(metadata.tier || '').toLowerCase();

  return Boolean(
    bundle === 'ultimate' ||
    bundle === 'pro' ||
    tier.includes('briefing') ||
    tier.includes('market_intelligence') ||
    name.includes('market intelligence') ||
    name.includes('ultimate giant bundle') ||
    name.includes('pro giant bundle') ||
    (amount >= 149600 && amount <= 149800) ||
    (amount >= 99600 && amount <= 99800)
  );
}

async function findCheckoutSession(charge: Stripe.Charge) {
  const paymentIntentId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id;
  if (!paymentIntentId) return null;

  try {
    const sessions = await stripe.checkout.sessions.list({
      payment_intent: paymentIntentId,
      limit: 1,
      expand: ['data.line_items.data.price.product'],
    } as Stripe.Checkout.SessionListParams);
    return sessions.data[0] || null;
  } catch {
    return null;
  }
}

function getSessionProductName(session: Stripe.Checkout.Session | null) {
  const lineItems = (session as Stripe.Checkout.Session & {
    line_items?: { data?: Array<{ description?: string | null; price?: { product?: string | Stripe.Product | Stripe.DeletedProduct | null } | null }> };
  } | null)?.line_items?.data;
  const line = lineItems?.[0];
  const product = line?.price?.product;
  if (product && typeof product !== 'string' && !('deleted' in product)) return product.name || '';
  return line?.description || '';
}

function getChargeEmail(charge: Stripe.Charge, session: Stripe.Checkout.Session | null) {
  return normalizeEmail(
    session?.customer_email ||
    session?.customer_details?.email ||
    charge.billing_details?.email ||
    charge.receipt_email ||
    ''
  );
}

async function getRecentPurchaserTargets(days: number) {
  const createdGte = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
  const targets = new Map<string, { email: string; name?: string; source: string; productName: string; purchasedAt: string }>();
  let startingAfter: string | undefined;

  while (true) {
    const charges = await stripe.charges.list({
      limit: 100,
      created: { gte: createdGte },
      starting_after: startingAfter,
    });

    for (const charge of charges.data) {
      if (charge.status !== 'succeeded' || charge.refunded || charge.amount <= charge.amount_refunded) continue;

      const session = await findCheckoutSession(charge);
      const metadata = {
        ...(charge.metadata || {}),
        ...(session?.metadata || {}),
      };
      const productName = getSessionProductName(session) ||
        String(metadata.product_name || '') ||
        charge.description ||
        'Stripe purchase';

      if (!isMarketIntelligencePurchase(productName, metadata, charge.amount)) continue;

      const email = getChargeEmail(charge, session);
      if (!email || !email.includes('@')) continue;

      targets.set(email, {
        email,
        name: session?.customer_details?.name || charge.billing_details?.name || undefined,
        source: 'recent_purchase',
        productName,
        purchasedAt: new Date(charge.created * 1000).toISOString(),
      });
    }

    if (!charges.has_more || charges.data.length === 0) break;
    startingAfter = charges.data[charges.data.length - 1].id;
  }

  return [...targets.values()].sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
}

async function getInternalTargets(supabase: ReturnType<typeof getSupabase>) {
  if (!supabase) return [];
  const emails = new Set<string>();

  const [profiles, settings, classifications] = await Promise.all([
    supabase.from('user_profiles').select('email').or('email.ilike.%@govcongiants.com,email.ilike.%@govcongiants.org').limit(500),
    supabase.from('user_notification_settings').select('user_email').or('user_email.ilike.%@govcongiants.com,user_email.ilike.%@govcongiants.org').limit(500),
    supabase.from('customer_classifications').select('email').or('email.ilike.%@govcongiants.com,email.ilike.%@govcongiants.org').limit(500),
  ]);

  for (const row of profiles.data || []) if (row.email && isInternalEmail(row.email)) emails.add(normalizeEmail(row.email));
  for (const row of settings.data || []) if (row.user_email && isInternalEmail(row.user_email)) emails.add(normalizeEmail(row.user_email));
  for (const row of classifications.data || []) if (row.email && isInternalEmail(row.email)) emails.add(normalizeEmail(row.email));

  return [...emails].sort().map(email => ({
    email,
    source: 'internal_user',
    productName: 'Internal Market Intelligence access',
    purchasedAt: '',
  }));
}

async function grantAccessAndSettings(supabase: ReturnType<typeof getSupabase>, email: string) {
  if (!supabase) return;
  const normalized = normalizeEmail(email);

  await supabase.from('user_profiles').upsert({
    email: normalized,
    access_briefings: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'email' });

  await supabase.from('user_notification_settings').upsert({
    user_email: normalized,
    alerts_enabled: true,
    briefings_enabled: true,
    alert_frequency: 'daily',
    is_active: true,
    subscription_status: isInternalEmail(normalized) ? 'internal' : 'beta',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_email' });

  await grantBriefingsAccess(normalized);
}

async function getAlreadySentEmails(supabase: ReturnType<typeof getSupabase>, emails: string[]) {
  const sent = new Set<string>();
  if (!supabase || emails.length === 0) return sent;

  for (let i = 0; i < emails.length; i += 50) {
    const chunk = emails.slice(i, i + 50);
    const { data } = await supabase
      .from('email_provider_sends')
      .select('user_email')
      .in('user_email', chunk)
      .in('email_type', ['market_intelligence_welcome', 'profile_reminder']);
    for (const row of data || []) if (row.user_email) sent.add(normalizeEmail(row.user_email));
  }

  return sent;
}

export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password') || '';
  const mode = request.nextUrl.searchParams.get('mode') || 'preview';
  const audience = request.nextUrl.searchParams.get('audience') || 'recent';
  const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days') || 14), 1), 90);

  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  const body = await request.json().catch(() => ({})) as { emails?: string[] };
  let targets: Array<{ email: string; name?: string; source: string; productName: string; purchasedAt: string }>;

  if (audience === 'internal') {
    targets = await getInternalTargets(supabase);
  } else if (audience === 'emails') {
    targets = (body.emails || [])
      .map(normalizeEmail)
      .filter(email => email.includes('@'))
      .map(email => ({ email, source: 'manual', productName: 'Market Intelligence access', purchasedAt: '' }));
  } else {
    targets = await getRecentPurchaserTargets(days);
  }

  const uniqueTargets = [...new Map(targets.map(target => [normalizeEmail(target.email), target])).values()];
  const alreadySent = await getAlreadySentEmails(supabase, uniqueTargets.map(target => normalizeEmail(target.email)));
  const needsEmail = uniqueTargets.filter(target => !alreadySent.has(normalizeEmail(target.email)));

  if (mode === 'preview') {
    return NextResponse.json({
      success: true,
      mode,
      audience,
      days,
      summary: {
        targets: uniqueTargets.length,
        alreadySent: alreadySent.size,
        wouldSend: needsEmail.length,
      },
      targets: uniqueTargets,
      wouldSend: needsEmail,
    });
  }

  if (!['send', 'execute'].includes(mode)) {
    return NextResponse.json({ success: false, error: 'Invalid mode' }, { status: 400 });
  }

  const results: Array<{ email: string; status: 'sent' | 'failed'; error?: string }> = [];

  for (const target of needsEmail) {
    try {
      await grantAccessAndSettings(supabase, target.email);
      await sendMarketIntelligenceWelcomeEmail({
        to: target.email,
        customerName: target.name,
      });
      await kv.set(`admin:mi-onboarding:last-sent:${normalizeEmail(target.email)}`, new Date().toISOString(), {
        ex: 30 * 24 * 60 * 60,
      });
      results.push({ email: target.email, status: 'sent' });
    } catch (error) {
      results.push({
        email: target.email,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return NextResponse.json({
    success: true,
    mode,
    audience,
    days,
    summary: {
      targets: uniqueTargets.length,
      skippedAlreadySent: alreadySent.size,
      processed: needsEmail.length,
      sent: results.filter(result => result.status === 'sent').length,
      failed: results.filter(result => result.status === 'failed').length,
    },
    results,
  });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
