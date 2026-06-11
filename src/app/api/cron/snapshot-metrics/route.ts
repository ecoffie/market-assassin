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
 * ?date=YYYY-MM-DD backfills a specific day (defaults to today UTC).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
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
  const supabase = sb();
  const url = new URL(request.url);

  const today = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
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
      if (!e) continue;
      wau.add(e);
      if ((r.created_at || '') >= dayStart) dau.add(e);
    }
    metrics.dau = dau.size;
    metrics.wau = wau.size;

    // --- users: total, new today, profile-complete (custom NAICS) ---
    const settings = await fetchAll<{ naics_codes: string[] | null; created_at: string | null }>((from, to) =>
      supabase
        .from('user_notification_settings')
        .select('naics_codes, created_at')
        .range(from, to),
    );
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
      (u) => (u.naics_codes || []).length > 0 && !(oppByUser.get((u.user_email || '').toLowerCase()) || 0),
    ).length;

    // --- setup/onboarding emails sent today ---
    try {
      const setupSends = await fetchAll<{ id: string }>((from, to) =>
        supabase
          .from('email_provider_sends')
          .select('id')
          .in('email_type', ['mi_account_setup', 'market_intelligence_welcome', 'profile_reminder', 'bootcamp_profile_setup'])
          .gte('sent_at', dayStart)
          .lte('sent_at', dayEnd)
          .range(from, to),
      );
      metrics.setup_emails_sent = setupSends.length;
    } catch {
      metrics.setup_emails_sent = 0;
    }

    // --- upsert one row per metric for the day ---
    const rows = Object.entries(metrics).map(([metric_key, value]) => ({
      snapshot_date: today,
      metric_key,
      value,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
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
