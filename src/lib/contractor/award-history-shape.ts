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
  /** Lifetime distinct award_id count in the warehouse profile/history scope. */
  unique_awards: number;
  /** Machine grain for unique_awards — never obligation actions. */
  unique_awards_grain: 'distinct_awards';
  /** Sum of per-FY distinct award counts — NOT unique lifetime awards. */
  fiscal_year_award_count_sum: number;
  fiscal_year_award_count_sum_grain: 'sum_of_per_fy_distinct_awards';
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
    unique_awards_grain: 'distinct_awards',
    fiscal_year_award_count_sum,
    fiscal_year_award_count_sum_grain: 'sum_of_per_fy_distinct_awards',
    recent_actions_returned,
    recent_unique_awards,
    recent_grain: 'obligation_actions',
    note:
      'unique_awards (grain=distinct_awards) = COUNT(DISTINCT award_id) in warehouse scope — not obligation actions. ' +
      'fiscal_year_award_count_sum adds per-FY distinct-award counts and double-counts multi-year awards. ' +
      'recent_* rows are obligation actions (often modifications), not unique awards.',
  };
}

export type SetAsideCoverage = 'complete' | 'unavailable' | 'partial';

export type SetAsideScopeKind = 'profile_rollup' | 'history_single_uei';

export interface SetAsideSupportingAction {
  uei: string | null;
  award_id: string | null;
  fiscal_year: number | null;
  obligation_amount: number | null;
  action_date: string | null;
}

export interface HistoricalSetAsideRow {
  setAside?: string | null;
  /** Latest observed ACTION fiscal year for this label (may be a deobligation). */
  lastActionFy?: number | null;
  /**
   * Earliest positive-obligation ACTION fiscal year for this label.
   * A positive modification years after award creation still lands here —
   * this is NOT award origin. Absent/null when no positive action exists.
   */
  firstObservedPositiveActionFy?: number | null;
  /** UEIs that contributed award actions under this label (profile rollup may be many). */
  contributingUeis?: Array<string | null | undefined> | null;
  /** Sample supporting actions for this label (not a full census). */
  supportingActions?: Array<Partial<SetAsideSupportingAction> | null | undefined> | null;
  /**
   * @deprecated Prefer lastActionFy. Treated as last observed action FY when
   * lastActionFy is absent (legacy callers).
   */
  fiscalYear?: number | null;
}

export const NULL_FIRST_POSITIVE_NOTE =
  'A null first_observed_positive_action_fy does not prove every action was a deobligation — ' +
  'it only means no positive-obligation action was observed for that label in this warehouse scope.';

export const LAST_FY_BY_LABEL_DEPRECATION = {
  status: 'deprecated' as const,
  prefer: 'last_observed_action_fy_by_label',
  meaning:
    'Alias of last_observed_action_fy_by_label kept for compatibility. Not award origin and not certification.',
};

/** BQ ARRAY_AGG DISTINCT recipient_uei LIMIT — disclose when a label hits this. */
export const SET_ASIDE_CONTRIBUTING_UEI_SAMPLE_LIMIT = 20;

/**
 * Historical set-aside evidence from award actions — NOT current SAM certification.
 * Never infer graduation / exit reason from this alone.
 * Unknown years are null — never fiscal year 0.
 *
 * last_observed_action_fy may be a deobligation. first_observed_positive_action_fy
 * may be a later positive modification. Neither is award origin or certification.
 * Award origin stays unknown unless a dedicated origin signal is supplied.
 */
