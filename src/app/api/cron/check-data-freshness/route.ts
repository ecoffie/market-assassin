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
import { classifyLookupFreshness, parseLookupStatus } from '@/lib/awards-ingest/lookup-freshness';
import {
  classifyFreshness,
  resolveAwardsIngestClocks,
  shouldFailWhenEmailFails,
  type AwardsFreshness,
} from '@/lib/awards-ingest';
import { staleDaysForCadence } from '@/lib/data-sources/freshness';
import { TABLE_MEASURED_SOURCES, classifyTableFreshness, isTableMeasured } from '@/lib/data-sources/table-measured';
import { decideStamp } from '@/lib/data-sources/stamp-guard';
import eventsCatalog from '@/data/federal-events-sources.json';
import { CATALOG_KEY, catalogDateFindings, catalogLinkFindings, type EventCatalog } from '@/lib/events/catalog-freshness';
import { measureEventDrift } from '@/lib/events/event-currency-live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // the weekly catalog link check adds up to ~45s of time-boxed GETs

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') || '';
  const pw = request.nextUrl.searchParams.get('password');
  const ok = (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`)
    || pw === (process.env.ADMIN_PASSWORD);
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // STAMP action: ?stamp=<key>&records=<n>&evidence=<what was refreshed, where to check it>
  // marks a curated source refreshed AFTER you actually ran its refresh. We never
  // auto-stamp, and a stamp is never a way to clear an alert: decideStamp refuses keys
  // whose freshness is measured elsewhere (table-measured, the events catalog,
  // producer-stamped, live APIs) and refuses any stamp without a record count and
  // cited evidence. The evidence is appended to the row's notes for audit.
  const stampKey = request.nextUrl.searchParams.get('stamp');
  if (stampKey) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: row, error: rowErr } = await sb
      .from('data_sources').select('key,is_active,category,notes').eq('key', stampKey).maybeSingle();
    if (rowErr) return NextResponse.json({ success: false, error: rowErr.message }, { status: 500 });
    const decision = decideStamp({
      key: stampKey,
      row,
      evidence: request.nextUrl.searchParams.get('evidence'),
      records: request.nextUrl.searchParams.get('records'),
      today,
    });
    if (!decision.ok) {
      return NextResponse.json({ success: false, stamped: null, refused: stampKey, error: decision.reason }, { status: decision.status });
    }
    const { error: upErr } = await sb.from('data_sources').update(decision.update).eq('key', stampKey);
    if (upErr) return NextResponse.json({ success: false, error: upErr.message }, { status: 500 });
    return NextResponse.json({ success: true, stamped: stampKey, last_built: decision.update.last_built, record_count: decision.update.record_count });
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
    // Checked below from the catalog file itself, never from a stamped last_built.
    if (s.key === CATALOG_KEY) continue;
    // Measured from the table's own rows below — a stamp never decides these.
    if (isTableMeasured(s.key)) continue;
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
    if (s.key === 'bq_award_lookups') {
      // Lookups vs the warehouse they are derived from — not an age check (2026-11-13: they sat
      // seven months behind with no alert). Uses the ingest clocks from the bq_awards row.
      const awardsRow = (data || []).find((r) => r.key === 'bq_awards');
      const clocks = awardsRow ? resolveAwardsIngestClocks({ notes: awardsRow.notes, lastBuilt: awardsRow.last_built }) : null;
      const f = classifyLookupFreshness(parseLookupStatus(s.notes), clocks);
      if (f.status !== 'healthy') {
        stale.push({
          key: s.key, name: s.name, cadence: s.refresh_cadence, ageDays: -1,
          refreshWith: `${REFRESH_SCRIPTS[s.key]} — ${f.status}: ${f.detail}`,
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

  // Curated event catalog. Review age and passed dates come from the file (no network, daily); the
  // link check makes one time-boxed GET per catalog URL and runs weekly (Mondays) or on ?links=1.
  // Any finding joins the same ops alert. A blocked or slow organizer site is never a finding.
  const todayStr = new Date().toISOString().slice(0, 10);
  const catalogFindings = catalogDateFindings(eventsCatalog as EventCatalog, todayStr);
  let catalogLinks: { checked: number; inconclusive: number } | null = null;
  if (new Date().getUTCDay() === 1 || request.nextUrl.searchParams.get('links') === '1') {
    try {
      const r = await catalogLinkFindings(eventsCatalog as EventCatalog);
      catalogFindings.push(...r.findings);
      catalogLinks = { checked: r.checked, inconclusive: r.inconclusive };
    } catch (e) {
      console.error('[check-data-freshness] catalog link check failed:', e);
    }
  }
  if (catalogFindings.length > 0) {
    const review = (eventsCatalog as EventCatalog).lastFullReview;
    stale.push({
      key: CATALOG_KEY,
      name: `Federal events catalog — ${catalogFindings.length} item(s): ${catalogFindings.slice(0, 6).map((f) => (f.entry ? `${f.entry}: ` : '') + f.detail).join('; ')}${catalogFindings.length > 6 ? '; …' : ''}`,
      cadence: 'monthly',
      ageDays: review ? Math.round((Date.parse(todayStr) - Date.parse(review)) / 86400_000) : -1,
      refreshWith: REFRESH_SCRIPTS[CATALOG_KEY],
    });
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

  // Event currency (R6): a listed attendable event whose stored type/date differs from what the
  // extractor reads on the CURRENT version of its notice's solicitation family. Counts and job runs
  // could never see this — rows froze after ~5 days while every run reported success (audit
  // 2026-11-09). Rows whose notice arrived after the last extractor run are the next run's job, and
  // blank-solicitation rows are the documented bound; both are reported, neither is counted.
  let eventCurrency: Record<string, unknown> = { status: 'unmeasured' };
  try {
    const d = await measureEventDrift(sb);
    eventCurrency = {
      status: d.countable === 0 ? 'current' : 'drift',
      listed: d.listed, examined: d.examined, drift: d.countable,
      blankSolBound: d.blankSolBound, pendingNextRun: d.pendingNextRun, retiredSourceHidden: d.retiredSourceHidden,
      lastRunAt: d.lastRunAt,
      sample: d.drift.filter((f) => !f.blankSolBound && !f.pendingNextRun).slice(0, 5),
    };
    if (d.countable > 0) {
      stale.push({ key: EVENT_CURRENCY_KEY, name: `Federal events — ${d.countable} listed event(s) disagree with the current version of their notice`, cadence: 'live-sync', ageDays: d.lastRunAt ? Math.round((now - Date.parse(d.lastRunAt)) / 86400_000) : -1, refreshWith: 'check /api/cron/extract-sam-events (re-reads every listed notice daily); npm run verify:oracles -- --only events' });
    }
  } catch (e) {
    // Unmeasured is never "current".
    eventCurrency = { status: 'unmeasured', error: e instanceof Error ? e.message : String(e) };
    stale.push({ key: EVENT_CURRENCY_KEY, name: 'Federal events currency', cadence: 'live-sync', ageDays: -1, refreshWith: `check failed: ${eventCurrency.error}` });
  }

  // Table-measured sources: freshness = what the scheduled producer actually wrote
  // (age of the newest row AND the share of rows refreshed in its window). Replaces the
  // stamp for sources whose producer never writes last_built (dodaac_directory: a false
  // 169-day alert while the job refreshed 4,901/4,902 rows on 2026-11-06).
  const tableMeasured: Record<string, ReturnType<typeof classifyTableFreshness>> = {};
  for (const spec of Object.values(TABLE_MEASURED_SOURCES)) {
    const windowStart = new Date(now - spec.windowDays * 86400_000).toISOString();
    const [newestRes, totalRes, windowRes] = await Promise.all([
      sb.from(spec.table).select(spec.column).order(spec.column, { ascending: false }).limit(1).maybeSingle(),
      sb.from(spec.table).select('*', { count: 'exact', head: true }),
      sb.from(spec.table).select('*', { count: 'exact', head: true }).gte(spec.column, windowStart),
    ]);
    // An errored read is unknown, never a count of zero.
    const f = classifyTableFreshness({
      spec,
      newest: newestRes.error ? null : (newestRes.data as Record<string, string> | null)?.[spec.column],
      total: totalRes.error ? null : totalRes.count,
      refreshedInWindow: windowRes.error ? null : windowRes.count,
    });
    tableMeasured[spec.key] = f;
    if (f.status !== 'healthy') {
      stale.push({ key: spec.key, name: spec.name, cadence: `table-measured (${spec.windowDays}d)`, ageDays: f.ageDays ?? -1, refreshWith: `${f.status}: ${f.detail}` });
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
          + `<p>After running a refresh, mark it done WITH evidence: <code>curl "https://getmindy.ai/api/cron/check-data-freshness?password=...&amp;stamp=&lt;key&gt;&amp;records=&lt;n&gt;&amp;evidence=&lt;what+changed+and+where+to+check&gt;"</code> (refused without evidence; table-measured sources cannot be stamped).<br>`
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
    tableMeasured,
    eventCurrency,
    eventsCatalog: { lastFullReview: (eventsCatalog as EventCatalog).lastFullReview ?? null, findings: catalogFindings, links: catalogLinks },
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
const EVENT_CURRENCY_KEY = 'sam_events_currency';

const LIVE_SYNC_CHECKS: Array<{ key: string; name: string; table: string; column: string; staleDays: number; refreshWith: string }> = [
  {
    // extracted_at is written on EVERY upsert (R4), so its max is "when the extractor last re-read
    // the corpus" — it used to be first-insert only and could not serve as this clock.
    key: 'sam_events_reread',
    name: 'Federal events (SAM notice re-read, daily 07:00 UTC)',
    table: 'sam_events',
    column: 'extracted_at',
    staleDays: 2,
    refreshWith: 'live sync — verify /api/cron/extract-sam-events is running (cron_job_runs.http_status)',
  },
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
  bq_award_lookups: 'npx tsx scripts/rebuild-award-lookups.ts (dry run), then --go (atomic, validated; runs weekly after the ingest)',
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
    + '(src/data/sblo-roster-2026-06.json). Apply the researched CSV with '
    + '`npx tsx scripts/import-sblo-refresh.ts --csv <path>` (diff only, writes nothing), then '
    + '`--write --out src/data/sblo-roster-<YYYY-MM>.json` (new file; every field needs status/verifiedAt/sourceUrl). '
    + 'The importer researches nothing — it is not the producer. '
    + 'Do NOT run ~/Bootcamp/compile-sblo-list.py — superseded regex scraper; its output was replaced for quality.',
  dod_command_osbp: 'refresh director names vs agency OSBP pages (structure is stable)',
  agency_pain_points: 'scripts/merge-agency-intelligence.js + ~/Bootcamp/scan-ndaa-sections.py (new GAO/NDAA)',
  forecast_intelligence: 'scripts/import-forecasts.js (+ gsa/nsf/ssa variants)',
  [CATALOG_KEY]:
    'MANUAL monthly review of src/data/federal-events-sources.json: re-check each entry on the ORGANIZER site '
    + '(never a third-party listing), update next_occurrence + per-entry verification, then bump lastFullReview '
    + '(that date IS the stamp). See docs/DATA-SOURCES-REGISTRY.md §Federal events catalog.',
};
