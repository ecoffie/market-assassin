/**
 * Pure shaping helpers for contractor award-history / profile responses.
 * Keeps counting bases, activity, and date-range honesty out of SQL mappers.
 */

export type ActivityStatus = 'active' | 'dormant' | 'deobligating' | 'unknown';

export type SeriesCoverage = 'adequate' | 'partial' | 'missing';

export type ModClassification = 'base' | 'modification' | 'unknown';

export type DateRangeAssessment = 'valid' | 'invalid' | 'unassessable';

export interface YearObligationSlice {
  fiscalYear: number;
  /** Net obligations in the FY (positive + negative). */
  totalObligations: number;
  /**
   * Sum of obligation_amount where amount > 0.
   * ABSENT (undefined) means unknown — never infer from net.
   */
  positiveObligations?: number;
  /**
   * Sum of obligation_amount where amount < 0 (≤ 0).
   * ABSENT (undefined) means unknown — never infer from net.
   */
  deobligations?: number;
  /** Distinct award_id count in this FY (not additive across years). */
  awardCount: number;
}

export interface ActivityObservationPeriod {
  reference_fy: number;
  lookback_years: number;
  window_start_fy: number;
  window_end_fy: number;
  series_coverage: SeriesCoverage;
  years_present: number[];
  years_missing: number[];
}

export interface ActivityDerived {
  last_positive_obligation_fy: number | null;
  activity_status: ActivityStatus;
  /** Plain caveat — never claims graduation, revenue, or ingest lag from this alone. */
  activity_note: string;
  /** Period-scoped observation — not an unbounded "current status" claim. */
  observation_period: ActivityObservationPeriod;
}

export interface CountingBases {
  unique_awards: number;
  /** Sum of per-FY distinct award counts — NOT unique lifetime awards. */
  fiscal_year_award_count_sum: number;
  recent_actions_returned: number;
  recent_unique_awards: number;
  recent_grain: 'obligation_actions';
  note: string;
}

/** Federal FY: Oct 1 starts the next calendar year's fiscal year. */
export function currentFederalFiscalYear(now: Date = new Date()): number {
  const y = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return month >= 10 ? y + 1 : y;
}

/**
 * Classify a modification number.
 * Only explicit `0` / `00` / `000` is base. Null/blank stays unknown —
 * the warehouse does not establish that blank means base.
 */
export function classifyModNumber(modNumber: string | null | undefined): ModClassification {
  if (modNumber == null) return 'unknown';
  const s = String(modNumber).trim();
  if (!s) return 'unknown';
  if (s === '0' || s === '00' || s === '000') return 'base';
  return 'modification';
}

/** @deprecated Prefer classifyModNumber — blank is unknown, not base. */
export function isBaseModNumber(modNumber: string | null | undefined): boolean {
  return classifyModNumber(modNumber) === 'base';
}

/**
 * true = modification, false = confirmed base (mod 0), null = unknown.
 */
export function isModificationAction(modNumber: string | null | undefined): boolean | null {
  const c = classifyModNumber(modNumber);
  if (c === 'unknown') return null;
  return c === 'modification';
}

export interface DateRangeAssessmentResult {
  assessment: DateRangeAssessment;
  /** Present when assessment is invalid; null otherwise. */
  issue: 'end_before_start' | null;
}

/**
 * Assess a PoP date range. Missing or malformed dates are unassessable —
 * never "valid".
 */
export function assessDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): DateRangeAssessmentResult {
  if (!startDate || !endDate) {
    return { assessment: 'unassessable', issue: null };
  }
  const s = String(startDate).slice(0, 10);
  const e = String(endDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) {
    return { assessment: 'unassessable', issue: null };
  }
  if (e < s) return { assessment: 'invalid', issue: 'end_before_start' };
  return { assessment: 'valid', issue: null };
}

/**
 * @deprecated Prefer assessDateRange. Returns issue code only; null means
 * either valid OR unassessable — callers must not treat null as valid.
 */
export function dateRangeIssue(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): 'end_before_start' | null {
  return assessDateRange(startDate, endDate).issue;
}

/** true / false / null(unassessable) — never true for missing dates. */
export function dateRangeValidFlag(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): boolean | null {
  const a = assessDateRange(startDate, endDate).assessment;
  if (a === 'valid') return true;
  if (a === 'invalid') return false;
  return null;
}

export function filterBlankPscList<T extends { pscCode?: string; pscDescription?: string }>(
  list: T[] | null | undefined,
): T[] {
  if (!Array.isArray(list)) return [];
  return list.filter((p) => {
    const code = String(p?.pscCode ?? '').trim();
    const desc = String(p?.pscDescription ?? '').trim();
    return code.length > 0 || desc.length > 0;
  });
}

