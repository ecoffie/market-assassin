/**
 * C1 — ADVANCEMENT CHECK (Data Core Controls, Phase 1)
 *
 * Census trace: Phase 0A class 3 (`agency_pain_points` stamp 2026-08-01 while the
 * newest underlying row was 2026-04-19) and class 9 (a `?stamp=` endpoint that
 * sets last_built with no evidence a refresh happened). Phase 0C class 16:
 * LIVE_SYNC_CHECKS monitors 1 table out of 197.
 *
 * THE INVARIANT — job success is not data advancement.
 * A cron returning 200 proves a job ran, never that the data moved. So a dataset
 * is healthy only when the DATA's own clock advanced; a fresh run over a frozen
 * source is `upstream_stale`, and a stamp ahead of the data is `stamp_ahead`.
 *
 * Generalized from src/lib/awards-ingest/clocks.ts (the bq_awards reference, the
 * only registry entry in the whole census whose stamp matched a measured source
 * value). Deliberately NOT a copy: that module hardcodes a four-timestamp ingest
 * shape specific to the awards pipeline. Here each dataset declares its OWN
 * oracle, because the census proved the semantics differ per dataset —
 * `recompete_opportunities.period_of_performance_current_end` maxes at 2032
 * (a future contract END date), so reusing a date column blindly would read a
 * frozen table as perpetually fresh.
 *
 * UNKNOWN IS NEVER STALE. When the oracle cannot be read, the status is
 * `unmeasured` — the Phase 0D requirement that inability to verify must not be
 * reported as a stale-data claim.
 */

/** How a dataset proves it advanced. Declared per dataset — never assumed. */
export type AdvancementOracleKind =
  /** Newest business date in the source data (e.g. SAM posted_date). */
  | 'source_date'
  /** Newest successful sync/write watermark (e.g. last_synced_at). */
  | 'sync_watermark'
  /** Newest row-creation timestamp. Only where rows are append-only. */
  | 'row_watermark';

export interface AdvancementOracle {
  /** data_sources.key, or the table name when the dataset is unregistered. */
  key: string;
  /** The table whose data is inspected. */
  table: string;
  /** The column read. */
  column: string;
  kind: AdvancementOracleKind;
  /** Age (days) beyond which the DATA is considered no longer advancing. */
  staleDays: number;
  /** Why this column is the right oracle — required, so a future edit must justify itself. */
  rationale: string;
}

export type AdvancementStatus =
  | 'healthy'
  | 'upstream_stale'
  | 'ingest_broken'
  | 'stamp_ahead'
  | 'unmeasured';

export interface AdvancementResult {
  key: string;
  status: AdvancementStatus;
  /** Age in days of the dataset's own clock. Null when unmeasured. */
  dataAgeDays: number | null;
  /** Age in days of the registry stamp (data_sources.last_built). Null when absent. */
  stampAgeDays: number | null;
  /** Days the stamp sits AHEAD of the data. Positive = the class-3 defect. */
  stampAheadDays: number | null;
  /**
   * TRUE when data_sources.last_built claims currency the data does not have.
   * Deliberately INDEPENDENT of `status`: the real agency_pain_points row is BOTH
   * stale (146d vs a 120d budget) AND stamp-ahead (104d). Collapsing both into one
   * enum value would discard one real finding, so the enum reports the worse
   * operational condition and this flag always reports the claim defect.
   */
  stampAhead: boolean;
  detail: string;
}

export interface AdvancementInput {
  oracle: AdvancementOracle;
  /** Newest value of the oracle column, ISO. Null = could not be read. */
  observed: string | null;
  /** data_sources.last_built, ISO date. Null/absent = unregistered. */
  lastBuilt?: string | null;
  /**
   * Whether the producing job reported success. Provided ONLY so the control can
   * refuse to treat it as advancement — a `true` here never upgrades a status.
   */
  jobReportedSuccess?: boolean;
  now?: string;
  /** Tolerance for stamp-ahead before it is a finding (clock skew, timezone). */
  stampAheadToleranceDays?: number;
}

const DEFAULT_STAMP_AHEAD_TOLERANCE_DAYS = 2;

function ageDays(value: string, nowMs: number): number | null {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return null;
  return Math.floor((nowMs - ms) / 86_400_000);
}

/**
 * Classify one dataset's advancement.
 *
 * Order matters and encodes the census findings:
 *   1. No readable oracle        -> unmeasured  (never stale)
 *   2. Stamp ahead of the data   -> stamp_ahead (the agency_pain_points defect)
 *   3. Data older than staleDays -> upstream_stale / ingest_broken
 *   4. Otherwise                 -> healthy
 *
 * `jobReportedSuccess` is accepted and deliberately ignored for the healthy
 * decision. It is carried into `detail` so an operator can see that a job
 * succeeded while the data did not move — the exact shape a 200-based monitor
 * would have called healthy.
 */
