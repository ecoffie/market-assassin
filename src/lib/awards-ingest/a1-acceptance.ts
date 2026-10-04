/**
 * A1 acceptance — the executable gate for the DoD-gap re-pull (incident 2026-10-04).
 *
 * A1 re-pulls action_date 2026-01-20 → 2026-05-03 (two windows) through the existing MERGE on
 * txn_id. This module decides, from MEASURED inputs, whether the repair is accepted. The runner
 * (scripts/bq-awards-a1-acceptance.ts) does the I/O. Everything here is pure: SQL builders and
 * verdict functions, so each check is pinned by a unit test before it is ever trusted.
 *
 * READ-ONLY BY CONSTRUCTION. Every SQL builder emits a single SELECT; `assertReadOnlySql` is
 * applied by the runner before any query is sent.
 *
 * What "preserved" means here (not row counts): two tables with equal row counts can still differ
 * — an UPDATE keeps the count. Preservation is checked on CONTENT, per fiscal year, as the sum of
 * a per-row fingerprint over the 51 legacy columns (a SUM, not BIT_XOR, so duplicate rows cannot
 * cancel out), plus the row count and the exact BIGNUMERIC obligation total.
 */

import { AWARDS_LEGACY_COLUMNS } from './awards-schema';
import { DOD_AWARDING_AGENCY_CODE } from './cohort-completeness';

/**
 * A valid awarding_agency_code is 3 OR 4 digits. USASpending uses 4-digit top-tier codes for some
 * agencies (Labor 1601, Smithsonian 3300, PBGC 1602, Peace Corps 1125 …), measured consistently
 * FY2024–FY2026. Only a value that is not 3–4 digits — e.g. '97' for '097', the early-August
 * autodetect corruption — is malformed.
 */
export const VALID_AGENCY_CODE_SQL = (col = 'awarding_agency_code') => `REGEXP_CONTAINS(${col}, r'^[0-9]{3,4}$')`;

export const A1_REPAIR_FROM = '2026-01-20';
export const A1_REPAIR_TO = '2026-05-03';
/** The MERGE's target bound is `action_date >= from - 2 days`; nothing earlier can be touched. */
export const A1_MERGE_REACH_FROM = '2026-01-18';
export const A1_MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'] as const;
export const A1_HOLE_MONTHS = ['2026-02', '2026-03', '2026-04'] as const;

/** |warehouse − source| / source for DoD months. */
export const DOD_MONTH_TOLERANCE = 0.005;
/** Civilian control months (re-read by the same windows). */
export const CIVILIAN_MONTH_TOLERANCE = 0.01;
/** A hole month must be at least this share of the source, independently of the tolerance check. */
export const NOT_NEAR_ZERO_MIN_SHARE = 0.5;

export const MECH_ELEC = {
  ueis: ['LAA3W2UCHL23', 'PZNLVGANJ3U3', 'RZ53PAJUCNF4', 'TR1AV9J17C93'],
  parentPiids: ['FA850124D0002', 'FA850124D0003', 'FA850124D0004', 'FA850124D0005'],
  expectedOrders: 31,
  /** Live USASpending re-derivation, 2026-09-23 (a projection, not a measured load). */
  expectedObligations: 17_001_286,
  obligationTolerance: 0.005,
} as const;

export const LOCKHEED = {
  uei: 'XFJMYSYFJEK4',
  from: '2026-02-01',
  to: '2026-04-22',
  tolerance: 0.005,
} as const;

/** UEIs whose `recipients.total_obligated` must equal SUM(awards) after the rebuild. */
export const DERIVATIVE_SAMPLE_UEIS = ['XFJMYSYFJEK4', 'QN1BCFY7JDJ5', 'E7BEKJ4V9528'] as const;

const CLONE_ID = /^awards_clone_pre_idv_\d{8}_\d{4}$/;
export function assertCloneTableId(id: string): string {
  if (!CLONE_ID.test(id)) throw new Error(`refused: ${id} is not an awards_clone_pre_idv_YYYYMMDD_HHMM table id`);
  return id;
}