function explicitPositive(y: YearObligationSlice): number | null {
  return typeof y.positiveObligations === 'number' && Number.isFinite(y.positiveObligations)
    ? y.positiveObligations
    : null;
}

function explicitDeobligations(y: YearObligationSlice): number | null {
  return typeof y.deobligations === 'number' && Number.isFinite(y.deobligations)
    ? y.deobligations
    : null;
}

/**
 * Period-scoped activity observation.
 *
 * - Never infers positive/deobligation components from net totals.
 * - Never claims active/dormant/deobligating unless the reference lookback
 *   window has adequate series coverage.
 * - A sole FY2020 positive row in calendar 2026 is unknown, not "active".
 */
export function deriveActivityFromSeries(
  series: YearObligationSlice[],
  opts?: { referenceFiscalYear?: number; lookbackYears?: number },
): ActivityDerived {
  const referenceFy = opts?.referenceFiscalYear ?? currentFederalFiscalYear();
  const lookback = Math.max(1, opts?.lookbackYears ?? 2);
  const windowEnd = referenceFy;
  const windowStart = referenceFy - lookback + 1;

  const byFy = new Map<number, YearObligationSlice>();
  for (const y of series) {
    if (typeof y.fiscalYear === 'number' && Number.isFinite(y.fiscalYear)) {
      byFy.set(y.fiscalYear, y);
    }
  }

  const yearsPresent: number[] = [];
  const yearsMissing: number[] = [];
  for (let fy = windowStart; fy <= windowEnd; fy++) {
    if (byFy.has(fy)) yearsPresent.push(fy);
    else yearsMissing.push(fy);
  }

  const seriesCoverage: SeriesCoverage =
    yearsMissing.length === 0 ? 'adequate' : yearsPresent.length === 0 ? 'missing' : 'partial';

  const observation_period: ActivityObservationPeriod = {
    reference_fy: referenceFy,
    lookback_years: lookback,
    window_start_fy: windowStart,
    window_end_fy: windowEnd,
    series_coverage: seriesCoverage,
    years_present: yearsPresent,
    years_missing: yearsMissing,
  };

  if (!series.length) {
    return {
      last_positive_obligation_fy: null,
      activity_status: 'unknown',
      activity_note:
        'No fiscal-year obligation series available. Current-period activity is not established.',
      observation_period,
    };
  }

  const sorted = [...series].sort((a, b) => a.fiscalYear - b.fiscalYear);
  let lastPositive: number | null = null;
  for (const y of sorted) {
    const positive = explicitPositive(y);
    if (positive != null && positive > 0) lastPositive = y.fiscalYear;
  }

  if (seriesCoverage !== 'adequate') {
    const observed =
      lastPositive == null
        ? 'No FY with an explicit positive-obligation component was found in the returned series.'
        : `Last FY with an explicit positive-obligation component in the returned series: FY${lastPositive}.`;
    return {
      last_positive_obligation_fy: lastPositive,
      activity_status: 'unknown',
      activity_note:
        `${observed} Observation window FY${windowStart}–FY${windowEnd} lacks adequate series coverage ` +
        `(missing: ${yearsMissing.join(', ') || 'n/a'}). ` +
        `Current-period activity or inactivity is not established. ` +
        `Federal obligations are not company revenue. Components are never inferred from net totals.`,
      observation_period,
    };
  }

  // Adequate coverage — classify from the reference window only.
  let windowHasPositive = false;
  let windowLatestPositive = 0;
  let windowLatestDeobligations = 0;
  let windowComponentsKnown = true;
  for (const fy of yearsPresent) {
    const y = byFy.get(fy)!;
    const positive = explicitPositive(y);
    const deob = explicitDeobligations(y);
    if (positive == null || deob == null) {
      windowComponentsKnown = false;
      break;
    }
    if (positive > 0) windowHasPositive = true;
    if (fy === windowEnd) {
      windowLatestPositive = positive;
      windowLatestDeobligations = deob;
    }
  }

  if (!windowComponentsKnown) {
    return {
      last_positive_obligation_fy: lastPositive,
      activity_status: 'unknown',
      activity_note:
        `FY${windowStart}–FY${windowEnd} rows are present but positive/deobligation components are not ` +
        `fully established (net totals alone are not used). Current-period activity is unknown. ` +
        `Federal obligations are not company revenue.`,
      observation_period,
    };
  }

  let activity_status: ActivityStatus = 'unknown';
  if (windowHasPositive) {
    activity_status = 'active';
  } else if (windowLatestDeobligations < 0 && windowLatestPositive === 0) {
    activity_status = 'deobligating';
  } else {
    activity_status = 'dormant';
  }

  const activity_note =
    `Period-scoped observation for FY${windowStart}–FY${windowEnd} (reference FY${referenceFy}): ` +
    `activity_status=${activity_status}. ` +
    (lastPositive == null
      ? 'No FY with an explicit positive-obligation component in the full series. '
      : `Last FY with an explicit positive-obligation component: FY${lastPositive}. `) +
    `Federal obligations are not company revenue. A negative net FY can still contain positive obligation actions.`;

  return { last_positive_obligation_fy: lastPositive, activity_status, activity_note, observation_period };
}

