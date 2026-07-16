/**
 * /api/cron/snapshot-metrics
 *
 * Writes ONE daily_metric_snapshots row per metric for "today" (UTC) so the admin
 * dashboard can chart trends instead of recomputing from raw events each load.
 * Fired by the cron dispatcher (cron_jobs row), NOT a vercel.json cron.
 *
 * Metrics captured:
 *   dau                  — distinct users with email_open/link_click TODAY
 *   wau                  — distinct such users in the trailing 7 days
 *   new_signups          — user_notification_settings rows created TODAY
 *   total_users          — total user_notification_settings rows
 *   profile_complete     — users whose NAICS != the 5-code default (matches dashboard)
 *   alerts_sent          — alert_log rows delivery_status='sent' TODAY
 *   zero_alert_users_7d  — active+NAICS users with 0 opps in the last 7 days
 *   setup_emails_sent    — account-setup/welcome/reminder emails sent TODAY
 *
 * Idempotent: re-running the same day overwrites that day's rows (upsert).
 * ?date=YYYY-MM-DD backfills a specific day. With no ?date, defaults to YESTERDAY
 * (UTC) — the cron fires at 00:00 UTC, so "today" has no data yet; snapshotting the
 * just-closed day captures a full day's alerts/engagement instead of zeros.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getReadClient, getWriteClient, getCountClient } from '@/lib/supabase/server-clients';
import { isExcludedFromMetrics } from '@/lib/mindy/campaign-exclusions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Heavy analytics scans (engagement, settings, alert_log) → read replica when
// configured. The single upsert at the end uses the primary write client. There
// is no read-after-write here (reads all run BEFORE the write), so this split is safe.
function sbRead() {
  return getReadClient();
}
function sbWrite() {
  return getWriteClient();
}
// Head-counts MUST NOT go to the replica — it 400s every HEAD request, which this
// file then recorded as a real 0 for nine days. See getCountClient().
function sbCount() {
  return getCountClient();
}

const DEFAULT_NAICS_SET = new Set(['541512', '541611', '541330', '541990', '561210']);

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
  const supabase = sbRead();
  const url = new URL(request.url);

  // No ?date → snapshot YESTERDAY (the just-closed UTC day). The cron fires at 00:00
  // UTC; using new Date() here would summarize a day that has barely begun → all zeros.
  const yesterday = new Date(Date.now() - 86400_000).toISOString().split('T')[0];
  const today = url.searchParams.get('date') || yesterday;
  const dayStart = `${today}T00:00:00.000Z`;
  const dayEnd = `${today}T23:59:59.999Z`;
  const sevenDaysAgo = new Date(new Date(today).getTime() - 6 * 86400_000).toISOString().split('T')[0];
  const sevenDaysAgoIso = `${sevenDaysAgo}T00:00:00.000Z`;

  const metrics: Record<string, number> = {};

  try {
    // --- engagement: DAU (today) + WAU (trailing 7 days) ---
    const engagement = await fetchAll<{ user_email: string | null; created_at: string }>((from, to) =>
      supabase
        .from('user_engagement')
        .select('user_email, created_at')
        .in('event_type', ['email_open', 'link_click'])
        .gte('created_at', sevenDaysAgoIso)
        .lte('created_at', dayEnd)
        .range(from, to),
    );
    const dau = new Set<string>();
    const wau = new Set<string>();
    for (const r of engagement) {
      const e = (r.user_email || '').toLowerCase();
      if (!e || isExcludedFromMetrics(e)) continue; // skip comp/advocate/partner
      wau.add(e);
      if ((r.created_at || '') >= dayStart) dau.add(e);
    }
    metrics.dau = dau.size;
    metrics.wau = wau.size;

    // --- users: total, new today, profile-complete (custom NAICS) ---
    // Exclude comp/advocate/partner accounts from every user count.
    const settingsAll = await fetchAll<{ user_email: string | null; naics_codes: string[] | null; created_at: string | null }>((from, to) =>
      supabase
        .from('user_notification_settings')
        .select('user_email, naics_codes, created_at')
        .range(from, to),
    );
    const settings = settingsAll.filter((s) => !isExcludedFromMetrics(s.user_email));
    metrics.total_users = settings.length;
    metrics.new_signups = settings.filter((s) => (s.created_at || '') >= dayStart && (s.created_at || '') <= dayEnd).length;
    metrics.profile_complete = settings.filter((s) => {
      const codes = s.naics_codes || [];
      return codes.length > 0 && !codes.every((c) => DEFAULT_NAICS_SET.has(String(c)));
    }).length;

    // --- alerts sent today + zero-alert users (7d) ---
    const alertLogs = await fetchAll<{ user_email: string; opportunities_count: number | null; sent_at: string | null }>((from, to) =>
      supabase
        .from('alert_log')
        .select('user_email, opportunities_count, sent_at')
        .gte('alert_date', sevenDaysAgo)
        .eq('delivery_status', 'sent')
        .range(from, to),
    );
    metrics.alerts_sent = alertLogs.filter((r) => (r.sent_at || '') >= dayStart && (r.sent_at || '') <= dayEnd).length;
    const oppByUser = new Map<string, number>();
    for (const r of alertLogs) {
      const e = (r.user_email || '').toLowerCase();
      if (isExcludedFromMetrics(e)) continue;
      oppByUser.set(e, (oppByUser.get(e) || 0) + (r.opportunities_count || 0));
    }
    const activeNaics = await fetchAll<{ user_email: string; naics_codes: string[] | null }>((from, to) =>
      supabase
        .from('user_notification_settings')
        .select('user_email, naics_codes')
        .eq('alerts_enabled', true)
        .eq('is_active', true)
        .range(from, to),
    );
    metrics.zero_alert_users_7d = activeNaics.filter(
      (u) => !isExcludedFromMetrics(u.user_email) && (u.naics_codes || []).length > 0 && !(oppByUser.get((u.user_email || '').toLowerCase()) || 0),
    ).length;

    // --- setup/onboarding emails sent today ---
    // Count-only: head+exact count transfers NO rows (was pulling every matching row
    // just to read .length). Same number, a fraction of the memory/IO.
    //
    // sbCount(), NOT supabase(sbRead): the replica 400s every HEAD, and head:true
    // IS a HEAD. This previously recorded a real 0 for nine days (07-07 → 07-15,
    // 190 emails erased) because the 400 was swallowed and `count ?? 0` made it
    // look like a genuine zero. Errors are surfaced now for the same reason: a
    // missing metric is recoverable, a fabricated one silently isn't.
    {
      const { count, error } = await sbCount()
        .from('email_provider_sends')
        .select('id', { count: 'exact', head: true })
        .in('email_type', ['mi_account_setup', 'market_intelligence_welcome', 'profile_reminder', 'bootcamp_profile_setup'])
        .gte('sent_at', dayStart)
        .lte('sent_at', dayEnd);
      if (error) throw new Error(`snapshot-metrics: setup_emails_sent count failed: ${error.message}`);
      metrics.setup_emails_sent = count ?? 0;
    }

    // --- upsert one row per metric for the day ---
    const rows = Object.entries(metrics).map(([metric_key, value]) => ({
      snapshot_date: today,
      metric_key,
      value,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await sbWrite()
      .from('daily_metric_snapshots')
      .upsert(rows, { onConflict: 'snapshot_date,metric_key' });
    if (error) {
      return NextResponse.json({ success: false, error: error.message, metrics }, { status: 500 });
    }

    return NextResponse.json({ success: true, date: today, captured: rows.length, metrics });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'snapshot failed', metrics },
      { status: 500 },
    );
  }
}
