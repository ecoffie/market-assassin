import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/cron/sync-stripe-cache
 *
 * Refresh of the Stripe → Supabase cache that powers the $100K goal chart
 * (active subs + MRR). Uses the SUBSCRIPTIONS-FAST path: subscriptions only, no
 * per-page sleep, self-healing the customer FK inline (it upserts a minimal
 * customer row for any subscription whose customer isn't cached yet). This drops
 * the slow full-customers walk (~11 pages × 1s sleep) that was tipping the job
 * over the dispatcher's 290s budget → `last_status: timeout`. ~365 subs ≈ a few
 * seconds now. Charges are still skipped (the dashboard reads 30-day revenue
 * live from Stripe).
 *
 * `?full=1` runs the old customers-then-subscriptions path (a periodic deep sync
 * to catch customers with no active subscription).
 *
 * Reuses /api/admin/backfill-stripe so there's ONE sync implementation. Fired by
 * the dispatcher (cron_jobs row) — never a vercel.json cron.
 *
 * Auth: ?password=ADMIN_PASSWORD (the dispatcher forwards the full route + query).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function internalBaseUrl(request: NextRequest): string {
  // Use the request's own host so server→server calls hit the same deployment
  // (avoids stale NEXT_PUBLIC_BASE_URL → wrong-domain 308 issues).
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('host');
  return `${proto}://${host}`;
}

export async function GET(request: NextRequest) {
  // Accept either the dispatcher's bearer OR an explicit password.
  const password = request.nextUrl.searchParams.get('password');
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  const isDispatch = request.headers.get('x-cron-dispatch') === '1';
  const authed =
    password === ADMIN_PASSWORD ||
    (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) ||
    isDispatch;
  if (!authed) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const base = internalBaseUrl(request);
  const pw = encodeURIComponent(ADMIN_PASSWORD || '');
  const full = request.nextUrl.searchParams.get('full') === '1';
  const results: Record<string, unknown> = {};

  if (full) {
    // Deep sync: customers first (satisfies the FK), then subscriptions. Slower;
    // run occasionally to capture customers without an active subscription.
    try {
      const cRes = await fetch(`${base}/api/admin/backfill-stripe?password=${pw}&mode=backfill&type=customers`, { cache: 'no-store' });
      results.customers = (await cRes.json())?.stats?.customers ?? { error: cRes.status };
    } catch (err) {
      results.customers = { error: err instanceof Error ? err.message : 'failed' };
    }
    try {
      const sRes = await fetch(`${base}/api/admin/backfill-stripe?password=${pw}&mode=backfill&type=subscriptions`, { cache: 'no-store' });
      results.subscriptions = (await sRes.json())?.stats?.subscriptions ?? { error: sRes.status };
    } catch (err) {
      results.subscriptions = { error: err instanceof Error ? err.message : 'failed' };
    }
    return NextResponse.json({ success: true, mode: 'full', synced: results });
  }

  // Default fast path: subscriptions only, FK self-healed inline, no sleeps.
  try {
    const sRes = await fetch(`${base}/api/admin/backfill-stripe?password=${pw}&mode=backfill&type=subscriptions-fast`, { cache: 'no-store' });
    const j = await sRes.json();
    results.subscriptions = j?.stats?.subscriptions ?? { error: sRes.status };
    if (j?.totalErrors) results.errors = j.errors;
  } catch (err) {
    results.subscriptions = { error: err instanceof Error ? err.message : 'failed' };
  }

  return NextResponse.json({ success: true, mode: 'fast', synced: results });
}
