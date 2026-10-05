/**
 * Recovery planning for a saved search that MISSED scheduled runs (2026-10-01 incident: a malformed stored
 * filter made every run throw before any state moved). Pure — the preview script supplies the rows.
 *
 * WHY THIS EXISTS. A never-alerted search's first successful run BASELINES: every current match is written
 * to last_seen and nothing is emailed (decideSavedSearchAlert). For a search that should have been running
 * since its creation, that first run would silently swallow everything that appeared during the outage.
 * Recovery therefore writes the baseline AS OF CREATION in the same single update that corrects the filter:
 *
 *   last_seen_notice_ids = matches posted at/before the search was created
 *   last_alerted_at      = the search's created_at   (non-null → the next run is a normal diff, not a baseline)
 *
 * so the next scheduled run delivers exactly the post-creation matches through the normal send path.
 *
 * WHAT IS AND IS NOT PROVABLE. Nothing about this search was recorded on the incident days — the cron threw
 * before evaluating it. Every match below is computed from TODAY's corpus. For each missed run we can prove a
 * notice was already IN our database (sam_opportunities.created_at = first ingest, never rewritten), and that
 * it matches the corrected filter NOW. We cannot prove its filtered fields were identical then, and a notice
 * that has since closed or been removed is not visible to the active-only alert at all.
 */
import { SAVED_SEARCH_SEEN_CAP } from './alert-decision';

/** The cron's per-search read cap (route.ts: .limit(200)) — a catch-up larger than this is truncated. */
export const SAVED_SEARCH_CRON_ROW_LIMIT = 200;

export type RecoveryNotice = {
  notice_id: string;
  title?: string | null;
  department?: string | null;
  posted_date: string | null;
  /** sam_opportunities.created_at — when Mindy first ingested the notice. */
  ingested_at: string | null;
  response_deadline?: string | null;
  active?: boolean | null;
};

export type RecoveryRunEvidence = {
  run_started_at: string;
  /** Catch-up notices already in our DB when this run started (provable) — and matching the corrected filter today. */
  present_and_matching_now: string[];
  /** Catch-up notices ingested AFTER this run started — could not have been delivered by it. */
  not_yet_ingested: string[];
};

export type SavedSearchRecoveryPlan = {
  created_at: string;
  baseline_ids: string[];
  catch_up: RecoveryNotice[];
  per_missed_run: RecoveryRunEvidence[];
  /** Posted after creation, match the corrected filter, but no longer active — the alert cannot deliver these. */
  closed_since: RecoveryNotice[];
  warnings: string[];
};

const ts = (v: string | null | undefined) => (v ? Date.parse(v) : NaN);

export function planSavedSearchRecovery(input: {
  createdAt: string;
  /** Start times of the scheduled runs this search missed (cron_job_runs, after created_at). */
  missedRuns: string[];
  /** EXACTLY what the alert cron reads today for the corrected filter (active, last 30d, ≤200, posted desc). */
  cronWindow: RecoveryNotice[];
  /** Same filter with status=all, posted after created_at — to surface matches that have since closed. */
  postedSinceAnyStatus: RecoveryNotice[];
}): SavedSearchRecoveryPlan {
  const created = ts(input.createdAt);
  const warnings: string[] = [];

  // posted_date unknown → treat as pre-existing (baseline): never email something we cannot place in time.
  const isBaseline = (n: RecoveryNotice) => !(ts(n.posted_date) > created);
  const baseline_ids = [...new Set(input.cronWindow.filter(isBaseline).map((n) => n.notice_id))];
  const catch_up = input.cronWindow.filter((n) => !isBaseline(n));

  if (input.cronWindow.length >= SAVED_SEARCH_CRON_ROW_LIMIT) {
    warnings.push(`cron window is at its ${SAVED_SEARCH_CRON_ROW_LIMIT}-row cap — older matches are outside what the alert reads`);
  }
  if (baseline_ids.length > SAVED_SEARCH_SEEN_CAP) {
    warnings.push(`baseline exceeds the ${SAVED_SEARCH_SEEN_CAP}-id seen cap`);
  }

  const windowIds = new Set(input.cronWindow.map((n) => n.notice_id));
  const closed_since = input.postedSinceAnyStatus.filter(
    (n) => ts(n.posted_date) > created && !windowIds.has(n.notice_id),
  );

  const per_missed_run = [...input.missedRuns].sort().map((run) => {
    const r = ts(run);
    return {
      run_started_at: run,
      present_and_matching_now: catch_up.filter((n) => ts(n.ingested_at) <= r).map((n) => n.notice_id),
      not_yet_ingested: catch_up.filter((n) => !(ts(n.ingested_at) <= r)).map((n) => n.notice_id),
    };
  });

  return { created_at: input.createdAt, baseline_ids, catch_up, per_missed_run, closed_since, warnings };
}

/**
 * The ONE row write recovery performs, as a compare-and-set. Every guard is a column the incident left
 * untouched, so a concurrent change (a cron stamp, a user edit, another recovery) makes it match 0 rows
 * instead of overwriting. It is returned as data for review — nothing here executes it.
 */
export function buildRecoveryWrite(row: {
  id: string; created_at: string; updated_at: string; filters: Record<string, unknown>;
}, correctedFilters: Record<string, unknown>, baselineIds: string[]) {
  return {
    table: 'saved_searches',
    where: {
      id: row.id,
      updated_at: row.updated_at,
      last_alerted_at: null,
      total_alerts_sent: 0,
      filters: row.filters,
    },
    set: {
      filters: correctedFilters,
      last_seen_notice_ids: baselineIds.slice(0, SAVED_SEARCH_SEEN_CAP),
      last_alerted_at: row.created_at,
      updated_at: '<now() at execution>',
    },
    expect_rows: 1,
  };
}
