/**
 * PRODUCTION awards completeness gate — the hard stop the A1 incident did not have
 * (tasks/bq-dod-awards-integrity-2026-10-04.md).
 *
 * THE BLIND SPOT. Fresh rows cannot prove historical completeness. On 2026-09-23 the warehouse held
 * 71 DoD transactions for February 2026 against 355,113 at USASpending (74 vs 403,258 in March,
 * 50 vs 398,896 in April) while MAX(action_date) was current, so the ingest published itself healthy.
 *
 * WHAT IT DOES. It reuses the existing cohort/settle/threshold rules (cohort-completeness.ts), with
 * one change: a SETTLED month is judged against what USASpending actually holds for that month, not
 * only against the warehouse's own prior year. That separation is what makes the gate safe to fail
 * production on:
 *
 *   NOT_SETTLED     the month is inside the cohort's normal publication lag (COHORT_SETTLE_DAYS). Never fails.
 *   WAREHOUSE_HOLE  settled; the source holds ≥ MIN_PRIOR_BASELINE transactions; the warehouse holds
 *                   < MIN_YOY_RATIO (40%) of them. FAILS the ingest. (Incident: 71 / 355,113.)
 *   SOURCE_LAG      settled; the warehouse is thin against its prior year, but so is the source
 *                   (the warehouse is not materially below it). Warn — coverage is incomplete AT the
 *                   source. (Incident: DoD Aug 2026 — 72 in the warehouse, 72 at USASpending.)
 *   OK              settled and not materially below the source. Small drift is informational.
 *   UNMEASURED      settled, but the source count could not be read. Fails closed, like every other
 *                   unmeasured check on this workflow: a run that cannot prove completeness is never
 *                   published healthy.
 *
 * AGENCY CODES. A federal agency code is 3 or 4 digits (Labor 1601, Smithsonian 3300). The old
 * oracle put every non-'097' code — including the malformed '97' DoD rows — in "civilian". Here a
 * malformed code is its own bucket: never DoD, never civilian. Malformed codes in the rows THIS run
 * staged fail the run (an integrity failure). Malformed rows already in the warehouse (262 known,
 * outside A1's window) are reported as debt, not cleaned and not failed — that is a separate decision.
 *
 * Pure — SQL builders and classifiers do no I/O.
 */
import {
  COHORT_SETTLE_DAYS,
  DOD_AWARDING_AGENCY_CODE,
  MIN_PRIOR_BASELINE,
  MIN_YOY_RATIO,
  type AwardsCohort,
} from './cohort-completeness';

/** A valid federal agency code: exactly 3 or 4 digits. */
export const VALID_AGENCY_CODE_RE = /^[0-9]{3,4}$/;
export const validAgencyCodeSql = (col = 'awarding_agency_code') => `REGEXP_CONTAINS(${col}, r'^[0-9]{3,4}$')`;

export type GateMonthStatus = 'NOT_SETTLED' | 'OK' | 'SOURCE_LAG' | 'WAREHOUSE_HOLE' | 'UNMEASURED';
export type GateVerdict = 'pass' | 'warn' | 'fail';

export interface WarehouseMonthRow {
  month: string;   // 'YYYY-MM'
  dod: number;
  civilian: number;
  malformed: number;
}

export interface GateMonth {
  cohort: AwardsCohort;
  month: string;
  source_count: number | null;
  warehouse_count: number;
  prior_year_warehouse: number | null;
  status: GateMonthStatus;
  reason: string;
}

export interface CompletenessGateResult {
  verdict: GateVerdict;
  months: GateMonth[];
  holes: GateMonth[];
  sourceLag: GateMonth[];
  unmeasured: GateMonth[];
  /** Malformed awarding_agency_code in the rows this run staged — an integrity FAILURE. */
  stagedMalformed: number | null;
  /** Malformed rows already in the warehouse over the 24 months read — reported debt. */
  warehouseMalformed: number;
  failures: string[];
  warnings: string[];
}