export function classifyAdvancement(input: AdvancementInput): AdvancementResult {
  const { oracle } = input;
  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  const jobNote = input.jobReportedSuccess === true
    ? ' (job reported success — not treated as advancement)'
    : '';

  if (!input.observed) {
    return {
      key: oracle.key,
      status: 'unmeasured',
      dataAgeDays: null,
      stampAgeDays: null,
      stampAheadDays: null,
      stampAhead: false,
      detail: `${oracle.table}.${oracle.column} could not be read — unknown, NOT stale${jobNote}`,
    };
  }

  const dataAgeDays = ageDays(input.observed, nowMs);
  if (dataAgeDays === null) {
    return {
      key: oracle.key,
      status: 'unmeasured',
      dataAgeDays: null,
      stampAgeDays: null,
      stampAheadDays: null,
      stampAhead: false,
      detail: `${oracle.table}.${oracle.column} = "${input.observed}" is not a parseable date — unknown, NOT stale${jobNote}`,
    };
  }

  const stampAgeDays = input.lastBuilt ? ageDays(input.lastBuilt, nowMs) : null;
  // Stamp ahead of data: the stamp is YOUNGER (smaller age) than the data it claims to describe.
  const stampAheadDays = stampAgeDays === null ? null : dataAgeDays - stampAgeDays;
  const tolerance = input.stampAheadToleranceDays ?? DEFAULT_STAMP_AHEAD_TOLERANCE_DAYS;

  // Ordering note (learned from a failing test, not assumed): "stamp ahead of the
  // data" and "recent run over frozen data" are the SAME input shape. They are
  // separated by whether the DATA is within its own budget:
  //   - data fresh + stamp ahead  -> stamp_ahead   (the claim is the only defect)
  //   - data stale + stamp recent -> ingest_broken (the pipeline is the defect)
  // Reporting a broken ingest as a mere stamp discrepancy would understate it, so
  // the stale-data branch is evaluated FIRST.
  const stampAhead = stampAheadDays !== null && stampAheadDays > tolerance;

  // A stamp that claims currency the data lacks is the census class-3/class-9
  // defect and is the finding an operator must see first: it is the reason a
  // human believed the dataset was fresh. The stale condition is still reported
  // via dataAgeDays in the detail line, so nothing is lost.
  if (stampAhead) {
    return {
      key: oracle.key,
      status: 'stamp_ahead',
      dataAgeDays,
      stampAgeDays,
      stampAheadDays,
      stampAhead: true,
      detail:
        `registry stamp is ${stampAheadDays}d AHEAD of the data it describes `
        + `(last_built ${input.lastBuilt}, newest ${oracle.column} ${input.observed.slice(0, 10)})`
        + ` — freshness asserted without refresh evidence`
        + `${dataAgeDays > oracle.staleDays
            ? `; the data is ALSO ${dataAgeDays}d old against a ${oracle.staleDays}d budget`
            : ''}${jobNote}`,
    };
  }

  if (dataAgeDays > oracle.staleDays) {
    // A recent stamp over non-advancing data means the pipeline ran and produced
    // nothing new; no stamp at all means we only know the data stopped moving.
    const runIsRecent = stampAgeDays !== null && stampAgeDays <= oracle.staleDays;
    return {
      key: oracle.key,
      status: runIsRecent ? 'ingest_broken' : 'upstream_stale',
      dataAgeDays,
      stampAgeDays,
      stampAheadDays,
      stampAhead,
      detail:
        `${oracle.table}.${oracle.column} has not advanced in ${dataAgeDays}d `
        + `(budget ${oracle.staleDays}d)${runIsRecent ? ', while the job ran recently' : ''}`
        + `${stampAheadDays !== null && stampAheadDays > tolerance
            ? ` — and the registry stamp sits ${stampAheadDays}d ahead of it`
            : ''}${jobNote}`,
    };
  }

  return {
    key: oracle.key,
    status: 'healthy',
    dataAgeDays,
    stampAgeDays,
    stampAheadDays,
    stampAhead,
    detail: `${oracle.table}.${oracle.column} advanced ${dataAgeDays}d ago (budget ${oracle.staleDays}d)${jobNote}`,
  };
}

/**
 * The monitored set. Phase 1 covers ONLY the datasets the controls plan
 * justified; everything else is excluded on the record, with a reason.
 *
 * EXCLUDED DELIBERATELY (controls plan, "deliberate non-control"):
 *   alert_log / briefing_log / user_engagement — write-side logs of work that
 *     already happened. A dead stream surfaces first as MISSING ALERTS (a
 *     delivery symptom with its own tooling), not a stale table. Monitoring
 *     them would be vanity.
 *   sam_entities (910,126 rows) — largest table found, but P2: nothing yet shows
 *     a wrong number from it changing a decision. Size is not consequence.
 *   bq_awards — already covered by verify-oracles --only freshness.
 */
export const ADVANCEMENT_ORACLES: AdvancementOracle[] = [
  {
    key: 'sam_opportunities',
    table: 'sam_opportunities',
    column: 'posted_date',
    kind: 'source_date',
    staleDays: 3,
    rationale:
      'SAM publishes daily; posted_date is the SOURCE business date, so it advances only when '
      + 'new notices genuinely arrive. synced_at would advance on every sync even if SAM returned '
      + 'nothing — that is job execution, not data advancement.',
  },
  {
    key: 'recompete_opportunities',
    table: 'recompete_opportunities',
    column: 'last_synced_at',
    kind: 'sync_watermark',
    staleDays: 3,
    rationale:
      'Hourly USASpending sweep. period_of_performance_current_end is a FUTURE contract end date '
      + '(max 2032-07-30 as measured 2026-09-12) and would read a frozen table as perpetually '
      + 'fresh; last_synced_at is stamped per row only when that row is actually re-fetched.',
  },
  {
    key: 'agency_pain_points',
    table: 'agency_intelligence',
    column: 'created_at',
    kind: 'row_watermark',
    staleDays: 120,
    rationale:
      'Quarterly curated merge, append-only, so created_at is the real advancement clock. This is '
      + 'the census class-3 instance: data_sources.last_built said 2026-08-01 while the newest row '
      + 'was 2026-04-19 — the stamp_ahead path exists because of this dataset.',
  },
];
