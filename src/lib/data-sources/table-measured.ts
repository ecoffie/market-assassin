/**
 * Sources whose freshness is measured from the DATA, never from a stamped
 * `data_sources.last_built`.
 *
 * Why this exists (2026-11-17): `dodaac_directory` alerted as 169 days stale while
 * its monthly producer (`refresh-dodaac-directory`, cron `0 9 6 * *`) had updated
 * 4,901 of 4,902 rows eleven days earlier. The producer never writes `last_built`,
 * so the stamp sat at its June seed value and the alert was false. A source with a
 * scheduled producer must be judged by what the producer actually wrote.
 *
 * Two measurements, because one is not enough:
 *  - AGE of the newest row: has the producer run recently?
 *  - COVERAGE: what share of rows did it touch inside the window? The DoDAAC job has
 *    a second pass (`fillDodaacGapsFromSam`) that INSERTS a handful of new offices
 *    with `updated_at = now`. On its own that would make MAX(updated_at) look fresh
 *    while the FPDS pass that refreshes every office had failed. Requiring most rows
 *    to be refreshed in the window rejects that false green.
 *
 * Unknown stays unknown: a null count or missing timestamp is `unknown`, never healthy.
 */

export type TableMeasuredSpec = {
  /** data_sources.key this replaces the stamp check for. */
  key: string;
  name: string;
  table: string;
  /** Timestamp column the producer writes on every refreshed row. */
  column: string;
  /** Window the producer must refresh within (its cadence plus grace). */
  windowDays: number;
  /** Minimum share of rows refreshed inside the window. */
  minCoverage: number;
  producer: string;
};

export const TABLE_MEASURED_SOURCES: Readonly<Record<string, TableMeasuredSpec>> = {
  dodaac_directory: {
    key: 'dodaac_directory',
    name: 'DoDAAC directory (office code → office name)',
    table: 'dodaac_directory',
    column: 'updated_at',
    // Monthly on the 6th (cron_jobs.refresh-dodaac-directory `0 9 6 * *`): 31 days + grace.
    windowDays: 40,
    // The upsert keeps offices that dropped out of FPDS (e.g. 75N9B4) un-refreshed by design,
    // so 100% is wrong; a run that refreshes fewer than 90% of rows did not really run.
    minCoverage: 0.9,
    producer: '/api/cron/refresh-dodaac-directory (monthly, 0 9 6 * *) → src/lib/gov-contacts/refresh-dodaac-directory.ts',
  },
};

export function isTableMeasured(key: string | null | undefined): boolean {
  return !!key && Object.prototype.hasOwnProperty.call(TABLE_MEASURED_SOURCES, key);
}

export type TableFreshness = {
  status: 'healthy' | 'stale' | 'partial' | 'unknown';
  ageDays: number | null;
  coverage: number | null;
  detail: string;
};

export function classifyTableFreshness(input: {
  spec: TableMeasuredSpec;
  newest: string | null | undefined;
  total: number | null | undefined;
  refreshedInWindow: number | null | undefined;
  now?: string;
}): TableFreshness {
  const { spec } = input;
  const now = Date.parse(input.now ?? new Date().toISOString());
  const newestAt = input.newest ? Date.parse(input.newest) : NaN;
  if (!Number.isFinite(newestAt) || !Number.isFinite(now)) {
    return { status: 'unknown', ageDays: null, coverage: null, detail: `no ${spec.table}.${spec.column} timestamp — cannot establish freshness` };
  }
  const ageDays = Math.round((now - newestAt) / 86_400_000);
  if (ageDays > spec.windowDays) {
    return { status: 'stale', ageDays, coverage: null, detail: `newest ${spec.column} is ${ageDays}d old (window ${spec.windowDays}d) — producer has not run: ${spec.producer}` };
  }
  const total = typeof input.total === 'number' ? input.total : null;
  const refreshed = typeof input.refreshedInWindow === 'number' ? input.refreshedInWindow : null;
  if (total === null || refreshed === null) {
    return { status: 'unknown', ageDays, coverage: null, detail: `row counts unavailable — coverage unmeasured (newest row ${ageDays}d old)` };
  }
  if (total === 0) {
    return { status: 'unknown', ageDays, coverage: null, detail: `${spec.table} is empty` };
  }
  const coverage = refreshed / total;
  const pct = (coverage * 100).toFixed(1);
  if (coverage < spec.minCoverage) {
    return {
      status: 'partial',
      ageDays,
      coverage,
      detail: `only ${refreshed} of ${total} rows (${pct}%) refreshed in ${spec.windowDays}d — below ${spec.minCoverage * 100}%; a partial pass, not a full refresh (${spec.producer})`,
    };
  }
  return { status: 'healthy', ageDays, coverage, detail: `${refreshed} of ${total} rows (${pct}%) refreshed; newest ${ageDays}d old` };
}