/** One statement, SELECT/WITH only. Applied by the runner to every query before it is sent. */
export function assertReadOnlySql(sql: string): void {
  const body = sql.replace(/--[^\n]*/g, '').trim();
  if (!/^(SELECT|WITH)\b/i.test(body)) throw new Error('refused: acceptance SQL must be a single SELECT');
  if (/;\s*\S/.test(body)) throw new Error('refused: acceptance SQL must be a single statement');
}

// ── SQL builders ────────────────────────────────────────────────────────────────────────────────

/** Monthly transaction counts for the A1 months, split DoD / civilian / malformed-code. */
export function monthlyCountsSql(table: string): string {
  return `
    SELECT FORMAT_DATE('%Y-%m', action_date) AS month,
      COUNTIF(awarding_agency_code = '${DOD_AWARDING_AGENCY_CODE}') AS dod,
      COUNTIF(awarding_agency_code != '${DOD_AWARDING_AGENCY_CODE}' AND ${VALID_AGENCY_CODE_SQL()}) AS civilian,
      COUNTIF(awarding_agency_code IS NULL OR NOT ${VALID_AGENCY_CODE_SQL()}) AS malformed_code
    FROM ${table}
    WHERE fiscal_year = 2026 AND action_date BETWEEN '2026-01-01' AND '2026-05-31'
    GROUP BY month`;
}

/** Malformed agency codes (NULL or not 3–4 digits) inside the MERGE's reach vs outside it (FY2026). */
export function malformedCodeSql(table: string, allow?: AcceptanceAllowances): string {
  const allowed = allow?.allowedShortCode.length ? inList(allow.allowedShortCode) : `''`;
  return `
    SELECT
      COUNTIF(action_date BETWEEN '${A1_MERGE_REACH_FROM}' AND '${A1_REPAIR_TO}' AND txn_id NOT IN (${allowed})) AS in_window,
      COUNTIF(action_date BETWEEN '${A1_MERGE_REACH_FROM}' AND '${A1_REPAIR_TO}' AND txn_id IN (${allowed})) AS allowed_in_window,
      COUNTIF(action_date NOT BETWEEN '${A1_MERGE_REACH_FROM}' AND '${A1_REPAIR_TO}') AS outside_window
    FROM ${table}
    WHERE fiscal_year = 2026 AND (awarding_agency_code IS NULL OR NOT ${VALID_AGENCY_CODE_SQL()})`;
}

function legacyRowFingerprint(alias: string): string {
  const cols = AWARDS_LEGACY_COLUMNS.map((c) => `${alias}.${c.target}`).join(', ');
  return `FARM_FINGERPRINT(TO_JSON_STRING(STRUCT(${cols})))`;
}

/**
 * Per-fiscal-year content signature over the rows A1 cannot touch: everything except FY2026 rows
 * whose action_date falls inside the MERGE's reach. Same SQL for the live table and the clone.
 */
/**
 * Exact-identity allowances (A1b). Each is a pinned list — never a tolerance or a row-count margin.
 * `preservationExcluded` = `txn_id|action_date` rows intentionally removed or source-re-dated;
 * `removedInWindow` = clone txn_ids A1b deleted on purpose; `allowedShortCode` = unresolved rows left as-is.
 */
export interface AcceptanceAllowances {
  preservationExcluded: readonly string[];
  removedInWindow: readonly string[];
  allowedShortCode: readonly string[];
}

const IDENT = /^[A-Za-z0-9_.|-]{6,140}$/;
function inList(values: readonly string[]): string {
  for (const v of values) if (!IDENT.test(v)) throw new Error(`refused: unsafe identity ${JSON.stringify(v)}`);
  return values.map((v) => `'${v}'`).join(', ');
}