export function buildCountingBases(input: {
  uniqueAwards: number;
  series: YearObligationSlice[];
  recentActions: Array<{ awardId?: string | null }>;
}): CountingBases {
  const fiscal_year_award_count_sum = input.series.reduce(
    (sum, y) => sum + (Number(y.awardCount) || 0),
    0,
  );
  const recent_actions_returned = input.recentActions.length;
  const recent_unique_awards = new Set(
    input.recentActions.map((r) => String(r.awardId || '').trim()).filter(Boolean),
  ).size;

  return {
    unique_awards: input.uniqueAwards,
    fiscal_year_award_count_sum,
    recent_actions_returned,
    recent_unique_awards,
    recent_grain: 'obligation_actions',
    note:
      'award_count / unique_awards = distinct awards in the warehouse profile. ' +
      'Summing per-FY award counts double-counts awards with actions in multiple years. ' +
      'recent_* rows are obligation actions (often modifications), not unique awards.',
  };
}

/**
 * Historical set-aside evidence from award actions — NOT current SAM certification.
 * Never infer graduation / exit reason from this alone.
 * Unknown years are null — never fiscal year 0.
 */
export function summarizeHistoricalSetAsides(
  rows: Array<{ setAside?: string | null; fiscalYear?: number | null }>,
  opts?: { coverage?: 'complete' | 'unavailable' | 'partial' },
): {
  labels: string[];
  last_fy_by_label: Record<string, number | null>;
  coverage: 'complete' | 'unavailable' | 'partial';
  note: string;
} {
  const coverage = opts?.coverage ?? 'complete';
  const lastFy: Record<string, number | null> = {};
  for (const row of rows) {
    const raw = String(row.setAside || '').trim();
    if (!raw || /^NO SET ASIDE/i.test(raw)) continue;
    const label = raw;
    const fy = row.fiscalYear;
    if (typeof fy === 'number' && Number.isFinite(fy) && fy > 0) {
      const prev = lastFy[label];
      lastFy[label] = prev == null ? fy : Math.max(prev, fy);
    } else if (!(label in lastFy)) {
      lastFy[label] = null;
    }
  }
  const labels = Object.keys(lastFy).sort();
  const coverageNote =
    coverage === 'unavailable'
      ? ' Historical set-aside retrieval was unavailable — empty labels mean not retrieved, not none exist.'
      : coverage === 'partial'
        ? ' Historical set-aside retrieval was partial.'
        : '';
  return {
    labels,
    last_fy_by_label: lastFy,
    coverage,
    note:
      'Historical set-aside codes observed on warehouse award actions. ' +
      'This is not current SAM certification status and does not establish graduation or an exit reason.' +
      coverageNote,
  };
}

/** Coverage timestamps: recipient last action ≠ warehouse ingest freshness. */
export function describeCoverageTimestamp(opts: {
  lastRecipientActionDate: string | null | undefined;
  warehouseMaxActionDate?: string | null;
}): {
  last_recipient_action_date: string | null;
  last_recipient_action_meaning: string;
  warehouse_max_action_date: string | null;
  freshness_note: string;
} {
  const last = opts.lastRecipientActionDate ? String(opts.lastRecipientActionDate).slice(0, 10) : null;
  const warehouse = opts.warehouseMaxActionDate
    ? String(opts.warehouseMaxActionDate).slice(0, 10)
    : null;
  return {
    last_recipient_action_date: last,
    last_recipient_action_meaning:
      'Most recent action_date on this recipient in the warehouse — not the ingest run date and not proof the corpus stopped updating.',
    warehouse_max_action_date: warehouse,
    freshness_note: warehouse
      ? `Warehouse awards currently reach action_date ${warehouse}. A contractor's quieter last_action_date does not mean the dataset is stale.`
      : 'Warehouse ingest freshness was not attached to this payload; do not treat last_recipient_action_date as an ingest lag.',
  };
}

export const SHORT_TOTALS_NOTE =
  'Profile dollars may come from a parent rollup; award history is one UEI. Do not treat the two totals as the same figure.';