export function summarizeHistoricalSetAsides(
  rows: HistoricalSetAsideRow[],
  opts?: {
    coverage?: SetAsideCoverage;
    /** Extra scope disclosure appended to the note (e.g. sample vs census). */
    scopeNote?: string;
    /** Machine-readable profile-rollup vs history-single-UEI scope. */
    scope?: { kind: SetAsideScopeKind; uei_count: number };
    /** ARRAY_AGG LIMIT used upstream — disclose truncation against this. */
    contributingUeiSampleLimit?: number;
  },
): {
  labels: string[];
  /** Latest warehouse action FY per label (includes deobligations). */
  last_observed_action_fy_by_label: Record<string, number | null>;
  /**
   * Earliest positive-obligation action FY per label when present; else null.
   * Not award origin — a later positive mod does not create an award-origin claim.
   */
  first_observed_positive_action_fy_by_label: Record<string, number | null>;
  /**
   * @deprecated Alias of last_observed_action_fy_by_label — kept so older
   * consumers do not silently lose the field. Do not treat as award origin.
   */
  last_fy_by_label: Record<string, number | null>;
  /** Explicit deprecation marker for last_fy_by_label (compat preserved). */
  deprecated: { last_fy_by_label: typeof LAST_FY_BY_LABEL_DEPRECATION };
  /**
   * Per-label contributor UEIs. `null` = contributor evidence not established
   * (never substitute the queried UEI set). Array = warehouse-returned sample.
   */
  contributing_ueis_by_label: Record<string, string[] | null>;
  /** Labels whose contributing_ueis evidence was null/absent upstream. */
  contributing_ueis_unknown_labels: string[];
  /** ARRAY_AGG DISTINCT limit applied upstream. */
  contributing_ueis_sample_limit: number;
  /** Labels whose returned contributor sample hit the LIMIT (may be incomplete). */
  contributing_ueis_truncated_labels: string[];
  supporting_actions_by_label: Record<string, SetAsideSupportingAction[]>;
  null_first_positive_note: string;
  scope: { kind: SetAsideScopeKind; uei_count: number } | null;
  coverage: SetAsideCoverage;
  note: string;
} {
  const coverage = opts?.coverage ?? 'complete';
  const sampleLimit =
    typeof opts?.contributingUeiSampleLimit === 'number' &&
    Number.isFinite(opts.contributingUeiSampleLimit) &&
    opts.contributingUeiSampleLimit > 0
      ? Math.floor(opts.contributingUeiSampleLimit)
      : SET_ASIDE_CONTRIBUTING_UEI_SAMPLE_LIMIT;
  const lastAction: Record<string, number | null> = {};
  const firstPositive: Record<string, number | null> = {};
  const contributingKnown: Record<string, Set<string>> = {};
  const contributingUnknown = new Set<string>();
  const contributingTruncated = new Set<string>();
  const supporting: Record<string, SetAsideSupportingAction[]> = {};

  for (const row of rows) {
    const raw = String(row.setAside || '').trim();
    if (!raw || /^NO SET ASIDE/i.test(raw)) continue;
    const label = raw;

    const actionFy =
      typeof row.lastActionFy === 'number' && Number.isFinite(row.lastActionFy) && row.lastActionFy > 0
        ? row.lastActionFy
        : typeof row.fiscalYear === 'number' && Number.isFinite(row.fiscalYear) && row.fiscalYear > 0
          ? row.fiscalYear
          : null;
    if (actionFy != null) {
      const prev = lastAction[label];
      lastAction[label] = prev == null ? actionFy : Math.max(prev, actionFy);
    } else if (!(label in lastAction)) {
      lastAction[label] = null;
    }

    const positiveFy =
      typeof row.firstObservedPositiveActionFy === 'number' &&
      Number.isFinite(row.firstObservedPositiveActionFy) &&
      row.firstObservedPositiveActionFy > 0
        ? row.firstObservedPositiveActionFy
        : null;
    if (positiveFy != null) {
      const prev = firstPositive[label];
      firstPositive[label] = prev == null ? positiveFy : Math.min(prev, positiveFy);
    } else if (!(label in firstPositive)) {
      // Explicit unknown — do not copy lastActionFy into first-positive.
      firstPositive[label] = null;
    }

    // Preserve unknown contributor evidence — never invent the queried UEI set.
    if (row.contributingUeis == null) {
      if (!(label in contributingKnown)) contributingUnknown.add(label);
    } else {
      contributingUnknown.delete(label);
      const ueiSet = contributingKnown[label] ?? new Set<string>();
      let returnedCount = 0;
      for (const u of row.contributingUeis) {
        returnedCount += 1;
        const uei = String(u || '').trim().toUpperCase();
        if (uei) ueiSet.add(uei);
      }
      contributingKnown[label] = ueiSet;
      if (returnedCount >= sampleLimit || ueiSet.size >= sampleLimit) {
        contributingTruncated.add(label);
      }
    }

    const actions = supporting[label] ?? [];
    for (const a of row.supportingActions ?? []) {
      if (!a) continue;
      const uei = a.uei == null ? null : String(a.uei).trim().toUpperCase() || null;
      const awardId = a.award_id == null ? null : String(a.award_id).trim() || null;
      const fy =
        typeof a.fiscal_year === 'number' && Number.isFinite(a.fiscal_year) && a.fiscal_year > 0
          ? a.fiscal_year
          : null;
      const amount =
        typeof a.obligation_amount === 'number' && Number.isFinite(a.obligation_amount)
          ? a.obligation_amount
          : a.obligation_amount == null
            ? null
            : Number(a.obligation_amount);
      const actionDate = a.action_date == null ? null : String(a.action_date).slice(0, 10) || null;
      if (!uei && !awardId && fy == null && amount == null && !actionDate) continue;
      actions.push({
        uei,
        award_id: awardId,
        fiscal_year: fy,
        obligation_amount:
          amount == null || !Number.isFinite(amount) ? null : amount,
        action_date: actionDate,
      });
    }
    supporting[label] = actions.slice(0, 5);
  }

  const labels = Object.keys(lastAction).sort();
  const contributing: Record<string, string[] | null> = {};
  for (const label of labels) {
    if (!(label in firstPositive)) firstPositive[label] = null;
    if (!(label in supporting)) supporting[label] = [];
    if (label in contributingKnown) {
      contributing[label] = [...contributingKnown[label]].sort();
    } else {
      contributing[label] = null;
      contributingUnknown.add(label);
    }
  }

  const coverageNote =
    coverage === 'unavailable'
      ? ' Historical set-aside retrieval was unavailable — empty labels mean not retrieved, not none exist.'
      : coverage === 'partial'
        ? ' Historical set-aside retrieval was partial.'
        : '';
  const truncNote =
    contributingTruncated.size > 0
      ? ` Contributor UEI lists are sampled (limit ${sampleLimit}); truncated for: ${[...contributingTruncated].sort().join(', ')}.`
      : ` Contributor UEI lists are sampled at most ${sampleLimit} distinct UEIs per label.`;
  const unknownNote =
    contributingUnknown.size > 0
      ? ' Some labels have contributing_ueis=null (evidence not established) — the queried UEI set was not substituted.'
      : '';
  const scopeNote = opts?.scopeNote ? ` ${opts.scopeNote}` : '';
  const scope =
    opts?.scope &&
    (opts.scope.kind === 'profile_rollup' || opts.scope.kind === 'history_single_uei') &&
    Number.isFinite(opts.scope.uei_count) &&
    opts.scope.uei_count >= 0
      ? { kind: opts.scope.kind, uei_count: Math.floor(opts.scope.uei_count) }
      : null;

  return {
    labels,
    last_observed_action_fy_by_label: lastAction,
    first_observed_positive_action_fy_by_label: firstPositive,
    last_fy_by_label: lastAction,
    deprecated: { last_fy_by_label: LAST_FY_BY_LABEL_DEPRECATION },
    contributing_ueis_by_label: contributing,
    contributing_ueis_unknown_labels: [...contributingUnknown].sort(),
    contributing_ueis_sample_limit: sampleLimit,
    contributing_ueis_truncated_labels: [...contributingTruncated].sort(),
    supporting_actions_by_label: supporting,
    null_first_positive_note: NULL_FIRST_POSITIVE_NOTE,
    scope,
    coverage,
    note:
      'Historical set-aside codes observed on warehouse award actions. ' +
      'last_observed_action_fy is the latest action FY for that code (may be a deobligation). ' +
      'first_observed_positive_action_fy is the earliest positive-obligation action FY when present — ' +
      'a later positive modification is still an action FY, not award origin. ' +
      `${NULL_FIRST_POSITIVE_NOTE} ` +
      'Award origin is unknown unless a dedicated origin signal is present. ' +
      'None of these fields is current SAM certification status or a graduation/exit reason. ' +
      'last_fy_by_label is a deprecated alias of last_observed_action_fy_by_label.' +
      truncNote +
      unknownNote +
      coverageNote +
      scopeNote,
  };
}