/** Warehouse counts per month over the 24 months ending `asOf`, malformed codes in their own column. */
export function buildGateWarehouseCountsSql(awardsTable: string, asOf: string): string {
  return `
    SELECT FORMAT_DATE('%Y-%m', action_date) AS month,
      COUNTIF(awarding_agency_code = '${DOD_AWARDING_AGENCY_CODE}') AS dod,
      COUNTIF(awarding_agency_code != '${DOD_AWARDING_AGENCY_CODE}' AND ${validAgencyCodeSql()}) AS civilian,
      COUNTIF(awarding_agency_code IS NULL OR NOT ${validAgencyCodeSql()}) AS malformed
    FROM ${awardsTable}
    WHERE action_date BETWEEN DATE_SUB(DATE_TRUNC(DATE('${asOf}'), MONTH), INTERVAL 24 MONTH) AND DATE('${asOf}')
    GROUP BY month
  `;
}

/** Malformed awarding agency codes among the rows this run staged (staging is all-STRING). */
export function buildStagedMalformedSql(stagingFq: string): string {
  return `
    SELECT COUNTIF(awarding_agency_code IS NULL OR NOT ${validAgencyCodeSql()}) AS malformed
    FROM \`${stagingFq}\`
    WHERE contract_transaction_unique_key IS NOT NULL AND contract_transaction_unique_key != ''
  `;
}

function monthEnd(month: string): Date {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0));
}

