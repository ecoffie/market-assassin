import type { SavedSearchAlertFrequency } from './constants';

/**
 * Per-fetch bound — not the day's work. One invocation keeps requesting the
 * next oldest-due page until the audience is drained or a safety ceiling hits.
 */
export const SAVED_SEARCH_ALERT_BATCH_SIZE = 50;

/**
 * Hard row ceiling for a single invocation. Must stay well below a
 * 290s route timeout even if every row is a slow send.
 */
export const SAVED_SEARCH_ALERT_ROW_CEILING = 400;

/** Dispatcher/route timeout for this job. The drain budget stays below it. */
export const SAVED_SEARCH_ALERT_ROUTE_TIMEOUT_MS = 290_000;

/** Leave headroom for the last stamp + reportCronOutcome before the 290s kill. */
export const SAVED_SEARCH_ALERT_TIME_BUDGET_MS = 240_000;

export type SavedSearchAlertFailureClass =
  | 'saved_search_query_failed'
  | 'profile_query_failed'
  | 'opportunity_query_failed'
  | 'forecast_query_failed'
  | 'email_send_failed'
  | 'email_send_rejected'
  | 'state_update_failed'
  | 'unexpected_schedule_error';

export type SavedSearchAlertDrainOutcome = 'success' | 'error' | 'partial';

export type SavedSearchAlertDrainStopReason =
  | 'drained'
  | 'time_budget'
  | 'row_ceiling'
  | 'query_failed';

export type SavedSearchAlertEvalCounts = {
  sent?: number;
  matched?: number;
  sendAttempts?: number;
  noMatches?: number;
  skippedNotDue?: number;
  skippedNoProfile?: number;
  failed?: number;
  failureClass?: SavedSearchAlertFailureClass;
};

export type SavedSearchAlertDueRow = {
  id: string;
  user_email: string;
  name: string;
  mode: string;
  filters: Record<string, unknown>;
  alert_frequency: string;
  last_seen_notice_ids: string[];
  total_alerts_sent: number;
  last_alerted_at: string | null;
};

export type SavedSearchAlertDrainResult = {
  success: boolean;
  outcome: SavedSearchAlertDrainOutcome;
  processed: number;
  matched: number;
  sendAttempts: number;
  sent: number;
  noMatches: number;
  skippedNotDue: number;
  skippedNoProfile: number;
  failed: number;
  remaining: number | null;
  batches: number;
  stopReason: SavedSearchAlertDrainStopReason;
  failuresByClass: Partial<Record<SavedSearchAlertFailureClass, number>>;
  errorSummary?: string;
};

export type FetchDueSavedSearchBatch = (args: {
  limit: number;
  excludeIds: readonly string[];
  dueFrequencies: readonly SavedSearchAlertFrequency[];
}) => Promise<{
  rows: SavedSearchAlertDueRow[];
  error?: { code?: string; message?: string } | null;
}>;

export type CountRemainingDueSavedSearches = (args: {
  excludeIds: readonly string[];
  dueFrequencies: readonly SavedSearchAlertFrequency[];
}) => Promise<number | null>;

export function shouldContinueSavedSearchDrain(opts: {
  fetchedCount: number;
  processed: number;
  rowCeiling: number;
  elapsedMs: number;
  timeBudgetMs: number;
}): { continue: boolean; stopReason?: SavedSearchAlertDrainStopReason } {
  if (opts.elapsedMs >= opts.timeBudgetMs) {
    return { continue: false, stopReason: 'time_budget' };
  }
  if (opts.processed >= opts.rowCeiling) {
    return { continue: false, stopReason: 'row_ceiling' };
  }
  if (opts.fetchedCount === 0) {
    return { continue: false, stopReason: 'drained' };
  }
  return { continue: true };
}

function addCounts(
  results: SavedSearchAlertDrainResult,
  counts: SavedSearchAlertEvalCounts,
): void {
  results.sent += counts.sent ?? 0;
  results.matched += counts.matched ?? 0;
  results.sendAttempts += counts.sendAttempts ?? 0;
  results.noMatches += counts.noMatches ?? 0;
  results.skippedNotDue += counts.skippedNotDue ?? 0;
  results.skippedNoProfile += counts.skippedNoProfile ?? 0;
  if (counts.failed) {
    results.failed += counts.failed;
    if (counts.failureClass) {
      results.failuresByClass[counts.failureClass] =
        (results.failuresByClass[counts.failureClass] || 0) + counts.failed;
    }
  } else if (counts.failureClass) {
    results.failed += 1;
    results.failuresByClass[counts.failureClass] =
      (results.failuresByClass[counts.failureClass] || 0) + 1;
  }
}