export function preservationSignatureSql(table: string, allow?: AcceptanceAllowances): string {
  const excl = allow?.preservationExcluded.length
    ? `\n      AND CONCAT(t.txn_id, '|', CAST(t.action_date AS STRING)) NOT IN (${inList(allow.preservationExcluded)})`
    : '';
  return `
    SELECT t.fiscal_year AS fiscal_year,
      COUNT(*) AS row_count,
      CAST(SUM(CAST(t.obligation_amount AS BIGNUMERIC)) AS STRING) AS obligation_total,
      CAST(SUM(CAST(${legacyRowFingerprint('t')} AS BIGNUMERIC)) AS STRING) AS content_sum
    FROM ${table} t
    WHERE NOT (t.fiscal_year = 2026 AND t.action_date BETWEEN '${A1_MERGE_REACH_FROM}' AND '${A1_REPAIR_TO}')${excl}
    GROUP BY fiscal_year`;
}

/** Clone rows inside the repaired range whose txn_id is gone from live (the MERGE never deletes). */
export function lostTxnSql(live: string, clone: string, allow?: AcceptanceAllowances): string {
  const excl = allow?.removedInWindow.length ? ` AND txn_id NOT IN (${inList(allow.removedInWindow)})` : '';
  return `
    SELECT COUNT(*) AS lost
    FROM (SELECT DISTINCT txn_id FROM ${clone}
          WHERE fiscal_year = 2026 AND action_date BETWEEN '${A1_MERGE_REACH_FROM}' AND '${A1_REPAIR_TO}'${excl}) c
    LEFT JOIN (SELECT DISTINCT txn_id FROM ${live} WHERE fiscal_year = 2026) l USING (txn_id)
    WHERE l.txn_id IS NULL`;
}

/** Duplicated txn_id groups in FY2026. */
export function duplicateTxnSql(table: string): string {
  return `
    SELECT COUNT(*) AS duplicated_txn_ids, COALESCE(SUM(n - 1), 0) AS extra_rows
    FROM (SELECT txn_id, COUNT(*) AS n FROM ${table} WHERE fiscal_year = 2026 GROUP BY txn_id HAVING n > 1)`;
}

export function mechElecSql(table: string): string {
  const ueis = MECH_ELEC.ueis.map((u) => `'${u}'`).join(',');
  const piids = MECH_ELEC.parentPiids.map((p) => `'${p}'`).join(',');
  return `
    SELECT COUNT(DISTINCT IF(parent_piid IN (${piids}), award_id, NULL)) AS orders,
      CAST(SUM(IF(parent_piid IN (${piids}), CAST(obligation_amount AS BIGNUMERIC), 0)) AS STRING) AS obligations
    FROM ${table}
    WHERE recipient_uei IN (${ueis})`;
}

export function lockheedSql(table: string): string {
  return `
    SELECT CAST(SUM(CAST(obligation_amount AS BIGNUMERIC)) AS STRING) AS obligations
    FROM ${table}
    WHERE fiscal_year = 2026 AND recipient_uei = '${LOCKHEED.uei}'
      AND awarding_agency_code = '${DOD_AWARDING_AGENCY_CODE}'
      AND action_date BETWEEN '${LOCKHEED.from}' AND '${LOCKHEED.to}'`;
}

/** recipients.total_obligated vs a fresh SUM over awards, for the sample UEIs. */
export function recipientsReconcileSql(awards: string, recipients: string): string {
  const ueis = DERIVATIVE_SAMPLE_UEIS.map((u) => `'${u}'`).join(',');
  return `
    SELECT a.recipient_uei AS uei,
      CAST(a.total AS STRING) AS awards_total,
      CAST(CAST(r.total_obligated AS BIGNUMERIC) AS STRING) AS recipients_total
    FROM (SELECT recipient_uei, SUM(CAST(obligation_amount AS BIGNUMERIC)) AS total
          FROM ${awards} WHERE recipient_uei IN (${ueis}) GROUP BY recipient_uei) a
    LEFT JOIN ${recipients} r USING (recipient_uei)`;
}

// ── verdicts ────────────────────────────────────────────────────────────────────────────────────

export type CheckStatus = 'pass' | 'fail' | 'stale' | 'unmeasured';
export interface CheckResult {
  id: string;
  status: CheckStatus;
  detail: string;
}