/** The trailing 12 months ending at `asOf`, oldest first. */
export function trailingMonths(asOf: string): string[] {
  const d = new Date(`${asOf}T00:00:00Z`);
  const out: string[] = [];
  for (let i = 11; i >= 0; i--) {
    out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  return out;
}

export function isSettled(cohort: AwardsCohort, month: string, asOf: string): boolean {
  const settledBefore = new Date(`${asOf}T00:00:00Z`).getTime() - COHORT_SETTLE_DAYS[cohort] * 86_400_000;
  return monthEnd(month).getTime() <= settledBefore;
}

/** Which (cohort, month) pairs need a source count — only settled months are ever judged. */
export function settledCohortMonths(asOf: string): Array<{ cohort: AwardsCohort; month: string }> {
  const out: Array<{ cohort: AwardsCohort; month: string }> = [];
  for (const cohort of ['dod', 'civilian'] as const) {
    for (const month of trailingMonths(asOf)) if (isSettled(cohort, month, asOf)) out.push({ cohort, month });
  }
  return out;
}

function priorYear(month: string): string {
  const [y, m] = month.split('-');
  return `${Number(y) - 1}-${m}`;
}

const fmt = (n: number | null) => (n === null ? 'unmeasured' : n.toLocaleString('en-US'));

export function classifyCompletenessGate(input: {
  asOf: string;
  warehouse: readonly WarehouseMonthRow[];
  /** `${cohort}|${month}` → source count; null/absent = unmeasured. */
  source: ReadonlyMap<string, number | null>;
  stagedMalformed: number | null;
}): CompletenessGateResult {
  const byMonth = new Map(input.warehouse.map((r) => [r.month, r]));
  const wh = (cohort: AwardsCohort, month: string): number | null => {
    const r = byMonth.get(month);
    return r ? Number(r[cohort]) || 0 : null;
  };
  const months: GateMonth[] = [];
  for (const cohort of ['dod', 'civilian'] as const) {
    for (const month of trailingMonths(input.asOf)) {
      const warehouse_count = wh(cohort, month) ?? 0;     // a month with no rows at all is 0, not skipped
      const prior = wh(cohort, priorYear(month));
      const src = input.source.has(`${cohort}|${month}`) ? input.source.get(`${cohort}|${month}`) ?? null : null;
      let status: GateMonthStatus;
      let reason: string;
      if (!isSettled(cohort, month, input.asOf)) {
        status = 'NOT_SETTLED';
        reason = `inside the ${COHORT_SETTLE_DAYS[cohort]}-day ${cohort} publication lag`;
      } else if (src === null) {
        status = 'UNMEASURED';
        reason = 'USASpending source count unavailable — completeness not proven';
      } else if (src >= MIN_PRIOR_BASELINE && warehouse_count < MIN_YOY_RATIO * src) {
        status = 'WAREHOUSE_HOLE';
        reason = `warehouse holds ${(100 * warehouse_count / src).toFixed(2)}% of the source's transactions (< ${MIN_YOY_RATIO * 100}%)`;
      } else if (prior !== null && prior >= MIN_PRIOR_BASELINE && warehouse_count < MIN_YOY_RATIO * prior) {
        status = 'SOURCE_LAG';
        reason = `thin vs prior year (${fmt(prior)}), and USASpending is equally thin — source coverage incomplete`;
      } else {
        status = 'OK';
        reason = src > 0 ? `${(100 * warehouse_count / src).toFixed(2)}% of source` : 'source and warehouse both empty';
      }
      months.push({ cohort, month, source_count: src, warehouse_count, prior_year_warehouse: prior, status, reason });
    }
  }
  const holes = months.filter((m) => m.status === 'WAREHOUSE_HOLE');
  const sourceLag = months.filter((m) => m.status === 'SOURCE_LAG');
  const unmeasured = months.filter((m) => m.status === 'UNMEASURED');
  const warehouseMalformed = input.warehouse.reduce((s, r) => s + (Number(r.malformed) || 0), 0);

  const failures: string[] = [];
  for (const h of holes) failures.push(`WAREHOUSE_HOLE ${h.cohort} ${h.month}: warehouse ${fmt(h.warehouse_count)} vs source ${fmt(h.source_count)}`);
  if (unmeasured.length) failures.push(`verification unavailable for ${unmeasured.length} settled cohort-month(s): ${unmeasured.map((m) => `${m.cohort} ${m.month}`).join(', ')}`);
  if (input.stagedMalformed === null) failures.push('INTEGRITY unmeasured: staged agency-code validation could not run');
  else if (input.stagedMalformed > 0) failures.push(`INTEGRITY: ${fmt(input.stagedMalformed)} staged row(s) carry a malformed awarding_agency_code (valid = 3 or 4 digits)`);

  const warnings: string[] = [];
  for (const s of sourceLag) warnings.push(`SOURCE_LAG ${s.cohort} ${s.month}: warehouse ${fmt(s.warehouse_count)}, source ${fmt(s.source_count)}, prior year ${fmt(s.prior_year_warehouse)}`);
  if (warehouseMalformed > 0) warnings.push(`integrity debt: ${fmt(warehouseMalformed)} warehouse row(s) in the last 24 months carry a malformed awarding_agency_code (not cleaned here)`);

  const verdict: GateVerdict = failures.length ? 'fail' : warnings.length ? 'warn' : 'pass';
  return { verdict, months, holes, sourceLag, unmeasured, stagedMalformed: input.stagedMalformed, warehouseMalformed, failures, warnings };
}

/** The workflow log: one line per judged cohort-month, then the verdict. */
export function formatCompletenessGate(r: CompletenessGateResult): string[] {
  const lines = r.months
    .filter((m) => m.status !== 'NOT_SETTLED')
    .map((m) => `completeness cohort=${m.cohort} month=${m.month} source_count=${m.source_count ?? 'unmeasured'} warehouse_count=${m.warehouse_count} status=${m.status} reason=${JSON.stringify(m.reason)}`);
  lines.push(`completeness not_settled=${r.months.filter((m) => m.status === 'NOT_SETTLED').map((m) => `${m.cohort}:${m.month}`).join(',') || '-'}`);
  lines.push(`completeness staged_malformed_agency_codes=${r.stagedMalformed ?? 'unmeasured'} warehouse_malformed_agency_codes_24mo=${r.warehouseMalformed}`);
  for (const w of r.warnings) lines.push(`completeness WARN ${w}`);
  for (const f of r.failures) lines.push(`completeness FAIL ${f}`);
  lines.push(`completeness verdict=${r.verdict.toUpperCase()}`);
  return lines;
}