function summarizeDrain(results: SavedSearchAlertDrainResult): string | undefined {
  const parts = Object.entries(results.failuresByClass)
    .map(([failureClass, count]) => `${failureClass}=${count}`);
  if (results.stopReason === 'time_budget' || results.stopReason === 'row_ceiling') {
    const backlog = results.remaining === null ? 'unknown' : String(results.remaining);
    parts.push(`capacity_exhausted=1`, `backlog=${backlog}`);
  }
  return parts.length ? parts.join(',') : undefined;
}

function resolveOutcome(results: SavedSearchAlertDrainResult): SavedSearchAlertDrainOutcome {
  if (results.stopReason === 'query_failed') return 'error';
  const leftover = results.remaining === null || results.remaining > 0;
  if (
    leftover
    && (results.stopReason === 'time_budget' || results.stopReason === 'row_ceiling')
  ) {
    return results.failed > 0 ? 'error' : 'partial';
  }
  return results.failed > 0 ? 'error' : 'success';
}

/**
 * Oldest-due drain for one daily invocation. Bounded fetches, same-invocation
 * continuation, stamp/advance only via the evaluate callback. Capacity exhaustion
 * is never reported as success.
 */
export async function runSavedSearchAlertDrain(opts: {
  dueFrequencies: readonly SavedSearchAlertFrequency[];
  fetchDueBatch: FetchDueSavedSearchBatch;
  evaluate: (row: SavedSearchAlertDueRow) => Promise<SavedSearchAlertEvalCounts>;
  countRemaining: CountRemainingDueSavedSearches;
  nowMs?: () => number;
  batchSize?: number;
  rowCeiling?: number;
  timeBudgetMs?: number;
}): Promise<SavedSearchAlertDrainResult> {
  const nowMs = opts.nowMs ?? Date.now;
  const batchSize = opts.batchSize ?? SAVED_SEARCH_ALERT_BATCH_SIZE;
  const rowCeiling = opts.rowCeiling ?? SAVED_SEARCH_ALERT_ROW_CEILING;
  const timeBudgetMs = opts.timeBudgetMs ?? SAVED_SEARCH_ALERT_TIME_BUDGET_MS;
  const startedAt = nowMs();
  const excludeIds: string[] = [];

  const results: SavedSearchAlertDrainResult = {
    success: false,
    outcome: 'error',
    processed: 0,
    matched: 0,
    sendAttempts: 0,
    sent: 0,
    noMatches: 0,
    skippedNotDue: 0,
    skippedNoProfile: 0,
    failed: 0,
    remaining: null,
    batches: 0,
    stopReason: 'drained',
    failuresByClass: {},
  };

  drain: while (true) {
    const gate = shouldContinueSavedSearchDrain({
      fetchedCount: 1,
      processed: results.processed,
      rowCeiling,
      elapsedMs: nowMs() - startedAt,
      timeBudgetMs,
    });
    if (!gate.continue) {
      results.stopReason = gate.stopReason ?? 'time_budget';
      break;
    }

    const { rows, error } = await opts.fetchDueBatch({
      limit: Math.min(batchSize, rowCeiling - results.processed),
      excludeIds,
      dueFrequencies: opts.dueFrequencies,
    });

    if (error) {
      results.stopReason = 'query_failed';
      addCounts(results, { failureClass: 'saved_search_query_failed' });
      break;
    }

    const next = shouldContinueSavedSearchDrain({
      fetchedCount: rows.length,
      processed: results.processed,
      rowCeiling,
      elapsedMs: nowMs() - startedAt,
      timeBudgetMs,
    });
    if (!next.continue) {
      results.stopReason = next.stopReason ?? 'drained';
      break;
    }

    results.batches += 1;
    for (const row of rows) {
      const rowGate = shouldContinueSavedSearchDrain({
        fetchedCount: 1,
        processed: results.processed,
        rowCeiling,
        elapsedMs: nowMs() - startedAt,
        timeBudgetMs,
      });
      if (!rowGate.continue) {
        results.stopReason = rowGate.stopReason ?? 'time_budget';
        break drain;
      }

      excludeIds.push(row.id);
      results.processed += 1;
      try {
        addCounts(results, await opts.evaluate(row));
      } catch {
        addCounts(results, { failureClass: 'unexpected_schedule_error' });
      }
    }
  }

  if (results.stopReason === 'drained') {
    results.remaining = 0;
  } else {
    results.remaining = await opts.countRemaining({
      excludeIds,
      dueFrequencies: opts.dueFrequencies,
    });
  }

  results.outcome = resolveOutcome(results);
  results.success = results.outcome === 'success';
  results.errorSummary = summarizeDrain(results);
  return results;
}
