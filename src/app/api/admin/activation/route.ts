/**
 * Admin: activation dashboard data (activation Phase 1, approved by Eric 2026-11-14). READ-ONLY.
 *
 * GET /api/admin/activation?password=…&days=120
 *   Accounts registered (auth.users) in the last `days` days, staff/comp/advocate/test excluded, split by
 *   product era (early_launch vs stabilized) and experience (native_app, app_and_mcp, mcp_only, email_only,
 *   no_activity). See src/lib/activation/framework.ts for every metric's definition and which ones are proxies.
 *
 * The stabilized era is empty until ACTIVATION_BASELINE_START is set, which happens only after Eric declares
 * "Mindy Stabilization Complete". Early-launch numbers are a diagnostic baseline, not a measurement of the
 * redesigned product, and must not be used to justify pricing or business-model changes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getWriteClient } from '@/lib/supabase/server-clients';
import { activationBaselineStart, buildActivationReport } from '@/lib/activation/framework';
import { loadActivationData } from '@/lib/activation/load';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || searchParams.get('password') !== adminPassword) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '120', 10) || 120, 7), 365);
  const now = new Date();
  const from = new Date(now.getTime() - days * 86_400_000);
  try {
    // Service client: auth.admin.listUsers needs it. Every call below is a SELECT.
    const { accounts, ...sources } = await loadActivationData(getWriteClient(), { from, to: now });
    const report = buildActivationReport(accounts, {
      now, from, to: now, baselineStart: activationBaselineStart(),
      searchMeasuredSince: sources.searchMeasuredSince ? new Date(sources.searchMeasuredSince) : null,
    });
    return NextResponse.json({
      success: true,
      report,
      sources,
      notes: [
        'Every 7-day window is the account\'s first 7×24h from createdAt. Accounts younger than that are not in any 7-day denominator yet (cohort.immature7d).',
        'Accounts whose window overlaps the 2026-08-21 → 2026-09-27T00:42:12Z telemetry outage are left out of engagement-based rates (cohort.telemetryGap*): their numbers would be partial, not low.',
        'Early-launch era = before Mindy Stabilization Complete. A diagnostic baseline only: do not use it for pricing or business-model decisions.',
        'First value, accumulated value and return value are behavioural PROXIES. Relevance and usefulness are not directly measured.',
        'A second-day return is not value and not durable retention.',
        'Pro trial starts cannot be attributed to accounts yet (stripe_subscriptions carries no email); they are not in this report.',
      ],
    });
  } catch (err) {
    // A failed source is an error, never a silently smaller number.
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