export type CoverageIngestFreshness =
  | { status: 'healthy'; sourceAgeDays: number; runAgeDays: number }
  | { status: 'upstream_stale'; sourceAgeDays: number; runAgeDays: number }
  | { status: 'ingest_broken'; sourceAgeDays: number | null; runAgeDays: number | null }
  | { status: 'unmeasured'; sourceAgeDays: null; runAgeDays: null };

/** Coverage timestamps: recipient last action ≠ warehouse max ≠ ingest freshness. */
export function describeCoverageTimestamp(opts: {
  lastRecipientActionDate: string | null | undefined;
  warehouseMaxActionDate?: string | null;
  /** Ingest clocks from data_sources.bq_awards (missing → unknown). */
  ingest?: {
    last_built?: string | null;
    acquired_at?: string | null;
    merged_at?: string | null;
    recipients_rebuilt_at?: string | null;
    freshness?: CoverageIngestFreshness | null;
  } | null;
}): {
  last_recipient_action_date: string | null;
  last_recipient_action_meaning: string;
  warehouse_max_action_date: string | null;
  warehouse_max_action_meaning: string;
  ingest: {
    last_built: string | null;
    acquired_at: string | null;
    merged_at: string | null;
    recipients_rebuilt_at: string | null;
    freshness_status: CoverageIngestFreshness['status'] | 'unknown';
    source_age_days: number | null;
    run_age_days: number | null;
  };
  /**
   * True when warehouse max + ingest clocks are attached and classified.
   * Separate from coverage completeness — clocks ≠ exhaustive history.
   */
  freshness_evidence_available: boolean;
  /**
   * Completeness of this recipient's warehouse coverage.
   * Remains unproven even when freshness clocks are attached.
   */
  coverage_completeness: 'not_established';
  /**
   * Always false until a dedicated completeness oracle exists.
   * Do NOT set true merely because freshness clocks are present.
   */
  coverage_complete_established: false;
  coverage_complete_established_meaning: string;
  freshness_note: string;
} {
  const last = opts.lastRecipientActionDate ? String(opts.lastRecipientActionDate).slice(0, 10) : null;
  const warehouse = opts.warehouseMaxActionDate
    ? String(opts.warehouseMaxActionDate).slice(0, 10)
    : null;
  const freshness = opts.ingest?.freshness ?? null;
  const ingestAttached =
    Boolean(opts.ingest) &&
    Boolean(
      opts.ingest?.last_built ||
        opts.ingest?.acquired_at ||
        opts.ingest?.merged_at ||
        opts.ingest?.recipients_rebuilt_at ||
        (freshness && freshness.status !== 'unmeasured'),
    );
  const freshnessEvidenceAvailable =
    Boolean(warehouse) &&
    ingestAttached &&
    freshness != null &&
    freshness.status !== 'unmeasured';

  let freshnessNote: string;
  if (warehouse && ingestAttached && freshness) {
    freshnessNote =
      `Three clocks: recipient last action ${last ?? 'unknown'}; warehouse awards reach ` +
      `action_date ${warehouse}; ingest freshness=${freshness.status}. ` +
      `freshness_evidence_available=${freshnessEvidenceAvailable}. ` +
      `coverage_completeness=not_established — attached clocks do not prove this recipient's ` +
      `history is exhaustive or that warehouse coverage is complete. ` +
      `A contractor's quieter last_action_date does not mean the dataset is stale.`;
  } else if (warehouse) {
    freshnessNote =
      `Warehouse awards currently reach action_date ${warehouse}. Ingest clocks were not ` +
      `attached — freshness_evidence_available=false; coverage_completeness=not_established. ` +
      `A contractor's quieter last_action_date does not mean the dataset is stale.`;
  } else {
    freshnessNote =
      'Warehouse max action_date and ingest freshness were not attached to this payload; ' +
      'freshness_evidence_available=false; coverage_completeness=not_established. ' +
      'Do not treat last_recipient_action_date as warehouse coverage or ingest lag.';
  }

  return {
    last_recipient_action_date: last,
    last_recipient_action_meaning:
      'Most recent action_date on this recipient in the warehouse — not warehouse max action_date, ' +
      'not the ingest run date, and not proof the corpus stopped updating or is complete.',
    warehouse_max_action_date: warehouse,
    warehouse_max_action_meaning:
      'Latest action_date observed across the awards warehouse (all recipients). Missing → unknown.',
    ingest: {
      last_built: opts.ingest?.last_built ? String(opts.ingest.last_built).slice(0, 10) : null,
      acquired_at: opts.ingest?.acquired_at ?? null,
      merged_at: opts.ingest?.merged_at ?? null,
      recipients_rebuilt_at: opts.ingest?.recipients_rebuilt_at ?? null,
      freshness_status: freshness?.status ?? 'unknown',
      source_age_days: freshness?.sourceAgeDays ?? null,
      run_age_days: freshness?.runAgeDays ?? null,
    },
    freshness_evidence_available: freshnessEvidenceAvailable,
    coverage_completeness: 'not_established',
    coverage_complete_established: false,
    coverage_complete_established_meaning:
      'Always false until a dedicated completeness oracle exists. Attached freshness clocks ' +
      '(freshness_evidence_available) do NOT establish coverage completeness.',
    freshness_note: freshnessNote,
  };
}

