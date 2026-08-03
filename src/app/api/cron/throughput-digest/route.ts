/**
 * Throughput Digest — "did the pipelines produce NORMAL VOLUME?"
 *
 * GET /api/cron/throughput-digest[?password=...][&force=1]
 *
 * WHY THIS EXISTS. There were already SEVEN health crons (sam-sync-watchdog,
 * briefing-watchdog, check-briefing-health, check-fms-health, check-provider-health,
 * db-health-watch, health-check-email) and every one of them reported GREEN through a
 * six-day outage in which the nightly SAM sync ingested 1,000 of ~23,000 opportunities.
 *
 * They all measure LIVENESS — did the job run, is the cache fresh, is the provider up.
 * None measured THROUGHPUT — of the work that should have been produced, how much
 * actually was. Every bug in the 2026-08-03 customer escalation hid in that gap:
 *
 *   SAM sync        watchdog said healthy      1,000 of 23,000 fetched   (4%)
 *   Daily alerts    cron said success            880 of 1,594 users      (55%)
 *   Send guard      alert_log said 'skipped'      48 alerts never sent
 *   Briefings       112 sent, no error           594 entitled users invisible
 *
 * Not one reported an error. A customer found them instead, and asked whether the app
 * was ready for production. This is the check that should have found them first.
 *
 * POSTS DAILY REGARDLESS OF STATE, deliberately. A monitor that only speaks up when
 * something breaks is indistinguishable from a monitor that has itself broken — which
 * is precisely how the seven above failed. A green number every morning is what makes
 * a red one legible.
 *
 * THRESHOLDS ARE STARTING GUESSES, not derived values. Tune them once there is a week
 * of real readings; the constants are named and grouped so that is a one-line edit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendOpsAlert } from '@/lib/ops-alert';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Alert when a pipeline delivers less than this share of what it should have. */
const MIN_COMPLETENESS = 0.9;
/** Alert when more than this many alerts are blocked by the send guard in 24h. */
const MAX_GUARD_BLOCKS = 5;
/** Alert when more than this many users are entitled but unreachable by the job. */
const MAX_ORPHANED_ENTITLEMENTS = 20;

interface Check {
  name: string;
  detail: string;
  value: string;
  ok: boolean;
}

/** SAM ingest: did the last full sync fetch what SAM said was available? */
async function checkSamIngest(sb: ReturnType<typeof getSupabase>): Promise<Check> {
  const { data, error } = await sb
    .from('sam_sync_runs')
    .select('total_fetched, total_available, status, started_at')
    .eq('sync_type', 'full')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { name: 'SAM ingest', detail: `query failed: ${error.message}`, value: 'unknown', ok: false };
  }
  if (!data || !data.total_available) {
    return { name: 'SAM ingest', detail: 'no full sync on record', value: 'unknown', ok: false };
  }
  const ratio = (data.total_fetched || 0) / data.total_available;
  return {
    name: 'SAM ingest',
    detail: `${(data.total_fetched || 0).toLocaleString()} of ${data.total_available.toLocaleString()} available (status ${data.status})`,
    value: `${Math.round(ratio * 100)}%`,
    ok: ratio >= MIN_COMPLETENESS,
  };
}