const ratio = (a: number, b: number) => (b > 0 ? Math.abs(a - b) / b : Number.POSITIVE_INFINITY);
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

export interface MonthPair { month: string; warehouse: number | null; source: number | null }

export function checkMonthsWithinTolerance(id: string, pairs: MonthPair[], tolerance: number): CheckResult {
  const bad: string[] = [];
  const shown: string[] = [];
  for (const p of pairs) {
    if (p.warehouse === null || p.source === null || !Number.isFinite(p.warehouse) || !Number.isFinite(p.source)) {
      return { id, status: 'unmeasured', detail: `${p.month}: warehouse=${p.warehouse} source=${p.source}` };
    }
    const r = ratio(p.warehouse, p.source);
    shown.push(`${p.month} ${p.warehouse}/${p.source} (${pct(r)})`);
    if (r > tolerance) bad.push(p.month);
  }
  return bad.length
    ? { id, status: 'fail', detail: `outside ±${pct(tolerance)}: ${bad.join(', ')} — ${shown.join('; ')}` }
    : { id, status: 'pass', detail: shown.join('; ') };
}

export function checkNotNearZero(pairs: MonthPair[]): CheckResult {
  const id = 'dod_hole_months_not_near_zero';
  for (const p of pairs) {
    if (p.warehouse === null || p.source === null) return { id, status: 'unmeasured', detail: `${p.month} unmeasured` };
    if (!(p.source > 0) || p.warehouse < NOT_NEAR_ZERO_MIN_SHARE * p.source) {
      return { id, status: 'fail', detail: `${p.month}: ${p.warehouse} of ${p.source} source transactions` };
    }
  }
  return { id, status: 'pass', detail: pairs.map((p) => `${p.month} ${p.warehouse}`).join('; ') };
}

export function checkZero(id: string, value: number | null, what: string): CheckResult {
  if (value === null || !Number.isFinite(value)) return { id, status: 'unmeasured', detail: `${what}: unmeasured` };
  return value === 0 ? { id, status: 'pass', detail: `${what}: 0` } : { id, status: 'fail', detail: `${what}: ${value}` };
}

export function checkAmountWithin(id: string, actual: number | null, expected: number | null, tolerance: number): CheckResult {
  if (actual === null || expected === null || !(expected > 0)) {
    return { id, status: 'unmeasured', detail: `actual=${actual} expected=${expected}` };
  }
  const r = ratio(actual, expected);
  return { id, status: r <= tolerance ? 'pass' : 'fail', detail: `${actual.toFixed(2)} vs ${expected.toFixed(2)} (${pct(r)}, tolerance ±${pct(tolerance)})` };
}

export function checkMechElec(orders: number | null, obligations: number | null): CheckResult {
  const id = 'mech_elec_ii';
  if (orders === null || obligations === null) return { id, status: 'unmeasured', detail: 'probe failed' };
  const r = ratio(obligations, MECH_ELEC.expectedObligations);
  const ok = orders === MECH_ELEC.expectedOrders && r <= MECH_ELEC.obligationTolerance;
  return { id, status: ok ? 'pass' : 'fail', detail: `${orders} orders / $${obligations.toFixed(2)} vs ${MECH_ELEC.expectedOrders} / $${MECH_ELEC.expectedObligations} (${pct(r)})` };
}

export interface FySignature { fiscal_year: number; row_count: number; obligation_total: string; content_sum: string }

