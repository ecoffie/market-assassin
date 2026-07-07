/**
 * /api/admin/zero-alert-diagnosis?password=...
 *
 * Read-only breakdown of WHY active-with-NAICS users got zero alert opportunities
 * in the last 7 days (the dashboard's "N configured users had zero alerts" number).
 * Grounded in real alert_log + user_notification_settings — no guessing. Classifies
 * each zero-alert user so we know the real cause before fixing anything:
 *
 *   prefilled  — NAICS is a known default set OR a batch sweep (never user-chosen)
 *   narrow     — real custom NAICS, but matched 0 live opps (thin market)
 *   neverRan   — no alert_log row at all in 7d (cron skipped: frequency/eligibility)
 *   skipped    — had a 'skipped' row with a reason (dedup / no-match / tier)
 *
 * GET only. ?samples=N (default 15) controls how many example emails per bucket.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getReadClient } from '@/lib/supabase/server-clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Pure analytics read (no writes) → read replica, to keep this off the primary.
function sb() {
  return getReadClient();
}

// Same seed detection as the dashboard's tightened "Custom NAICS".
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
  if (url.searchParams.get('password') !== (process.env.ADMIN_PASSWORD)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const sampleN = Math.max(1, Math.min(50, Number(url.searchParams.get('samples') || 15)));
  const supabase = sb();

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString().split('T')[0];

  // Active users with NAICS (the pool the dashboard's zero-alert metric uses).
  const settings = await fetchAll<{ user_email: string; naics_codes: string[] | null }>((from, to) =>
    supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes')
      .eq('alerts_enabled', true)
      .eq('is_active', true)
      .range(from, to),
  );

  // All alert_log rows in the window (any status) so we can tell never-ran from skipped.
  const logs = await fetchAll<{
    user_email: string;
    opportunities_count: number | null;
    delivery_status: string | null;
    error_message: string | null;
  }>((from, to) =>
    supabase
      .from('alert_log')
      .select('user_email, opportunities_count, delivery_status, error_message')
      .gte('alert_date', sevenDaysAgo)
      .range(from, to),
  );

  // Per-user: total opps delivered, whether any row exists, last skip reason.
  const oppByUser = new Map<string, number>();
  const hasRow = new Set<string>();
  const skipReason = new Map<string, string>();
  for (const r of logs) {
    const e = (r.user_email || '').toLowerCase();
    if (!e) continue;
    hasRow.add(e);
    oppByUser.set(e, (oppByUser.get(e) || 0) + (r.opportunities_count || 0));
    if (r.delivery_status === 'skipped' && r.error_message) skipReason.set(e, r.error_message);
  }

  // Shape counts to detect sweeps.
  const shapeCounts = new Map<string, number>();
  for (const u of settings) {
    const c = u.naics_codes || [];
    if (c.length) shapeCounts.set(shapeKey(c), (shapeCounts.get(shapeKey(c)) || 0) + 1);
  }

  const buckets = {
    prefilled: { count: 0, samples: [] as string[] },
    narrow: { count: 0, samples: [] as string[] },
    neverRan: { count: 0, samples: [] as string[] },
    skipped: { count: 0, samples: [] as Array<{ email: string; reason: string }> },
  };
  const skipReasonTally: Record<string, number> = {};

  let totalActiveWithNaics = 0;
  let zeroAlertTotal = 0;

  for (const u of settings) {
    const codes = (u.naics_codes || []).map(String);
    if (codes.length === 0) continue; // mirrors dashboard: only NAICS-having users
    totalActiveWithNaics++;
    const email = (u.user_email || '').toLowerCase();
    if ((oppByUser.get(email) || 0) > 0) continue; // got opps → not a zero-alert user
    zeroAlertTotal++;

    const prefilled =
      isDefaultSet(codes) ||
      codes.length > SWEEP_MAX_HANDPICKED_CODES ||
      (shapeCounts.get(shapeKey(codes)) || 0) >= SWEEP_SHARED_USER_THRESHOLD;

    if (prefilled) {
      buckets.prefilled.count++;
      if (buckets.prefilled.samples.length < sampleN) buckets.prefilled.samples.push(u.user_email);
    } else if (!hasRow.has(email)) {
      buckets.neverRan.count++;
      if (buckets.neverRan.samples.length < sampleN) buckets.neverRan.samples.push(u.user_email);
    } else if (skipReason.has(email)) {
      buckets.skipped.count++;
      const reason = skipReason.get(email)!;
      skipReasonTally[reason] = (skipReasonTally[reason] || 0) + 1;
      if (buckets.skipped.samples.length < sampleN) buckets.skipped.samples.push({ email: u.user_email, reason });
    } else {
      // Real custom NAICS, had a sent row, but 0 opps → genuinely narrow market.
      buckets.narrow.count++;
      if (buckets.narrow.samples.length < sampleN) buckets.narrow.samples.push(u.user_email);
    }
  }

  return NextResponse.json({
    success: true,
    window: `${sevenDaysAgo} → today`,
    totalActiveWithNaics,
    zeroAlertTotal,
    breakdown: {
      prefilled: buckets.prefilled.count,   // fix = re-onboard (real NAICS/keywords)
      narrow: buckets.narrow.count,         // fix = widen NAICS/keywords / source coverage
      neverRan: buckets.neverRan.count,     // fix = cron eligibility / frequency
      skipped: buckets.skipped.count,       // fix = depends on reason (see tally)
    },
    skipReasonTally,
    samples: buckets,
  });
}