/** Daily alerts: did every eligible user get processed today? */
async function checkAlertCoverage(sb: ReturnType<typeof getSupabase>): Promise<Check> {
  const today = new Date().toISOString().slice(0, 10);
  const { count: eligible, error: eErr } = await sb
    .from('user_notification_settings')
    .select('user_email', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('alerts_enabled', true)
    .eq('alert_frequency', 'daily');
  const { data: rows, error: rErr } = await sb
    .from('alert_log')
    .select('user_email')
    .eq('alert_date', today)
    .eq('alert_type', 'daily');

  if (eErr || rErr) {
    return { name: 'Alert coverage', detail: `query failed: ${(eErr || rErr)?.message}`, value: 'unknown', ok: false };
  }
  // Same null-count trap as the send guard: `eligible || 0` would make a failed count
  // read as "0 eligible users", and 0/0 then reports 100% coverage — a perfect green
  // light for a completely dead pipeline.
  if (eligible === null || eligible === undefined) {
    return { name: 'Alert coverage', detail: 'eligible count came back NULL — table missing or unreadable', value: 'unknown', ok: false };
  }
  const processed = new Set((rows || []).map(r => r.user_email)).size;
  const total = eligible;
  const ratio = total > 0 ? processed / total : 1;
  return {
    name: 'Alert coverage',
    detail: `${processed.toLocaleString()} of ${total.toLocaleString()} daily-alert users processed today`,
    value: `${Math.round(ratio * 100)}%`,
    // Runs through the morning, so a partial figure early in the day is normal —
    // this is a digest, not a real-time gauge. Read it against the posting hour.
    ok: ratio >= MIN_COMPLETENESS,
  };
}

/** Send guard: how many real alerts were suppressed by the per-recipient daily cap? */
async function checkSendGuard(sb: ReturnType<typeof getSupabase>): Promise<Check> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { count, error } = await sb
    .from('alert_log')
    .select('id', { count: 'exact', head: true })
    .eq('error_message', 'send_guard_blocked')
    .gte('alert_date', since);

  if (error) {
    return { name: 'Send guard', detail: `query failed: ${error.message}`, value: 'unknown', ok: false };
  }
  // A missing table returns count=null with error=null and HTTP 204 — no error at all.
  // `count ?? 0` would turn "I don't know" into "zero blocked", i.e. this monitor
  // fabricating the exact healthy-looking number it exists to catch. UNKNOWN is a
  // failure, not a pass.
  if (count === null || count === undefined) {
    return { name: 'Send guard', detail: 'count came back NULL — table missing or unreadable', value: 'unknown', ok: false };
  }
  const n = count;
  return {
    name: 'Send guard',
    detail: n === 0 ? 'no alerts suppressed' : `${n} alert(s) generated but never sent (suppression or daily cap)`,
    value: String(n),
    ok: n <= MAX_GUARD_BLOCKS,
  };
}

/** Briefings: users entitled in one table but invisible to the job's audience query. */
async function checkBriefingEntitlements(sb: ReturnType<typeof getSupabase>): Promise<Check> {
  const { data: enabled, error: eErr } = await sb
    .from('user_notification_settings')
    .select('user_email')
    .eq('briefings_enabled', true)
    .eq('is_active', true);
  const { data: classified, error: cErr } = await sb
    .from('customer_classifications')
    .select('email, briefings_access')
    .in('briefings_access', ['lifetime', '1_year', '6_month', 'subscription', 'beta_preview']);

  if (eErr || cErr) {
    return { name: 'Briefing entitlement', detail: `query failed: ${(eErr || cErr)?.message}`, value: 'unknown', ok: false };
  }
  const entitled = new Set((classified || []).map(r => String(r.email).toLowerCase()));
  const orphaned = (enabled || []).filter(r => !entitled.has(String(r.user_email).toLowerCase())).length;
  return {
    name: 'Briefing entitlement',
    detail: orphaned === 0
      ? 'every briefings-enabled user is reachable by the cron'
      : `${orphaned} user(s) have briefings_enabled but NO customer_classifications row — the cron cannot see them`,
    value: String(orphaned),
    ok: orphaned <= MAX_ORPHANED_ENTITLEMENTS,
  };
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  const isCron = Boolean(request.headers.get('x-vercel-cron'))
    || request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron && password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabase();
  const checks = await Promise.all([
    checkSamIngest(sb),
    checkAlertCoverage(sb),
    checkSendGuard(sb),
    checkBriefingEntitlements(sb),
  ]);

  const failing = checks.filter(c => !c.ok);
  const subject = failing.length === 0
    ? 'Throughput OK — all pipelines at expected volume'
    : `Throughput: ${failing.length} pipeline(s) below expected volume`;

  const rows = checks.map(c => `
    <tr>
      <td style="padding:8px;border:1px solid #ddd;">${c.ok ? '✅' : '⚠️'} <strong>${c.name}</strong></td>
      <td style="padding:8px;border:1px solid #ddd;"><strong>${c.value}</strong></td>
      <td style="padding:8px;border:1px solid #ddd;">${c.detail}</td>
    </tr>`).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;">
      <p>Volume produced vs volume expected. A pipeline can run "successfully" and still
      deliver a fraction of its output — that is what this catches.</p>
      <table style="border-collapse:collapse;width:100%;max-width:640px;">${rows}</table>
      <p style="color:#666;font-size:12px;margin-top:12px;">
        Thresholds: completeness ≥ ${Math.round(MIN_COMPLETENESS * 100)}%,
        send-guard blocks ≤ ${MAX_GUARD_BLOCKS}, orphaned entitlements ≤ ${MAX_ORPHANED_ENTITLEMENTS}.
      </p>
    </div>`;

  // Posted every day, healthy or not — see the header for why silence is not a signal.
  await sendOpsAlert({ subject, html }).catch(err =>
    console.error('[throughput-digest] slack post failed:', err));

  return NextResponse.json({ success: true, failing: failing.length, checks });
}
