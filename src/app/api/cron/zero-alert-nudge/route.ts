/**
 * /api/cron/zero-alert-nudge
 *
 * Sends a SHARP, zero-alert-specific re-onboarding nudge to users who get NOTHING
 * because their profile is on placeholder/sweep NAICS (the 88% root cause from the
 * zero-alert diagnosis). Different message than the generic setup invite — it names
 * the reason ("your alerts are empty because your codes are placeholders").
 *
 * Targets: active + alerts-enabled users WITH NAICS who got 0 opportunities in the
 * last 7 days AND whose NAICS is prefilled (default set or batch sweep — never
 * user-chosen). Dedups against anyone already nudged OR setup-invited in the last
 * 14 days (don't double-email the funnel). Resumable, throttled, preview-default.
 * Dispatcher-fired (cron_jobs row), NOT a vercel.json cron.
 *
 *   GET (no mode)     → preview: cohort size + sample (no sends)
 *   GET ?mode=execute → send up to ?limit (default 50)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendZeroAlertNudge } from '@/lib/mindy/account-setup';
import { isCampaignExcludedEmail } from '@/lib/mindy/campaign-exclusions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Same seed detection as the diagnosis + dashboard.
const DEFAULT_NAICS_SET = new Set(['541512', '541611', '541330', '541990', '561210']);
const HEALTHCARE_DEFAULT_SET = new Set([
  '621111', '621210', '621511', '621610', '622110', '622310', '623110', '623312', '624120',
]);
const SWEEP_SHARED_USER_THRESHOLD = 5;
const SWEEP_MAX_HANDPICKED_CODES = 20;

function shapeKey(codes: string[]): string {
  return [...new Set(codes.map(String))].sort().join(',');
}
function isDefaultSet(codes: string[]): boolean {
  if (!codes.length) return false;
  const all = (s: Set<string>) => codes.every((c) => s.has(String(c)));
  return all(DEFAULT_NAICS_SET) || all(HEALTHCARE_DEFAULT_SET);
}

async function fetchAll<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data } = await q(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const execute = url.searchParams.get('mode') === 'execute';
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 50)));
  const supabase = sb();

  // QA: ?test=email&password=... sends ONE nudge to that address (verify the email
  // before the real batch). Password-gated so it can't be abused.
  const testEmail = url.searchParams.get('test');
  if (testEmail) {
    const pw = url.searchParams.get('password');
    if (pw !== (process.env.ADMIN_PASSWORD || 'galata-assassin-2026')) {
      return NextResponse.json({ error: 'test requires admin password' }, { status: 401 });
    }
    try {
      const r = await sendZeroAlertNudge(testEmail.toLowerCase().trim());
      return NextResponse.json({ success: true, mode: 'test', to: testEmail, linkType: r.linkType });
    } catch (err) {
      return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'send failed' }, { status: 500 });
    }
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString().split('T')[0];
  const fourteenDaysAgoIso = new Date(Date.now() - 14 * 86400_000).toISOString();

  // Active + alerts-enabled users with NAICS (the eligible pool).
  const settings = await fetchAll<{ user_email: string; naics_codes: string[] | null }>((from, to) =>
    supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes')
      .eq('alerts_enabled', true)
      .eq('is_active', true)
      .range(from, to),
  );

  // Opps delivered per user in the last 7d (sent rows).
  const logs = await fetchAll<{ user_email: string; opportunities_count: number | null }>((from, to) =>
    supabase
      .from('alert_log')
      .select('user_email, opportunities_count')
      .gte('alert_date', sevenDaysAgo)
      .eq('delivery_status', 'sent')
      .range(from, to),
  );
  const oppByUser = new Map<string, number>();
  for (const r of logs) {
    const e = (r.user_email || '').toLowerCase();
    oppByUser.set(e, (oppByUser.get(e) || 0) + (r.opportunities_count || 0));
  }

  // Already nudged or setup-invited in the last 14d → skip (don't double-email).
  let recentlyTouched = new Set<string>();
  try {
    const sends = await fetchAll<{ user_email: string }>((from, to) =>
      supabase
        .from('email_provider_sends')
        .select('user_email, email_type, sent_at')
        .in('email_type', ['zero_alert_nudge', 'mi_account_setup'])
        .gte('sent_at', fourteenDaysAgoIso)
        .range(from, to),
    );
    recentlyTouched = new Set(sends.map((s) => (s.user_email || '').toLowerCase()).filter(Boolean));
  } catch { /* table/column variance — treat as none */ }

  // Shape counts to detect sweeps.
  const shapeCounts = new Map<string, number>();
  for (const u of settings) {
    const c = u.naics_codes || [];
    if (c.length) shapeCounts.set(shapeKey(c), (shapeCounts.get(shapeKey(c)) || 0) + 1);
  }

  // Build the target queue: zero-alert AND prefilled NAICS AND not recently touched.
  const queue: string[] = [];
  for (const u of settings) {
    const email = (u.user_email || '').toLowerCase();
    const codes = (u.naics_codes || []).map(String);
    if (codes.length === 0) continue;
    if ((oppByUser.get(email) || 0) > 0) continue;       // got opps → not zero-alert
    const prefilled =
      isDefaultSet(codes) ||
      codes.length > SWEEP_MAX_HANDPICKED_CODES ||
      (shapeCounts.get(shapeKey(codes)) || 0) >= SWEEP_SHARED_USER_THRESHOLD;
    if (!prefilled) continue;                              // real codes → not our target
    if (recentlyTouched.has(email)) continue;             // already in the funnel
    if (isCampaignExcludedEmail(email)) continue;
    queue.push(email);
  }
  queue.sort();
  const slice = queue.slice(0, limit);

  if (!execute) {
    return NextResponse.json({
      success: true,
      mode: 'preview',
      eligibleZeroAlertPrefilled: queue.length,
      skippedRecentlyTouched: recentlyTouched.size,
      wouldSendThisRun: slice.length,
      limit,
      sample: slice.slice(0, 15),
    });
  }

  let sent = 0;
  const failures: Array<{ email: string; error: string }> = [];
  for (const email of slice) {
    try {
      await sendZeroAlertNudge(email);
      sent++;
    } catch (err) {
      failures.push({ email, error: err instanceof Error ? err.message : 'send failed' });
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  return NextResponse.json({
    success: true,
    mode: 'execute',
    sent,
    failed: failures.length,
    remainingAfter: Math.max(0, queue.length - sent),
    failures: failures.slice(0, 20),
  });
}
