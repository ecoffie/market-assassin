import { NextRequest, NextResponse } from 'next/server';
import { syncChargesIncremental } from '@/lib/stripe/charge-sync';

/**
 * GET /api/cron/sync-stripe-cache
 *
 * Refresh of the Stripe → Supabase cache that powers the $100K goal chart
 * (active subs + MRR). Uses the SUBSCRIPTIONS-FAST path: subscriptions only, no
 * per-page sleep, self-healing the customer FK inline (it upserts a minimal
 * customer row for any subscription whose customer isn't cached yet). This drops
 * the slow full-customers walk (~11 pages × 1s sleep) that was tipping the job
 * over the dispatcher's 290s budget → `last_status: timeout`. ~365 subs ≈ a few
 * seconds now.
 *
 * Charges sync here too, incrementally (src/lib/stripe/charge-sync.ts): skipping them froze
 * stripe_charges at 2026-06-11 while mrr-goal, list-purchases and classify-customers-v2 kept
 * reading it. They run under CHARGE_DEADLINE_MS so they cannot push the job back over budget.
 * Either half failing returns non-2xx, because the dispatcher only sees the status code.
 * Running out of budget while still advancing is progress, not failure: the next run continues
 * from the watermark. Running out with nothing written is a failure, or it would never recover.
 *
 * `?full=1` runs the old customers-then-subscriptions path (a periodic deep sync
 * to catch customers with no active subscription).
 *
 * RECONCILIATION ONLY for stripe_subscriptions: the webhook and pooled-org provisioning
 * mirror a subscription immediately (src/lib/stripe/subscription-mirror.ts). A new pooled
 * subscription must never depend on this daily run to become usable.
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
/** Measured from the start of the request; the dispatcher's budget is ~290s. */
const CHARGE_DEADLINE_MS = 200_000;

function internalBaseUrl(request: NextRequest): string {
  // Use the request's own host so server→server calls hit the same deployment
  // (avoids stale NEXT_PUBLIC_BASE_URL → wrong-domain 308 issues).
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('host');
  return `${proto}://${host}`;
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
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

  // Default fast path: subscriptions (FK self-healed inline, no sleeps), then charges.
  const failures: string[] = [];
  try {
    const sRes = await fetch(`${base}/api/admin/backfill-stripe?password=${pw}&mode=backfill&type=subscriptions-fast`, { cache: 'no-store' });
    const j = await sRes.json();
    results.subscriptions = j?.stats?.subscriptions ?? { error: sRes.status };
    if (j?.totalErrors) results.errors = j.errors;
    if (!sRes.ok || j?.success === false || j?.totalErrors) {
      failures.push(`subscriptions: ${j?.totalErrors ? `${j.totalErrors} errors` : `HTTP ${sRes.status}`}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed';
    results.subscriptions = { error: message };
    failures.push(`subscriptions: ${message}`);
  }

  // Runs even when subscriptions failed: the two are independent.
  const charges = await syncChargesIncremental({ deadlineMs: startedAt + CHARGE_DEADLINE_MS });
  results.charges = charges;
  if (!charges.ok) {
    failures.push(`charges: ${charges.error ?? charges.reason}`);
  } else if (!charges.complete && charges.upserted === 0) {
    failures.push(`charges: ${charges.reason} with no progress`);
  }

  return NextResponse.json(
    { success: failures.length === 0, mode: 'fast', synced: results, ...(failures.length ? { failures } : {}) },
    { status: failures.length ? 500 : 200 },
  );
}
