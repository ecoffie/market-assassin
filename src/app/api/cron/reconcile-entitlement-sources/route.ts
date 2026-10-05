/**
 * GET /api/cron/reconcile-entitlement-sources — R2 shadow evidence upkeep (daily).
 *
 *   1. Observe $99 memberships from live Stripe → entitlement_source_observations.
 *   2. Bounded retention: delete entitlement_shadow_log rows older than 30 days.
 *
 * Writes ONLY those two shadow tables. Grants nothing, emails nobody, never writes Stripe,
 * KV or any customer/profile row. Auth: the dispatcher's `Authorization: Bearer $CRON_SECRET`.
 * `?dry=1` previews without writing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { purgeShadowLog, reconcileMembershipObservations } from '@/lib/entitlements/membership-reconciler';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const bearer = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!secret || bearer !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dry = request.nextUrl.searchParams.get('dry') === '1';
  try {
    const plan = await reconcileMembershipObservations({ go: !dry });
    const purged = dry ? null : await purgeShadowLog(30);
    return NextResponse.json({
      success: true,
      dry,
      observed: plan.observed,
      bySourceStatus: plan.bySourceStatus,
      ended: plan.end.length,
      missingEmail: plan.missingEmail,
      wrote: plan.wrote,
      shadowLogPurged: purged,
    });
  } catch (e) {
    // Non-2xx so the dispatcher records a failed run; nothing was written past the failure point.
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'reconcile failed' }, { status: 500 });
  }
}
