import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isExcludedFromMetrics } from '@/lib/mindy/campaign-exclusions';

/**
 * GET /api/admin/mrr-goal?password=...
 *
 * The REAL paid-conversion picture for the $100K/mo goal. Reads active recurring
 * subscriptions from stripe_subscriptions (the cache synced from Stripe) and
 * computes:
 *   - activeSubs   → count of status='active' recurring subscriptions
 *   - mrr          → monthly recurring revenue (annual plans normalized /12)
 *   - byPlan       → breakdown by plan_amount (we sell $99 / $149 / $249 etc.)
 *   - goal math    → $100K target, subs-at-$149 needed (671), gap from here
 *
 * NB: this is RECURRING MRR, deliberately separate from the 30-day revenue
 * number (which mixes one-time product sales). No BigQuery.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';
const MONTHLY_GOAL = 100_000;
const PRO_PRICE = 149;

interface SubRow {
  customer_id: string | null;
  status: string | null;
  plan_amount: number | null; // cents (Stripe convention)
  plan_interval?: string | null;
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Debug: dump status distribution + a sample row so we can see why active=0.
    if (request.nextUrl.searchParams.get('debug') === '1') {
      const { data: all, error: dbgErr } = await supabase
        .from('stripe_subscriptions')
        .select('*')
        .range(0, 999);
      if (dbgErr) {
        return NextResponse.json({ debug: true, selectError: dbgErr.message, hint: 'column name mismatch or RLS' });
      }
      if ((all || []).length === 0) {
        return NextResponse.json({ debug: true, note: 'select * returned 0 rows despite count>0 — RLS on SELECT data' });
      }
      // Show the real column names + status values present.
      const cols = Object.keys((all || [])[0] || {});
      const statusKey = cols.find((c) => /status/i.test(c)) || 'status';
      const amtKey = cols.find((c) => /amount/i.test(c)) || 'plan_amount';
      const statusDistFull: Record<string, number> = {};
      for (const r of all || []) {
        const st = String((r as Record<string, unknown>)[statusKey] ?? 'NULL');
        statusDistFull[st] = (statusDistFull[st] || 0) + 1;
      }
      return NextResponse.json({
        debug: true,
        columns: cols,
        statusColumn: statusKey,
        amountColumn: amtKey,
        statusDistribution: statusDistFull,
        sampleRow: (all || [])[0],
      });
    }

    // Pull all active subscriptions (page past the 1000 cap). Stripe's "paying"
    // statuses are active + trialing; past_due is still billing. Be inclusive of
    // the genuinely-paying states, exclude canceled/unpaid/incomplete.
    const PAYING = ['active', 'trialing', 'past_due'];
    const subs: SubRow[] = [];
    for (let from = 0; from < 60000; from += 1000) {
      const { data, error } = await supabase
        .from('stripe_subscriptions')
        .select('customer_id, status, plan_amount, plan_interval')
        .in('status', PAYING)
        .range(from, from + 999);
      if (error) break;
      subs.push(...((data || []) as SubRow[]));
      if (!data || data.length < 1000) break;
    }

    // Exclude comp/advocate/partner subscriptions from MRR. Stripe subs only carry
    // customer_id, so join customer_id → email via stripe_customers, then drop any
    // sub whose email is a special account. (If a partner gets comp Pro via a real
    // Stripe sub, it must not count toward the $100K.)
    const excludedCustomerIds = new Set<string>();
    try {
      const customers: Array<{ id?: string; email?: string }> = [];
      for (let from = 0; from < 60000; from += 1000) {
        const { data, error } = await supabase
          .from('stripe_customers')
          .select('id, email')
          .range(from, from + 999);
        if (error) break;
        customers.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      for (const c of customers) {
        if (c.id && isExcludedFromMetrics(c.email)) excludedCustomerIds.add(c.id);
      }
    } catch { /* customers cache optional — fall back to counting all */ }

    const payingSubs = subs.filter((s) => !(s.customer_id && excludedCustomerIds.has(s.customer_id)));

    // plan_amount is in cents. Annual plans bill once a year → normalize to /12
    // for MRR. We infer annual from the interval field or a large amount.
    const planCounts = new Map<number, number>(); // monthly-dollar price → count
    let mrr = 0;
    for (const s of payingSubs) {
      const cents = s.plan_amount || 0;
      if (cents <= 0) continue;
      const dollars = cents / 100;
      const isAnnual = (s.plan_interval === 'year') || dollars >= 1000; // $1,490/yr etc.
      const monthly = isAnnual ? dollars / 12 : dollars;
      mrr += monthly;
      const bucket = Math.round(monthly);
      planCounts.set(bucket, (planCounts.get(bucket) || 0) + 1);
    }

    const activeSubs = payingSubs.length;
    const arpu = activeSubs > 0 ? mrr / activeSubs : 0;

    const byPlan = [...planCounts.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([price, count]) => ({ monthlyPrice: price, count }));

    // --- One-time / lifetime cash (last 30 days) from stripe_charges ---
    // Lifetime + bundle sales are CASH, not MRR — but they fund the business and
    // convert leads who'd never subscribe monthly. Report them as a separate line
    // so the goal story is honest (MRR is recurring; lifetime is cash-in).
    let oneTimeCash30d = 0;
    let oneTimeCount30d = 0;
    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const charges: Array<{ amount?: number; status?: string; invoice?: string | null; created_at?: string }> = [];
      for (let from = 0; from < 60000; from += 1000) {
        const { data, error } = await supabase
          .from('stripe_charges')
          .select('amount, status, invoice, created_at')
          .gte('created_at', since)
          .range(from, from + 999);
        if (error) break;
        charges.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      for (const c of charges) {
        if (c.status !== 'succeeded') continue;
        // No invoice → one-time charge (subscription renewals carry an invoice id).
        if (c.invoice) continue;
        oneTimeCash30d += (c.amount || 0) / 100;
        oneTimeCount30d++;
      }
    } catch { /* charges table optional */ }

    // --- Upgrade-modal intent (last 30 days) from app_events ---
    // Measures the free→paid funnel's first step: free users clicking a Pro-locked
    // feature (modal shown) and then clicking the Go-Pro CTA. Tells us if the modal
    // converts intent — without this the modal is unmeasured.
    let upgradeModalShown = 0;
    let upgradeModalCtaClicks = 0;
    const upgradeByFeature: Record<string, number> = {};
    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const events: Array<{ metadata?: Record<string, unknown> }> = [];
      for (let from = 0; from < 60000; from += 1000) {
        const { data, error } = await supabase
          .from('app_events')
          .select('metadata')
          .eq('event_type', 'link_click')
          .eq('event_source', 'sidebar')
          .gte('created_at', since)
          .range(from, from + 999);
        if (error) break;
        events.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      for (const e of events) {
        const action = (e.metadata || {}).action;
        const feature = String((e.metadata || {}).feature || 'unknown');
        if (action === 'upgrade_modal_shown') {
          upgradeModalShown++;
          upgradeByFeature[feature] = (upgradeByFeature[feature] || 0) + 1;
        } else if (action === 'upgrade_modal_cta_click') {
          upgradeModalCtaClicks++;
        }
      }
    } catch { /* app_events optional */ }
    const upgradeModalCtr = upgradeModalShown > 0
      ? Math.round((upgradeModalCtaClicks / upgradeModalShown) * 1000) / 10
      : 0;
    const topUpgradeFeatures = Object.entries(upgradeByFeature)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([feature, count]) => ({ feature, count }));

    // --- Upgrade drip sends (last 30 days) from email_provider_sends ---
    let dripSends30d = 0;
    let bootcampOfferSends = 0;
    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const dripTypes = ['upgrade_drip_d1', 'upgrade_drip_d3', 'upgrade_drip_d7', 'upgrade_drip_d14'];
      const { count } = await supabase
        .from('email_provider_sends')
        .select('id', { count: 'exact', head: true })
        .in('email_type', dripTypes)
        .gte('sent_at', since);
      dripSends30d = count || 0;

      // Bootcamp lifetime-offer blast (all-time — it's a one-time campaign).
      const { count: bc } = await supabase
        .from('email_provider_sends')
        .select('id', { count: 'exact', head: true })
        .eq('email_type', 'bootcamp_lifetime_offer');
      bootcampOfferSends = bc || 0;
    } catch { /* optional */ }

    // Goal math (recurring)
    const subsNeededAt149 = Math.ceil(MONTHLY_GOAL / PRO_PRICE);   // 671
    const subsRemainingAt149 = Math.max(0, subsNeededAt149 - activeSubs);
    const mrrGap = Math.max(0, MONTHLY_GOAL - mrr);
    const subsRemainingAtArpu = arpu > 0 ? Math.ceil(mrrGap / arpu) : null;
    const pctToGoal = Math.round((mrr / MONTHLY_GOAL) * 1000) / 10;

    // Lifetime offers — how many lifetime sales equal the $100K/mo goal if we
    // count lifetime cash amortized over 12 months (a common way to value LTV
    // against an MRR target). Tunable price points the team is using.
    const LIFETIME_OFFERS = [
      { name: 'Ultimate Giant Bundle (lifetime)', price: 1497 },
      { name: 'Mindy Lifetime', price: 2997 },
    ];
    const lifetimeScenarios = LIFETIME_OFFERS.map((o) => ({
      ...o,
      // Cash needed to fund one $100K month = the monthly gap; how many sales.
      salesToFundGoalMonth: Math.ceil(MONTHLY_GOAL / o.price),
      // If amortized over 12 months, MRR-equivalent per sale.
      mrrEquivPerSale: Math.round(o.price / 12),
    }));

    return NextResponse.json({
      success: true,
      goal: MONTHLY_GOAL,
      proPrice: PRO_PRICE,
      activeSubs,
      mrr: Math.round(mrr),
      arpu: Math.round(arpu),
      pctToGoal,
      byPlan,
      subsNeededAt149,
      subsRemainingAt149,
      subsRemainingAtArpu,
      mrrGap: Math.round(mrrGap),
      oneTimeCash30d: Math.round(oneTimeCash30d),
      oneTimeCount30d,
      lifetimeScenarios,
      // Free→paid funnel — upgrade-modal intent (last 30 days)
      upgradeModalShown,
      upgradeModalCtaClicks,
      upgradeModalCtr,        // % of modal opens that clicked Go Pro
      topUpgradeFeatures,     // which locked features drive the most intent
      dripSends30d,           // free→paid nurture emails sent (last 30d)
      bootcampOfferSends,     // bootcamp lifetime-offer blast (all-time)
    });
  } catch (err) {
    console.error('[mrr-goal] error', err);
    return NextResponse.json({ success: false, error: 'Failed to compute MRR' }, { status: 500 });
  }
}
