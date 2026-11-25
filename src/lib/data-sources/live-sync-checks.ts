/**
 * Live-sync data-age checks for /api/cron/check-data-freshness (daily 13:05 UTC, ops Slack).
 *
 * Each check reads ONE table's own clock (the newest row's timestamp) and flags it when older than the threshold.
 * Data-age alarm (Agent 4 / Eric, 2026-11-25): Ask Mindy cites these datasets with an "as of" chip; Eric saw
 * "Lookup sam entity · as of 2026-08-25" in a live answer and nothing had alerted.
 *
 * Unknown is never fresh: a read error is `unreadable`, an empty table or missing timestamp is `no_timestamp`; both
 * alert. Thresholds are the producer's cadence plus grace, justified per check.
 */
export interface LiveSyncCheck {
  key: string;
  name: string;
  table: string;
  column: string;
  staleDays: number;
  refreshWith: string;
}

export const LIVE_SYNC_CHECKS: readonly LiveSyncCheck[] = [
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
  {
    // Honesty only (specialty repair stays PARKED): max(synced_at) is last REAL data, not last
    // cron attempt. sync-dibbs disabled 2026-11-02; control plane still said current.
    key: 'dibbs_rfqs_data',
    name: 'DLA DIBBS RFQs (last real data via synced_at)',
    table: 'dibbs_rfqs',
    column: 'synced_at',
    staleDays: 3,
    refreshWith: 'sync-dibbs is DISABLED (Apify cost) — do not re-enable without Eric; mark control plane content_stale',
  },
  {
    // Empty table / no synced_at → alert. Stops silent false green.
    key: 'dod_sbir_topics_data',
    name: 'DoD SBIR topics cache (dod_sbir_topics)',
    table: 'dod_sbir_topics',
    column: 'synced_at',
    staleDays: 2,
    refreshWith: 'sync-dod-sbir stays ENABLED. HTTP 503 is degraded, not a reason to park. Do not apply 20261118_park_false_green_freshness.sql to disable this job.',
  },
  // ── Data-age alarm (2026-11-25) ─────────────────────────────────────────────────────────
  {
    // The registration mirror behind lookup_sam_entity / research-mode identity. Refreshed from SAM's MONTHLY public
    // extract (first Sunday), so 31 days + 4 grace. synced_at was 2026-08-25 on 2026-11-25: this fires today.
    key: 'sam_entities_registrations',
    name: 'SAM entity registrations (sam_entities mirror, monthly extract)',
    table: 'sam_entities',
    column: 'synced_at',
    staleDays: 35,
    refreshWith: 'refresh from the monthly SAM_PUBLIC_MONTHLY_V2 extract: node scripts/import-sam-entity-extract.mjs --file <zip> --all-naics --dry, then the real run with Eric\'s OK',
  },
  {
    // Open-now notices. The SAM delta/full syncs run several times a day and every new notice gets created_at; two
    // days with no new notice means the sync is down (SAM posts hundreds daily). Keyset index (created_at, notice_id).
    key: 'sam_opportunities_new',
    name: 'SAM opportunities (newest notice created_at)',
    table: 'sam_opportunities',
    column: 'created_at',
    staleDays: 2,
    refreshWith: 'live sync — verify /api/cron/sync-sam-opportunities-delta / -full in cron_job_runs; sam-sync-watchdog',
  },
  {
    // Coming back / expiring contracts. sync-recompete-contracts runs hourly over NAICS slices and stamps
    // last_synced_at on each row it touches; 2 days without any touch = the sync is down.
    key: 'recompete_opportunities_sync',
    name: 'Recompete contracts (recompete_opportunities.last_synced_at, hourly sync)',
    table: 'recompete_opportunities',
    column: 'last_synced_at',
    staleDays: 2,
    refreshWith: 'live sync — verify /api/cron/sync-recompete-contracts in cron_job_runs',
  },
  {
    // Coming soon. Forecast feeds sync on different cadences (daily crons + weekly/monthly publishers); the newest
    // row across all of them should advance at least weekly. Per-feed health stays in data_source_instances.
    key: 'agency_forecasts_sync',
    name: 'Agency forecasts (agency_forecasts.last_synced_at, newest across feeds)',
    table: 'agency_forecasts',
    column: 'last_synced_at',
    staleDays: 7,
    refreshWith: 'live sync — verify /api/cron/sync-forecasts and the doj/nasa/hhs forecast syncs in cron_job_runs',
  },
];

export type LiveSyncVerdict =
  | { status: 'fresh'; ageDays: number }
  | { status: 'stale'; ageDays: number }
  | { status: 'no_timestamp' }
  | { status: 'unreadable'; error: string };

/** Classify one check from its read. A read error or missing clock is never fresh. */
export function classifyLiveSync(
  check: LiveSyncCheck,
  read: { error?: { message?: string } | null; timestamp?: string | null },
  nowMs: number = Date.now(),
): LiveSyncVerdict {
  if (read.error) return { status: 'unreadable', error: read.error.message || 'read failed' };
  const t = read.timestamp ? Date.parse(read.timestamp) : NaN;
  if (!Number.isFinite(t)) return { status: 'no_timestamp' };
  const ageDays = Math.round((nowMs - t) / 86_400_000);
  return ageDays > check.staleDays ? { status: 'stale', ageDays } : { status: 'fresh', ageDays };
}
