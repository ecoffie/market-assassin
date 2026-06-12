import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/cron/sync-stripe-cache
 *
 * Nightly refresh of the Stripe → Supabase cache that powers the $100K goal
 * chart (active subs + MRR). Runs CUSTOMERS then SUBSCRIPTIONS in order (the FK
 * requires the customer row first). Deliberately SKIPS charges — that's the slow
 * part (~1,200 rows, 4+ min) and the goal chart doesn't need it; the dashboard's
 * 30-day revenue reads charges live from Stripe anyway.
 *
 * Reuses the existing /api/admin/backfill-stripe logic via internal calls so we
 * have ONE sync implementation. Fired by the dispatcher (cron_jobs row) — never
 * a vercel.json cron.
 *
 * Auth: ?password=ADMIN_PASSWORD (the dispatcher forwards the full route + query).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

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
  const pw = encodeURIComponent(ADMIN_PASSWORD);
  const results: Record<string, unknown> = {};

  // 1) Customers first (satisfies the subscriptions FK).
  try {
    const cRes = await fetch(`${base}/api/admin/backfill-stripe?password=${pw}&mode=backfill&type=customers`, {
      cache: 'no-store',
    });
    results.customers = (await cRes.json())?.stats?.customers ?? { error: cRes.status };
  } catch (err) {
    results.customers = { error: err instanceof Error ? err.message : 'failed' };
  }

  // 2) Subscriptions (the data the goal chart needs).
  try {
    const sRes = await fetch(`${base}/api/admin/backfill-stripe?password=${pw}&mode=backfill&type=subscriptions`, {
      cache: 'no-store',
    });
    results.subscriptions = (await sRes.json())?.stats?.subscriptions ?? { error: sRes.status };
  } catch (err) {
    results.subscriptions = { error: err instanceof Error ? err.message : 'failed' };
  }

  return NextResponse.json({ success: true, synced: results });
}