/**
 * Classify an agency-year obligation cell. Zero net + distinct awards present is
 * zero_net_obligations — vehicle usage stays not_established without authoritative
 * award-type / unused-vehicle evidence (never boolean false-as-caveat).
 */
export function classifyAgencyYearObligations(input: {
  amount: number;
  /** COUNT(DISTINCT award_id) for this agency-year — not obligation actions. */
  count: number;
  /** Authoritative award-type / IDV codes when available on this surface. */
  awardTypeCodes?: string[] | null;
}): {
  net_amount: number;
  /** Distinct award_id count for this agency-year cell. */
  distinct_award_count: number;
  count_grain: 'distinct_awards';
  classification: 'positive_net' | 'negative_net' | 'zero_net_obligations' | 'empty';
  /** Unsupported without dedicated evidence — always null. */
  unused_vehicle: null;
  vehicle_usage: 'not_established';
  note: string | null;
} {
  const amount = Number(input.amount);
  const count = Number(input.count);
  const net = Number.isFinite(amount) ? amount : 0;
  const distinctAwards = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const types = (input.awardTypeCodes ?? [])
    .map((t) => String(t || '').trim())
    .filter(Boolean);

  const vehicleFields = {
    unused_vehicle: null as null,
    vehicle_usage: 'not_established' as const,
    count_grain: 'distinct_awards' as const,
  };

  if (distinctAwards === 0 && net === 0) {
    return {
      net_amount: 0,
      distinct_award_count: 0,
      classification: 'empty',
      note: null,
      ...vehicleFields,
    };
  }
  if (net > 0) {
    return {
      net_amount: net,
      distinct_award_count: distinctAwards,
      classification: 'positive_net',
      note: null,
      ...vehicleFields,
    };
  }
  if (net < 0) {
    return {
      net_amount: net,
      distinct_award_count: distinctAwards,
      classification: 'negative_net',
      note: 'Negative net is deobligation evidence. Vehicle usage remains not_established.',
      ...vehicleFields,
    };
  }

  // net === 0 with distinct awards
  const hasAwardTypeEvidence = types.length > 0;
  return {
    net_amount: 0,
    distinct_award_count: distinctAwards,
    classification: 'zero_net_obligations',
    note: hasAwardTypeEvidence
      ? `Zero net with ${distinctAwards} distinct award(s) and award-type evidence [${types.join(', ')}]. ` +
        'Vehicle usage remains not_established — zero-dollar rows alone are insufficient.'
      : `Zero net with ${distinctAwards} distinct award(s). Vehicle usage remains not_established — ` +
        'zero-dollar rows alone are insufficient.',
    ...vehicleFields,
  };
}

export const SHORT_TOTALS_NOTE =
  'Profile dollars may come from a parent rollup; award history is one UEI. Do not treat the two totals as the same figure.';