/** Every fiscal year's signature must be byte-identical between the clone and live. */
export function checkPreservation(clone: FySignature[], live: FySignature[]): CheckResult {
  const id = 'preserved_outside_repair';
  if (!clone.length || !live.length) return { id, status: 'unmeasured', detail: 'no signatures' };
  const key = (s: FySignature) => `${s.row_count}|${s.obligation_total}|${s.content_sum}`;
  const liveBy = new Map(live.map((s) => [Number(s.fiscal_year), s]));
  const cloneFys = new Set(clone.map((s) => Number(s.fiscal_year)));
  const diffs: string[] = [];
  for (const c of clone) {
    const l = liveBy.get(Number(c.fiscal_year));
    if (!l) diffs.push(`FY${c.fiscal_year} missing in live`);
    else if (key(c) !== key(l)) diffs.push(`FY${c.fiscal_year} rows ${c.row_count}→${l.row_count}, obligations ${c.obligation_total}→${l.obligation_total}, content ${c.content_sum === l.content_sum ? 'same' : 'CHANGED'}`);
  }
  for (const l of live) if (!cloneFys.has(Number(l.fiscal_year))) diffs.push(`FY${l.fiscal_year} new in live`);
  return diffs.length
    ? { id, status: 'fail', detail: diffs.join('; ') }
    : { id, status: 'pass', detail: `${clone.length} fiscal years identical (rows, BIGNUMERIC obligations, content fingerprint)` };
}

export function checkDuplicatesNotIncreased(cloneDupRows: number | null, liveDupRows: number | null): CheckResult {
  const id = 'duplicate_txn_ids_not_increased';
  if (cloneDupRows === null || liveDupRows === null) return { id, status: 'unmeasured', detail: 'probe failed' };
  return liveDupRows <= cloneDupRows
    ? { id, status: 'pass', detail: `FY2026 extra duplicate rows ${cloneDupRows} → ${liveDupRows}` }
    : { id, status: 'fail', detail: `FY2026 extra duplicate rows rose ${cloneDupRows} → ${liveDupRows}` };
}

export interface ReconcileRow { uei: string; awards_total: string | null; recipients_total: string | null }

export function checkRecipientsReconcile(rows: ReconcileRow[], rebuiltAfterLastWrite: boolean | null): CheckResult {
  const id = 'recipients_rebuilt_and_reconciled';
  if (rebuiltAfterLastWrite === null || !rows.length) return { id, status: 'unmeasured', detail: 'no metadata / rows' };
  if (!rebuiltAfterLastWrite) return { id, status: 'fail', detail: 'recipients last modified BEFORE awards — rebuild did not run after the last MERGE' };
  const bad = rows.filter((r) => r.recipients_total === null || Math.abs(Number(r.awards_total) - Number(r.recipients_total)) > 1);
  return bad.length
    ? { id, status: 'fail', detail: bad.map((r) => `${r.uei} awards ${r.awards_total} vs recipients ${r.recipients_total}`).join('; ') }
    : { id, status: 'pass', detail: `${rows.length} sample UEIs equal within $1` };
}

/** Monthly rollups are NOT rebuilt by A1 (step D). Stale is reported, never silently passed. */
export function checkRollupFreshness(tables: Array<{ table: string; lastModifiedMs: number }>, awardsLastModifiedMs: number): CheckResult {
  const id = 'rollups_rebuilt';
  const stale = tables.filter((t) => t.lastModifiedMs < awardsLastModifiedMs).map((t) => t.table);
  return stale.length
    ? { id, status: 'stale', detail: `built before the last awards write (needs step D refresh-bq-rollups): ${stale.join(', ')}` }
    : { id, status: 'pass', detail: `${tables.length} rollups built after the last awards write` };
}

export type AcceptanceVerdict = 'ACCEPTED' | 'ACCEPTED_PENDING_DERIVATIVES' | 'REJECTED' | 'UNMEASURED';

export function overallVerdict(results: CheckResult[]): AcceptanceVerdict {
  if (results.some((r) => r.status === 'fail')) return 'REJECTED';
  if (results.some((r) => r.status === 'unmeasured')) return 'UNMEASURED';
  if (results.some((r) => r.status === 'stale')) return 'ACCEPTED_PENDING_DERIVATIVES';
  return 'ACCEPTED';
}

/** Exit code: only ACCEPTED is 0; pending derivatives 2; anything unproven or failed 1. */
export function verdictExitCode(v: AcceptanceVerdict): number {
  return v === 'ACCEPTED' ? 0 : v === 'ACCEPTED_PENDING_DERIVATIVES' ? 2 : 1;
}
