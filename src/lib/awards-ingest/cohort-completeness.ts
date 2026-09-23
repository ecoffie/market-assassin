/**
 * Cohort completeness — the SECOND derivation behind the awards freshness oracle.
 *
 * WHY. The freshness oracle asks one question: is MAX(action_date) recent? Civilian agencies
 * publish to FPDS within days, so MAX(action_date) stays fresh no matter what happens to DoD,
 * whose actions are published on a ~90-day delay. Measured 2026-09-23 in `awards`:
 *
 *   DoD (awarding_agency_code 097) transactions, week of      2026-01-19   83,949
 *                                                             2026-01-26       25
 *                                                   … every week through 2026-04-27  ≤ 837
 *                                                             2026-05-04   94,977
 *
 * ≈1.2M DoD transactions dated 2026-01-25..2026-05-03 are absent while MAX(action_date) was
 * 2026-09-18 and the oracle printed healthy. Robins Mech-Elec II showed $8,655,978 of its
 * $17,001,286 in orders because 11 of its transactions ($8,145,270) fall in that hole.
 *
 * THE CHECK. Count transactions per (cohort, calendar month) and compare each month with the same
 * month one year earlier. A month is only judged once it is old enough that the cohort's normal
 * publication lag cannot explain a shortfall (`COHORT_SETTLE_DAYS`). A settled month below
 * `MIN_YOY_RATIO` of its prior-year baseline is a HOLE. This is independent of MAX(action_date),
 * so the two derivations have to agree for the warehouse to be called complete.
 *
 * The threshold is deliberately loose: real events move volume (the Oct–Nov 2025 shutdown took
 * civilian months to 0.59–0.62 of FY2025). An ingest hole reads ~0.00.
 *
 * Pure — the SQL builder and classifier do no I/O.
 */

export type AwardsCohort = 'dod' | 'civilian';

/** DoD's toptier awarding agency code in `awards.awarding_agency_code`. */
export const DOD_AWARDING_AGENCY_CODE = '097';

/** A month is judged only after its END is this many days in the past. */
export const COHORT_SETTLE_DAYS: Record<AwardsCohort, number> = {
  // DoD publishes on a ~90-day delay; + weekly ingest cadence + USASpending processing.
  dod: 120,
  civilian: 45,
};

/** A settled month below this fraction of the same month a year earlier is a hole. */
export const MIN_YOY_RATIO = 0.4;

/** A prior-year month this small is too thin to judge (no baseline, not a pass). */
export const MIN_PRIOR_BASELINE = 1_000;

export interface CohortMonthRow {
  cohort: AwardsCohort;
  /** 'YYYY-MM' */
  month: string;
  n: number;
}

export interface CohortMonthVerdict {
  cohort: AwardsCohort;
  month: string;
  current: number;
  prior: number | null;
  ratio: number | null;
  verdict: 'ok' | 'hole' | 'not_settled' | 'no_baseline';
}

export type CohortCompleteness =
  | { status: 'complete'; judged: number; months: CohortMonthVerdict[] }
  | { status: 'incomplete'; judged: number; holes: CohortMonthVerdict[]; months: CohortMonthVerdict[] }
  | { status: 'unmeasured'; reason: string };

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthEnd(month: string): Date {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of this month
}

function priorYearMonth(month: string): string {
  const [y, m] = month.split('-');
  return `${Number(y) - 1}-${m}`;
}

/**
 * Transactions per cohort per month over the 24 months ending `asOf`. action_date is the
 * partition column, so this scans two columns of ~24 partitions-worth (~0.2 GiB measured).
 */
export function buildCohortMonthlyCountsSql(awardsTable: string, asOf: string): string {
  return `
    SELECT
      IF(awarding_agency_code = '${DOD_AWARDING_AGENCY_CODE}', 'dod', 'civilian') AS cohort,
      FORMAT_DATE('%Y-%m', action_date) AS month,
      COUNT(*) AS n
    FROM ${awardsTable}
    WHERE action_date BETWEEN DATE_SUB(DATE_TRUNC(DATE('${asOf}'), MONTH), INTERVAL 24 MONTH) AND DATE('${asOf}')
    GROUP BY cohort, month
  `;
}

/**
 * Judge every month of the trailing 12 (ending at `asOf`) for both cohorts. A month with NO rows
 * at all is present as 0, not skipped — a missing month is the strongest hole there is.
 */
export function classifyCohortCompleteness(rows: CohortMonthRow[], asOf: string): CohortCompleteness {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { status: 'unmeasured', reason: 'no monthly counts returned' };
  }
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(`${r.cohort}|${r.month}`, Number(r.n) || 0);

  const asOfDate = new Date(`${asOf}T00:00:00Z`);
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth() - i, 1));
    months.push(isoDay(d).slice(0, 7));
  }

  const verdicts: CohortMonthVerdict[] = [];
  for (const cohort of ['dod', 'civilian'] as const) {
    const settledBefore = new Date(asOfDate.getTime() - COHORT_SETTLE_DAYS[cohort] * 86_400_000);
    for (const month of months) {
      const current = counts.get(`${cohort}|${month}`) ?? 0;
      const priorRaw = counts.get(`${cohort}|${priorYearMonth(month)}`);
      const prior = priorRaw ?? null;
      const ratio = prior && prior > 0 ? current / prior : null;
      let verdict: CohortMonthVerdict['verdict'];
      if (monthEnd(month) > settledBefore) verdict = 'not_settled';
      else if (prior === null || prior < MIN_PRIOR_BASELINE) verdict = 'no_baseline';
      else verdict = (ratio ?? 0) < MIN_YOY_RATIO ? 'hole' : 'ok';
      verdicts.push({ cohort, month, current, prior, ratio, verdict });
    }
  }

  const judged = verdicts.filter((v) => v.verdict === 'ok' || v.verdict === 'hole').length;
  if (judged === 0) return { status: 'unmeasured', reason: 'no settled month has a prior-year baseline' };
  const holes = verdicts.filter((v) => v.verdict === 'hole');
  return holes.length > 0
    ? { status: 'incomplete', judged, holes, months: verdicts }
    : { status: 'complete', judged, months: verdicts };
}

/** One line per hole, for an oracle/CI log. Counts and months only — never row data. */
export function describeCohortHoles(result: CohortCompleteness): string {
  if (result.status === 'unmeasured') return `unmeasured: ${result.reason}`;
  if (result.status === 'complete') return `complete: ${result.judged} settled cohort-months judged, 0 holes`;
  return `${result.holes.length} hole(s) of ${result.judged} judged: ` + result.holes
    .map((h) => `${h.cohort} ${h.month} ${h.current.toLocaleString('en-US')} vs ${h.prior?.toLocaleString('en-US')} prior-year (${((h.ratio ?? 0) * 100).toFixed(1)}%)`)
    .join('; ');
}
