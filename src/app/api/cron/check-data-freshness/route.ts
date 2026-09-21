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
import { sendOpsAlert } from '@/lib/ops-alert';
import {
  classifyFreshness,
  resolveAwardsIngestClocks,
  shouldFailWhenEmailFails,
  type AwardsFreshness,
} from '@/lib/awards-ingest';
import { staleDaysForCadence } from '@/lib/data-sources/freshness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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
  const stale: Array<{
    key: string;
    name: string;
    cadence: string;
    ageDays: number;
    refreshWith: string;
    classification?: AwardsFreshness['status'];
  }> = [];
  for (const s of data || []) {
    if (s.key === 'bq_awards') {
      const freshness = classifyFreshness({
        clocks: resolveAwardsIngestClocks({ notes: s.notes, lastBuilt: s.last_built }),
      });
      if (freshness.status !== 'healthy') {
        stale.push({
          key: s.key,
          name: s.name,
          cadence: s.refresh_cadence,
          ageDays: freshness.runAgeDays ?? freshness.sourceAgeDays ?? -1,
          refreshWith: REFRESH_SCRIPTS[s.key],
          classification: freshness.status,
        });
      }
      continue;
    }
    if (s.category === 'live_api' || !s.last_built) continue;
    const threshold = staleDaysForCadence(s.refresh_cadence);
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

  // When sources are overdue, post the refresh checklist to OPS (Slack). The cron runs
  // unattended, so JSON alone is invisible. The refreshes are human-run scrapers; the alert
  // tells Eric exactly which script to run, then ?stamp=<key> marks it done.
  //
  // ⚠️ THIS WAS ON THE EMAIL PATH AND HAD BEEN FAILING SILENTLY.
  // Internal ops/health/watchdog notifications moved off email onto Slack in 2026-07 because
  // they were burying the inbox; this watchdog never followed. Production evidence: it
  // returned 502 on 2026-08-28, 08-30, 09-09, 09-11 and 09-14, and in this route a 502 means
  // "staleness WAS detected and the notification failed" — so the monitor whose entire job is
  // surfacing stale data had itself gone dark for 17 days while reporting the failure only in
  // a response body nobody reads. sendOpsAlert is the same call shape and posts to the ops
  // channel. `notified` is still load-bearing: a failed delivery must keep failing the job.
  let notified = false;
  const notify = request.nextUrl.searchParams.get('notify') !== 'false';
  if (stale.length > 0 && notify) {
    try {
      const rows = stale.map(s =>
        `<li><b>${s.name}</b> — ${s.ageDays}d old (${s.cadence}) — ${s.refreshWith}</li>`
      ).join('');
      const res = await sendOpsAlert({
        subject: `${stale.length} Mindy data source(s) need attention`,
        html: `<p>${stale.length} source(s) need attention — curated sources past their refresh cadence, and/or a live sync that has gone quiet.</p>`
          + `<ul>${rows}</ul>`
          + `<p>After running a script, mark it done: <code>curl "https://getmindy.ai/api/cron/check-data-freshness?password=...&amp;stamp=&lt;key&gt;"</code><br>`
          + `Keys: ${stale.map(s => s.key).join(', ')}</p>`,
        emailType: 'admin_alert',
      });
      notified = res.ok;
      if (!res.ok) console.error('[check-data-freshness] ops alert failed:', res.error);
    } catch (e) {
      console.error('[check-data-freshness] ops alert threw:', e);
    }
  }

  const notifyFailed = shouldFailWhenEmailFails({ staleCount: stale.length, notify, emailOk: notified });
  return NextResponse.json({
    success: !notifyFailed,
    checkedAt: new Date().toISOString(),
    totalSources: (data || []).length,
    staleCount: stale.length,
    stale,
    notified,
    message: notifyFailed
      ? 'Freshness issues found, but the ops alert failed to deliver.'
      : stale.length === 0
        ? 'All curated data sources are within cadence.'
        : `${stale.length} source(s) due for refresh.`,
  }, { status: notifyFailed ? 502 : 200 });
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
  bq_awards: 'npm run ingest:awards (dry-run), then npm run ingest:awards:apply after review',
  // PROVENANCE (traced from git, 2026-09-12): the canonical served roster
  // src/data/sblo-roster-2026-06.json was NOT produced by any script. It is a
  // one-off manual/agent-assisted curation (commits e517967f/95f6826c/d9de8de2).
  // compile-sblo-list.py is the SUPERSEDED regex scraper the June roster
  // explicitly replaced for quality — pointing a refresh at it would
  // reintroduce the bad data. See docs/DATA-SOURCES-REGISTRY.md SBLO lineage.
  tier2_sblo:
    'MANUAL curated refresh — no automated producer. See docs/DATA-SOURCES-REGISTRY.md §SBLO lineage. '
    + 'Jun-2026 method: SBA Prime Directory roster → clean to official legal names → re-research each '
    + 'contact against live sources → data/imports/sblo-refresh-<YYYY-MM>.csv → canonical SBLO roster '
    + '(src/data/sblo-roster-2026-06.json). NOTE: scripts/import-sblo-refresh.js is DOWNSTREAM only '
    + '(merges the CSV into prime-contractors-database.json) and currently HARDCODES the Jun-2026 CSV '
    + 'path — it must be parameterized or deliberately updated before any future refresh. '
    + 'Do NOT run ~/Bootcamp/compile-sblo-list.py — superseded regex scraper; its output was replaced for quality.',
  dod_command_osbp: 'refresh director names vs agency OSBP pages (structure is stable)',
  agency_pain_points: 'scripts/merge-agency-intelligence.js + ~/Bootcamp/scan-ndaa-sections.py (new GAO/NDAA)',
  forecast_intelligence: 'scripts/import-forecasts.js (+ gsa/nsf/ssa variants)',
};
