import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
  product_name: string | null;
  status: string | null;
  plan_amount: number | null; // cents (Stripe convention)
  interval?: string | null;
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
      const { data: all } = await supabase
        .from('stripe_subscriptions')
        .select('status, plan_amount, plan_id, product_name')
        .range(0, 999);
      const statusDist: Record<string, number> = {};
      let withAmount = 0;
      for (const r of all || []) {
        const st = (r as { status?: string }).status || 'NULL';
        statusDist[st] = (statusDist[st] || 0) + 1;
        if ((r as { plan_amount?: number }).plan_amount) withAmount++;
      }
      return NextResponse.json({
        debug: true,
        totalRowsSampled: (all || []).length,
        statusDistribution: statusDist,
        rowsWithPlanAmount: withAmount,
        sampleRow: (all || [])[0] || null,
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
        .select('customer_id, product_name, status, plan_amount, interval')
        .in('status', PAYING)
        .range(from, from + 999);
      if (error) break;
      subs.push(...((data || []) as SubRow[]));
      if (!data || data.length < 1000) break;
    }

    // plan_amount is in cents. Annual plans bill once a year → normalize to /12
    // for MRR. We infer annual from the interval field or a large amount.
    const planCounts = new Map<number, number>(); // monthly-dollar price → count
    let mrr = 0;
    for (const s of subs) {
      const cents = s.plan_amount || 0;
      if (cents <= 0) continue;
      const dollars = cents / 100;
      const isAnnual = (s.interval === 'year') || dollars >= 1000; // $1,490/yr etc.
      const monthly = isAnnual ? dollars / 12 : dollars;
      mrr += monthly;
      const bucket = Math.round(monthly);
      planCounts.set(bucket, (planCounts.get(bucket) || 0) + 1);
    }

    const activeSubs = subs.length;
    const arpu = activeSubs > 0 ? mrr / activeSubs : 0;

    const byPlan = [...planCounts.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([price, count]) => ({ monthlyPrice: price, count }));

    // Goal math
    const subsNeededAt149 = Math.ceil(MONTHLY_GOAL / PRO_PRICE);   // 671
    const subsRemainingAt149 = Math.max(0, subsNeededAt149 - activeSubs);
    const mrrGap = Math.max(0, MONTHLY_GOAL - mrr);
    // At the CURRENT blended ARPU, how many more subs to close the gap?
    const subsRemainingAtArpu = arpu > 0 ? Math.ceil(mrrGap / arpu) : null;
    const pctToGoal = Math.round((mrr / MONTHLY_GOAL) * 1000) / 10;

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
    });
  } catch (err) {
    console.error('[mrr-goal] error', err);
    return NextResponse.json({ success: false, error: 'Failed to compute MRR' }, { status: 500 });
  }
}
