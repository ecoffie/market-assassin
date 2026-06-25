/**
 * /api/cron/check-data-freshness — the #31 refresh discipline. Weekly check of
 * the data_sources registry: flags any built/curated source whose last_built is
 * past its refresh cadence, so curated data (SBLO, OSBP, pain points) never
 * silently rots. Acquisition: provable that the data layer is MAINTAINED.
 *
 * Surfaces the stale list (and optionally emails it). Does NOT auto-refresh —
 * the refresh scripts (~/Bootcamp/*.py, scripts/*.js) are run deliberately; this
 * is the watchdog that says "it's time."
 *
 * Also monitors LIVE syncs (LIVE_SYNC_CHECKS) by table recency, so a silently
 * broken pipeline (e.g. the daily federal_contacts SAM sync) raises the same
 * alert instead of rotting unnoticed. NOTE: for that live-sync alert to be
 * timely, the dispatcher should fire this daily — quarterly only is too slow to
 * catch a down sync.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Days past which a source of each cadence is "stale" (cadence + grace).
const STALE_THRESHOLD: Record<string, number> = {
  quarterly: 100,   // ~3 months + grace
  annual: 380,      // ~1 year + grace
  'as-published': 120,
};

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') || '';
  const pw = request.nextUrl.searchParams.get('password');
  const ok = (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`)
    || pw === (process.env.ADMIN_PASSWORD);
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // STAMP action: ?stamp=<source key> marks a source refreshed AFTER you actually
  // ran its rebuild script. We never auto-stamp (that would fake freshness — the
  // refreshes are human-run scrapers). This is the honest "I did the refresh" call.
  const stampKey = request.nextUrl.searchParams.get('stamp');
  if (stampKey) {
    const today = new Date().toISOString().slice(0, 10);
    const { error: upErr } = await sb.from('data_sources').update({ last_built: today }).eq('key', stampKey);
    if (upErr) return NextResponse.json({ success: false, error: upErr.message }, { status: 500 });
    return NextResponse.json({ success: true, stamped: stampKey, last_built: today });
  }

  const { data, error } = await sb.from('data_sources').select('*').eq('is_active', true);
  if (error) {
    return NextResponse.json({ success: false, error: error.message, hint: 'Run the data_sources migration first.' }, { status: 500 });
  }

  const now = Date.now();
  const stale: Array<{ key: string; name: string; cadence: string; ageDays: number; refreshWith: string }> = [];
  for (const s of data || []) {
    if (s.category === 'live_api' || !s.last_built) continue;
    const threshold = STALE_THRESHOLD[s.refresh_cadence] ?? 120;
    const ageDays = Math.round((now - new Date(s.last_built).getTime()) / 86400_000);
    if (ageDays > threshold) {
      // The script that refreshes each source (from the registry doc).
      const refreshWith = REFRESH_SCRIPTS[s.key] || s.built_from || 'see DATA-SOURCES-REGISTRY.md';
      stale.push({ key: s.key, name: s.name, cadence: s.refresh_cadence, ageDays, refreshWith });
    }
  }

  // Live-sync freshness (not curated scrapers — these are crons that must keep
  // running; there's nothing to "stamp"). We read each monitored table's newest
  // row: if the pipeline has gone quiet past its window the cron is likely down,
  // so we flag it like a stale source and the same alert fires. Closes the gap
  // where a silently-broken daily federal_contacts sync raised no alarm.
  for (const lc of LIVE_SYNC_CHECKS) {
    try {
      const { data: latest } = await sb
        .from(lc.table)
        .select(lc.column)
        .order(lc.column, { ascending: false })
        .limit(1)
        .maybeSingle();
      const ts = (latest as Record<string, string> | null)?.[lc.column];
      if (!ts) {
        stale.push({ key: lc.key, name: lc.name, cadence: 'live-sync', ageDays: 9999, refreshWith: `${lc.refreshWith} (table empty / no timestamp)` });
        continue;
      }
      const ageDays = Math.round((now - new Date(ts).getTime()) / 86400_000);
      if (ageDays > lc.staleDays) {
        stale.push({ key: lc.key, name: lc.name, cadence: 'live-sync', ageDays, refreshWith: lc.refreshWith });
      }
    } catch (e) {
      stale.push({ key: lc.key, name: lc.name, cadence: 'live-sync', ageDays: -1, refreshWith: `${lc.refreshWith} (check failed: ${e instanceof Error ? e.message : 'unknown'})` });
    }
  }

  // When sources are overdue, EMAIL the refresh checklist (cron runs unattended,
  // so JSON alone is invisible). The refreshes are human-run scrapers; the email
  // tells Eric exactly which script to run, then ?stamp=<key> marks it done.
  let emailed = false;
  const notify = request.nextUrl.searchParams.get('notify') !== 'false';
  if (stale.length > 0 && notify) {
    try {
      const rows = stale.map(s =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee"><b>${s.name}</b></td>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #eee">${s.ageDays}d old (${s.cadence})</td>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px">${s.refreshWith}</td></tr>`
      ).join('');
      await sendEmail({
        to: 'evankoffdev@gmail.com',
        subject: `📊 ${stale.length} Mindy data source(s) need attention`,
        html: `<div style="font-family:system-ui;max-width:640px">
          <h2 style="color:#1e3a8a">Data freshness check</h2>
          <p>${stale.length} source(s) need attention — curated sources past their refresh cadence (run the script, then mark refreshed) and/or a live sync that has gone quiet (check its cron). See the "Refresh with" column.</p>
          <table style="border-collapse:collapse;width:100%"><thead><tr style="background:#f3f4f6">
            <th style="padding:6px 12px;text-align:left">Source</th><th style="padding:6px 12px;text-align:left">Age</th><th style="padding:6px 12px;text-align:left">Refresh with</th></tr></thead>
          <tbody>${rows}</tbody></table>
          <p style="margin-top:16px;font-size:13px;color:#666">After running a script, mark it done:<br>
          <code style="font-size:12px">curl "https://getmindy.ai/api/cron/check-data-freshness?password=...&stamp=&lt;key&gt;"</code><br>
          Keys: ${stale.map(s => s.key).join(', ')}</p>
        </div>`,
        emailType: 'admin_alert',
        eventSource: 'data-freshness-cron',
      });
      emailed = true;
    } catch (e) {
      console.error('[check-data-freshness] email failed:', e);
    }
  }

  return NextResponse.json({
    success: true,
    checkedAt: new Date().toISOString(),
    totalSources: (data || []).length,
    staleCount: stale.length,
    stale,
    emailed,
    message: stale.length === 0 ? 'All curated data sources are within cadence.' : `${stale.length} source(s) due for refresh.`,
  });
}

// Live syncs we monitor by table recency (max updated_at), NOT by a stamped
// last_built. If the newest row is older than staleDays, the cron is probably
// down. Add a row here to bring another live pipeline under the watchdog.
const LIVE_SYNC_CHECKS: Array<{ key: string; name: string; table: string; column: string; staleDays: number; refreshWith: string }> = [
  {
    key: 'federal_contacts_sync',
    name: 'Government contacts (SAM POC daily sync)',
    table: 'federal_contacts',
    column: 'updated_at',
    staleDays: 3, // daily sync; 3d of silence = pipeline likely broken
    refreshWith: 'live sync — verify /api/cron/sync-gov-buyer-data is running',
  },
];

// How to refresh each curated source (the runnable path — keep in sync with the
// registry doc's "Refresh ownership" section).
const REFRESH_SCRIPTS: Record<string, string> = {
  tier2_sblo: '~/Bootcamp/compile-sblo-list.py (SBA Prime Dir + DoD CSP + DHS OSDBU + company sites)',
  dod_command_osbp: 'refresh director names vs agency OSBP pages (structure is stable)',
  agency_pain_points: 'scripts/merge-agency-intelligence.js + ~/Bootcamp/scan-ndaa-sections.py (new GAO/NDAA)',
  forecast_intelligence: 'scripts/import-forecasts.js (+ gsa/nsf/ssa variants)',
};
