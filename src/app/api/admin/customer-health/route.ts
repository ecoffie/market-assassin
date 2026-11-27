/**
 * GET /api/admin/customer-health?password=…   READ-ONLY.
 *
 * One health status per paying customer (see src/lib/customer-health/health.ts for the rules),
 * most urgent first, so the team can reach out before a customer leaves. Never contacts anyone.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { checkAdminRateLimit, getClientIP } from '@/lib/rate-limit';
import { getReadClient } from '@/lib/supabase/server-clients';
import { classifyCustomer, QUIET_DAYS, sortForOutreach, summarize } from '@/lib/customer-health/health';
import { loadCustomerHealthData } from '@/lib/customer-health/load';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const rl = await checkAdminRateLimit(getClientIP(request));
  if (!rl.allowed) return NextResponse.json({ success: false, message: 'Too many requests' }, { status: 429 });
  if (!verifyAdminPassword(request.nextUrl.searchParams.get('password'))) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const loaded = await loadCustomerHealthData(getReadClient(), now);
    const rows = sortForOutreach(loaded.customers.map((c) => classifyCustomer(c, now)));
    return NextResponse.json({
      success: true,
      message: 'ok',
      data: {
        generatedAt: now.toISOString(),
        stripeCacheUpdatedAt: loaded.stripeCacheUpdatedAt,
        quietDays: QUIET_DAYS,
        summary: summarize(rows),
        subscriptionsWithoutEmail: loaded.subscriptionsWithoutEmail,
        excludedAccounts: loaded.excludedAccounts,
        customers: rows,
      },
    });
  } catch (err) {
    console.error('[customer-health]', err);
    return NextResponse.json({ success: false, message: (err as Error).message }, { status: 500 });
  }
}
