/**
 * Pure shaping helpers for contractor award-history / profile responses.
 * Keeps counting bases, activity, and date-range honesty out of SQL mappers.
 */

export type ActivityStatus = 'active' | 'dormant' | 'deobligating' | 'unknown';

export interface YearObligationSlice {
  fiscalYear: number;
  /** Net obligations in the FY (positive + negative). */
  totalObligations: number;
  /** Sum of obligation_amount where amount > 0. */
  positiveObligations?: number;
  /** Sum of obligation_amount where amount < 0 (negative or zero). */
  deobligations?: number;
  /** Distinct award_id count in this FY (not additive across years). */
  awardCount: number;
}

export interface ActivityDerived {
  last_positive_obligation_fy: number | null;
  activity_status: ActivityStatus;
  /** Plain caveat — never claims graduation, revenue, or ingest lag from this alone. */
  activity_note: string;
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

/** Base award / unmodified action when mod_number is empty, 0, or "0". */
export function isBaseModNumber(modNumber: string | null | undefined): boolean {
  if (modNumber == null) return true;
  const s = String(modNumber).trim();
  if (!s) return true;
  if (s === '0' || s === '00' || s === '000') return true;
  return false;
}

export function isModificationAction(modNumber: string | null | undefined): boolean {
  return !isBaseModNumber(modNumber);
}

export function dateRangeIssue(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): 'end_before_start' | null {
  if (!startDate || !endDate) return null;
  // Compare ISO date prefixes only — preserve source strings elsewhere.
  const s = String(startDate).slice(0, 10);
  const e = String(endDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return null;
  return e < s ? 'end_before_start' : null;
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

/**
 * Activity from FY series. Prefers positiveObligations when present so a year
 * with +$1M and -$1.2M is not treated as "no positive activity".
 */
export function deriveActivityFromSeries(series: YearObligationSlice[]): ActivityDerived {
  if (!series.length) {
    return {
      last_positive_obligation_fy: null,
      activity_status: 'unknown',
      activity_note: 'No fiscal-year obligation series available.',
    };
  }
  const sorted = [...series].sort((a, b) => a.fiscalYear - b.fiscalYear);
  let lastPositive: number | null = null;
  for (const y of sorted) {
    const positive =
      typeof y.positiveObligations === 'number'
        ? y.positiveObligations
        : y.totalObligations > 0
          ? y.totalObligations
          : 0;
    if (positive > 0) lastPositive = y.fiscalYear;
  }

  const latest = sorted[sorted.length - 1];
  const latestPositive =
    typeof latest.positiveObligations === 'number'
      ? latest.positiveObligations
      : latest.totalObligations > 0
        ? latest.totalObligations
        : 0;
  const latestDeobligations =
    typeof latest.deobligations === 'number'
      ? latest.deobligations
      : latest.totalObligations < 0
        ? latest.totalObligations
        : 0;

  let activity_status: ActivityStatus = 'unknown';
  if (latestPositive > 0) {
    activity_status = 'active';
  } else if (latestDeobligations < 0 && latestPositive === 0) {
    activity_status = 'deobligating';
  } else if (lastPositive != null) {
    // No positive dollars in the latest FY that has a row — dormant relative to last positive FY.
    activity_status = 'dormant';
  }

  const activity_note =
    lastPositive == null
      ? 'No positive obligation FY found in the warehouse series. Net totals can still be negative from closeouts.'
      : `Last fiscal year with positive obligations: FY${lastPositive}. ` +
        `Federal obligations are not company revenue. ` +
        `A negative net FY can still contain positive obligation actions.`;

  return { last_positive_obligation_fy: lastPositive, activity_status, activity_note };
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
 */
export function summarizeHistoricalSetAsides(
  rows: Array<{ setAside?: string | null; fiscalYear?: number | null }>,
): {
  labels: string[];
  last_fy_by_label: Record<string, number>;
  note: string;
} {
  const lastFy: Record<string, number> = {};
  for (const row of rows) {
    const raw = String(row.setAside || '').trim();
    if (!raw || /^NO SET ASIDE/i.test(raw)) continue;
    const label = raw;
    const fy = row.fiscalYear;
    if (typeof fy === 'number' && Number.isFinite(fy)) {
      lastFy[label] = Math.max(lastFy[label] ?? 0, fy);
    } else if (!(label in lastFy)) {
      lastFy[label] = 0;
    }
  }
  const labels = Object.keys(lastFy).sort();
  return {
    labels,
    last_fy_by_label: lastFy,
    note:
      'Historical set-aside codes observed on warehouse award actions. ' +
      'This is not current SAM certification status and does not establish graduation or an exit reason.',
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
