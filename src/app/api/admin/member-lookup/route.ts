/**
 * Member Lookup — case-by-case inquiry tool for the Command Center.
 *
 * GET /api/admin/member-lookup?password=...&email=...
 *
 * For ONE email, returns (all read-only):
 *  - lifetime paid, verified LIVE against Stripe (never the stale mirror)
 *  - current access (app Pro entitlement + briefing eligibility + tier/expiry)
 *  - known-account flags (advocate / comp / internal / test)
 *  - a recommended Founders offer (auto-grant / credit / alumni / comp) based on
 *    what they actually paid
 *
 * Built for inbound inquiries from old lifetime members asking about Mindy: staff
 * type the email, see what they paid + what to offer, and decide case-by-case.
 * NO writes — surfacing only.
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { isAdvocateAccount } from '@/lib/mindy/advocate-accounts';

export const dynamic = 'force-dynamic';

const FOUNDERS_PRICE = 2997;
const ENTITLED_TIERS = new Set(['lifetime', '1_year', '6_month', 'subscription', 'beta_preview']);
// Owning the Ultimate Giant bundle is the MINIMUM requirement for permanent tool
// access — past buyers still had to buy it regardless of other spend (Eric, 2026-06-29).
const ULTIMATE_BUNDLE_VALUES = new Set(['ultimate', 'ultimate-govcon-bundle', 'complete']);
const COMP_TESTIMONIAL = new Set([
  'aj@cypherintel.com', 'pa.joof@pjaygroup.com', 'dare2dreaminc615@gmail.com',
  'olga@olaexecutiveconsulting.com', 'tavinalford@gmail.com',
]);

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function isInternal(email: string) {
  return (email.split('@')[1] || '') === 'govcongiants.com';
}
function isTest(email: string) {
  const d = email.split('@')[1] || '';
  return email.includes('healthcheck') || d.endsWith('.govcongiants.com') || d.endsWith('.govcongiants.org')
    || d === 'govcongiants.test' || /(^|[^a-z])test/.test(email) || email === 'coffietest@gmail.com';
}

/** Sum a customer's real, live, non-refunded paid charges. */
async function stripeLifetimePaid(stripe: Stripe, email: string) {
  let totalCents = 0;
  let chargeCount = 0;
  let last: number | null = null;
  const products = new Set<string>();
  const customers = await stripe.customers.list({ email: email.toLowerCase(), limit: 100 });
  for (const c of customers.data) {
    let startingAfter: string | undefined;
    do {
      const charges: Stripe.ApiList<Stripe.Charge> = await stripe.charges.list({
        customer: c.id, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const x of charges.data) {
        if (x.status === 'succeeded' && x.paid && !x.refunded && (x.amount_refunded || 0) === 0 && x.livemode !== false && x.amount > 0) {
          totalCents += x.amount;
          chargeCount++;
          if (x.description) products.add(x.description);
          if (!last || x.created > last) last = x.created;
        }
      }
      startingAfter = charges.has_more ? charges.data[charges.data.length - 1].id : undefined;
    } while (startingAfter);
  }
  return {
    lifetimeUsd: Math.round(totalCents / 100),
    chargeCount,
    lastCharge: last ? new Date(last * 1000).toISOString().slice(0, 10) : null,
    products: [...products].slice(0, 8),
    stripeCustomers: customers.data.length,
  };
}

function recommendedOffer(paidUsd: number, flags: { advocate: boolean; comp: boolean; internal: boolean; test: boolean }) {
  if (flags.internal || flags.test) return { tier: 'internal_test', label: 'Internal / test account', action: 'Not a customer — no offer' };
  if (flags.advocate) return { tier: 'advocate', label: 'Advocate (intentional comp)', action: 'Keep complimentary Pro' };
  if (flags.comp) return { tier: 'comp', label: 'Comp / testimonial', action: 'Keep complimentary' };
  if (paidUsd >= FOUNDERS_PRICE) return { tier: 'paid_founders', label: `Paid $${paidUsd.toLocaleString()} (≥ Founders)`, action: 'Already paid Founders-equivalent — grant Founders lifetime on request' };
  if (paidUsd >= 500) return { tier: 'credit', label: `Paid $${paidUsd.toLocaleString()}`, action: `Credit $${paidUsd.toLocaleString()} toward Founders ($2,997 / $4,997)` };
  if (paidUsd >= 1) return { tier: 'alumni', label: `Paid $${paidUsd.toLocaleString()}`, action: 'Offer alumni rate $2,997' };
  return { tier: 'comp_zero', label: 'No payment found in live Stripe', action: 'Comp — decide case-by-case (verify before granting)' };
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  if (!verifyAdminPassword(sp.get('password'))) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }
  const email = (sp.get('email') || '').toLowerCase().trim();
  if (!email || !email.includes('@')) {
    return NextResponse.json({ success: false, message: 'Provide a valid ?email=' }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ success: false, message: 'Supabase not configured' }, { status: 500 });
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return NextResponse.json({ success: false, message: 'Stripe not configured' }, { status: 500 });
  const stripe = new Stripe(stripeKey);

  try {
    const [paid, profileRes, classRes, settingsRes, purchasesRes] = await Promise.all([
      stripeLifetimePaid(stripe, email),
      supabase.from('user_profiles').select('company_name, access_briefings, briefings_expires_at').eq('email', email).maybeSingle(),
      supabase.from('customer_classifications').select('classification, briefings_access, briefings_expiry, classification_version').eq('email', email),
      supabase.from('user_notification_settings').select('is_active, briefings_enabled, created_at, invitation_source, trial_source').eq('user_email', email).maybeSingle(),
      supabase.from('purchases').select('bundle, product_name').eq('user_email', email),
    ]);

    const profile = (profileRes.data || {}) as { company_name?: string | null; access_briefings?: boolean | null; briefings_expires_at?: string | null };
    const settings = (settingsRes.data || {}) as { is_active?: boolean | null; briefings_enabled?: boolean | null; created_at?: string | null; invitation_source?: string | null; trial_source?: string | null };
    // latest classification row
    const classRows = (classRes.data || []) as Array<{ classification: string; briefings_access: string; briefings_expiry: string | null; classification_version: number | null }>;
    const latest = classRows.sort((a, b) => Number(b.classification_version || 0) - Number(a.classification_version || 0))[0] || null;

    const now = Date.now();
    const appExpiry = profile.briefings_expires_at as string | null | undefined;
    const appPro = !!profile.access_briefings && (!appExpiry || new Date(appExpiry).getTime() >= now);
    const appProSource = !profile.access_briefings ? 'none' : (!appExpiry ? 'lifetime' : (new Date(appExpiry).getTime() >= now ? 'expiring' : 'expired'));

    const tier = latest?.briefings_access || null;
    const entitledUnexpired = !!tier && ENTITLED_TIERS.has(tier) && !(latest?.briefings_expiry && new Date(latest.briefings_expiry).getTime() <= now);
    const briefingEligible = !!settings.is_active && !!settings.briefings_enabled && entitledUnexpired;

    // Ultimate Giant ownership — the minimum requirement for permanent tool access,
    // shown ALONGSIDE spend (does NOT change the offer logic). Detected from the
    // purchases ledger, the classifier, or an Ultimate-named Stripe charge.
    const purchases = (purchasesRes.data || []) as Array<{ bundle: string | null; product_name: string | null }>;
    const ultimateSignals: string[] = [];
    if (purchases.some((p) => ULTIMATE_BUNDLE_VALUES.has((p.bundle || '').toLowerCase()))) ultimateSignals.push('purchases.bundle');
    if (purchases.some((p) => /ultimate/i.test(p.product_name || ''))) ultimateSignals.push('purchase product name');
    if (latest?.classification === 'ultimate_giant') ultimateSignals.push('classification: ultimate_giant');
    if (paid.products.some((d) => /ultimate/i.test(d))) ultimateSignals.push('Stripe charge: "Ultimate"');
    const ownsUltimate = ultimateSignals.length > 0;

    const flags = {
      advocate: isAdvocateAccount(email),
      comp: COMP_TESTIMONIAL.has(email),
      internal: isInternal(email),
      test: isTest(email),
    };
    const offer = recommendedOffer(paid.lifetimeUsd, flags);

    return NextResponse.json({
      success: true,
      email,
      found: classRows.length > 0 || !!settingsRes.data || !!profileRes.data || paid.stripeCustomers > 0,
      company: (profile.company_name as string) || null,
      paid,
      // Minimum requirement for permanent tools (shown next to spend; not a gate on the offer).
      ultimateGiant: { owns: ownsUltimate, signals: ultimateSignals },
      access: {
        appPro, appProSource, briefingsExpiry: appExpiry || null,
        briefingEligible, entitlementTier: tier, classification: latest?.classification || null,
        isActive: !!settings.is_active, briefingsEnabled: !!settings.briefings_enabled,
      },
      account: {
        invitationSource: settings.invitation_source || null,
        trialSource: settings.trial_source || null,
        joined: settings.created_at ? String(settings.created_at).slice(0, 10) : null,
      },
      flags,
      offer,
    });
  } catch (e) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'Lookup failed' }, { status: 500 });
  }
}
