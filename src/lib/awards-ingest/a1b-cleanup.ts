/**
 * A1b — bounded cleanup of the double counting the A1 DoD re-pull left behind (2026-10-04).
 *
 * A1 restored the missing DoD population, and #1815 acceptance REJECTED it for three measured reasons
 * (tasks/bq-dod-awards-integrity-2026-10-04.md). This module removes ONLY the proven populations,
 * each pinned row by row in `a1b-populations.json`:
 *
 *   F3  126 stale same-txn copies — a pre-A1 row (award_or_idv_flag IS NULL) whose txn_id now also has
 *       the A1-loaded current version. The MERGE's `T.action_date >= start − 2d` bound left the old,
 *       re-dated copy unmatched, so A1 inserted a second row.                         $17,228,795.29
 *   F1  473 short-agency-code rows (early-August autodetect, e.g. '97') whose valid twin A1 loaded
 *       (same award_id + mod_number + action_date).                                $1,641,861,025.78
 *   F1b  32 more short-code rows, each resolved individually against api.usaspending.gov:
 *       26 absent at source (award 404 AND PIID search empty), 2 mods absent from the award's complete
 *       transaction list, 4 superseded by a valid copy already in the warehouse.
 *
 * Two short-code rows stay untouched (ambiguous: one re-dated with no valid copy yet, one whose source
 * lookup returned HTTP 500 — a failed lookup is not absence). Two May-6 rows the source re-dated into the
 * repair window are kept: acceptance allows exactly those two identities, nothing generic.
 *
 * Safety: the runner first runs a READ-ONLY selection by the same predicates and refuses unless it
 * reproduces the pinned identities exactly (txn_id + fiscal_year + action_date + obligation, row for
 * row). Only then does it run one multi-statement TRANSACTION whose DELETEs are bounded by BOTH the
 * predicate AND the explicit pinned txn_id list, each followed by `ASSERT @@row_count = <n>`. Any
 * mismatch aborts the transaction (BigQuery rolls it back) — nothing partial lands.
 */
import pinned from './a1b-populations.json';

export interface PinnedRow {
  txn_id: string;
  fiscal_year: number;
  action_date: string;
  code: string;
  obligation: string;
}

export interface A1bPopulations {
  preRepairClone: string;
  f3StaleCopies: PinnedRow[];
  f1ShortCodeTwins: PinnedRow[];
  f1bResolvedShortCode: Array<PinnedRow & { disposition: 'absent_at_source' | 'mod_absent_at_source' | 'superseded' }>;
  ambiguousUntouched: Array<{ txn_id: string; action_date: string; code: string; obligation: string; reason: string }>;
  f2SourceRedated: Array<{ txn_id: string; cloneActionDate: string; obligation: string }>;
}

export const A1B: A1bPopulations = pinned as unknown as A1bPopulations;

export const A1B_EXPECTED = {
  f3: { rows: 126, obligation: '17228795.29' },
  f1: { rows: 473, obligation: '1641861025.78' },
  f1b: { rows: 32 },
} as const;

/** The repaired A1 window as it touches pre-existing short-code rows (early-August load). */
export const SHORT_CODE_WINDOW = { from: '2026-04-23', to: '2026-05-03' } as const;
const VALID_CODE = `REGEXP_CONTAINS(awarding_agency_code, r'^[0-9]{3,4}$')`;
const TXN_ID = /^[A-Za-z0-9_.-]{6,120}$/;

/** Every txn_id is checked before it is inlined into SQL (USASpending keys: letters, digits, _ . -). */
export function sqlIdList(ids: readonly string[]): string {
  if (!ids.length) throw new Error('refused: empty id list');
  for (const id of ids) if (!TXN_ID.test(id)) throw new Error(`refused: unsafe txn_id ${JSON.stringify(id)}`);
  return ids.map((id) => `'${id}'`).join(', ');
}

/** Two cents of float noise allowed on a SUM of FLOAT64 obligations; row identity is exact. */
function centsEqual(a: string | number, b: string | number): boolean {
  return Math.abs(Math.round(Number(a) * 100) - Math.round(Number(b) * 100)) <= 2;
}

// ── selection (READ-ONLY) ────────────────────────────────────────────────────────────────────────

/** The predicates that DEFINE each population, independent of the pinned list. */
export function selectionSql(awards: string): string {
  return `
    WITH a1 AS (SELECT DISTINCT txn_id FROM ${awards} WHERE fiscal_year = 2026 AND award_or_idv_flag IS NOT NULL),
    f3 AS (
      SELECT 'f3' AS pop, t.txn_id, t.fiscal_year, CAST(t.action_date AS STRING) AS action_date, t.awarding_agency_code AS code,
        CAST(CAST(t.obligation_amount AS BIGNUMERIC) AS STRING) AS obligation
      FROM ${awards} t JOIN a1 USING (txn_id) WHERE t.award_or_idv_flag IS NULL),
    short AS (
      SELECT b.* FROM ${awards} b
      WHERE b.fiscal_year = 2026 AND b.action_date BETWEEN '${SHORT_CODE_WINDOW.from}' AND '${SHORT_CODE_WINDOW.to}' AND NOT ${VALID_CODE.replace('awarding_agency_code', 'b.awarding_agency_code')}),
    f1 AS (
      SELECT 'f1' AS pop, b.txn_id, b.fiscal_year, CAST(b.action_date AS STRING), b.awarding_agency_code,
        CAST(CAST(b.obligation_amount AS BIGNUMERIC) AS STRING)
      FROM short b
      WHERE EXISTS (SELECT 1 FROM ${awards} g WHERE g.fiscal_year = 2026 AND g.award_id = b.award_id AND g.mod_number = b.mod_number
        AND g.action_date = b.action_date AND ${VALID_CODE.replace('awarding_agency_code', 'g.awarding_agency_code')} AND g.award_or_idv_flag IS NOT NULL)),
    f1b AS (
      SELECT 'f1b' AS pop, b.txn_id, b.fiscal_year, CAST(b.action_date AS STRING), b.awarding_agency_code,
        CAST(CAST(b.obligation_amount AS BIGNUMERIC) AS STRING)
      FROM short b WHERE b.txn_id IN (${sqlIdList(A1B.f1bResolvedShortCode.map((r) => r.txn_id))})),
    rest AS (
      SELECT 'short_remaining' AS pop, b.txn_id, b.fiscal_year, CAST(b.action_date AS STRING), b.awarding_agency_code,
        CAST(CAST(b.obligation_amount AS BIGNUMERIC) AS STRING)
      FROM short b
      WHERE b.txn_id NOT IN (SELECT txn_id FROM f1) AND b.txn_id NOT IN (${sqlIdList(A1B.f1bResolvedShortCode.map((r) => r.txn_id))}))
    SELECT * FROM f3 UNION ALL SELECT * FROM f1 UNION ALL SELECT * FROM f1b UNION ALL SELECT * FROM rest`;
}

export interface SelectedRow { pop: string; txn_id: string; fiscal_year: number; action_date: string; code: string; obligation: string }

const identity = (r: { txn_id: string; fiscal_year: number | string; action_date: string; obligation: string }) =>
  `${r.txn_id}|${Number(r.fiscal_year)}|${r.action_date}|${Math.round(Number(r.obligation) * 100)}`;

/**
 * The selection must reproduce the pinned populations EXACTLY: same identities (txn_id, fiscal year,
 * action date, obligation to the cent), same counts and sums; the short-code remainder must be exactly the
 * two pinned ambiguous rows. Throws with a precise diff otherwise — the cleanup never runs on a drifted set.
 */
export function verifySelection(rows: SelectedRow[]): { f3: number; f1: number; f1b: number; f3Sum: string; f1Sum: string } {
  const by = (p: string) => rows.filter((r) => r.pop === p);
  const problems: string[] = [];
  const compare = (name: string, got: SelectedRow[], want: Array<{ txn_id: string; fiscal_year: number; action_date: string; obligation: string }>) => {
    const g = new Set(got.map(identity));
    const w = new Set(want.map(identity));
    const missing = [...w].filter((x) => !g.has(x));
    const extra = [...g].filter((x) => !w.has(x));
    if (got.length !== want.length || missing.length || extra.length) {
      problems.push(`${name}: selected ${got.length}, pinned ${want.length}; missing ${missing.slice(0, 3).join(', ') || '0'}; unexpected ${extra.slice(0, 3).join(', ') || '0'}`);
    }
  };
  compare('F3', by('f3'), A1B.f3StaleCopies);
  compare('F1', by('f1'), A1B.f1ShortCodeTwins);
  compare('F1b', by('f1b'), A1B.f1bResolvedShortCode);
  const remaining = by('short_remaining').map((r) => r.txn_id).sort();
  const ambiguous = A1B.ambiguousUntouched.map((r) => r.txn_id).sort();
  if (JSON.stringify(remaining) !== JSON.stringify(ambiguous)) {
    problems.push(`short-code remainder ${JSON.stringify(remaining)} != pinned ambiguous ${JSON.stringify(ambiguous)}`);
  }
  const sum = (rs: SelectedRow[]) => rs.reduce((a, r) => a + Math.round(Number(r.obligation) * 100), 0) / 100;
  const f3Sum = sum(by('f3')).toFixed(2);
  const f1Sum = sum(by('f1')).toFixed(2);
  if (!centsEqual(f3Sum, A1B_EXPECTED.f3.obligation)) problems.push(`F3 obligation ${f3Sum} != ${A1B_EXPECTED.f3.obligation}`);
  if (!centsEqual(f1Sum, A1B_EXPECTED.f1.obligation)) problems.push(`F1 obligation ${f1Sum} != ${A1B_EXPECTED.f1.obligation}`);
  if (problems.length) throw new Error(`refused: selection does not match the pinned A1b populations — ${problems.join(' | ')}`);
  return { f3: by('f3').length, f1: by('f1').length, f1b: by('f1b').length, f3Sum, f1Sum };
}

// ── the write (one transaction) ──────────────────────────────────────────────────────────────────

/**
 * Each DELETE is bounded by its defining predicate AND the explicit pinned id list, and asserts its
 * exact row count. A failed ASSERT aborts the whole transaction.
 */
export function cleanupScript(awards: string): string {
  const f3Years = [...new Set(A1B.f3StaleCopies.map((r) => r.fiscal_year))].sort();
  for (const y of f3Years) if (!Number.isInteger(y) || y < 2015 || y > 2030) throw new Error(`refused: fiscal year ${y}`);
  return `
BEGIN TRANSACTION;

DELETE FROM ${awards}
WHERE fiscal_year IN (${f3Years.join(', ')})
  AND award_or_idv_flag IS NULL
  AND txn_id IN (${sqlIdList(A1B.f3StaleCopies.map((r) => r.txn_id))})
  AND txn_id IN (SELECT txn_id FROM ${awards} WHERE fiscal_year = 2026 AND award_or_idv_flag IS NOT NULL);
ASSERT @@row_count = ${A1B_EXPECTED.f3.rows} AS 'F3 must delete exactly ${A1B_EXPECTED.f3.rows} stale same-txn copies';

DELETE FROM ${awards}
WHERE fiscal_year = 2026
  AND action_date BETWEEN '${SHORT_CODE_WINDOW.from}' AND '${SHORT_CODE_WINDOW.to}'
  AND NOT ${VALID_CODE}
  AND award_or_idv_flag IS NULL
  AND txn_id IN (${sqlIdList(A1B.f1ShortCodeTwins.map((r) => r.txn_id))});
ASSERT @@row_count = ${A1B_EXPECTED.f1.rows} AS 'F1 must delete exactly ${A1B_EXPECTED.f1.rows} short-code twins';

DELETE FROM ${awards}
WHERE fiscal_year = 2026
  AND action_date BETWEEN '${SHORT_CODE_WINDOW.from}' AND '${SHORT_CODE_WINDOW.to}'
  AND NOT ${VALID_CODE}
  AND award_or_idv_flag IS NULL
  AND txn_id IN (${sqlIdList(A1B.f1bResolvedShortCode.map((r) => r.txn_id))});
ASSERT @@row_count = ${A1B_EXPECTED.f1b.rows} AS 'F1b must delete exactly ${A1B_EXPECTED.f1b.rows} resolved short-code rows';

COMMIT TRANSACTION;
`;
}

// ── acceptance allowances (exact identities only) ────────────────────────────────────────────────

/** `txn_id|action_date` identities the preservation check may treat as intentionally changed. */
export function preservationExclusions(): string[] {
  return [
    ...A1B.f3StaleCopies.map((r) => `${r.txn_id}|${r.action_date}`),
    ...A1B.f2SourceRedated.map((r) => `${r.txn_id}|${r.cloneActionDate}`),
  ];
}

/** Clone txn_ids inside the repaired range that A1b intentionally removed (not "lost"). */
export function intentionallyRemovedInWindow(): string[] {
  return [...A1B.f1ShortCodeTwins, ...A1B.f1bResolvedShortCode].map((r) => r.txn_id);
}

/** The only short-code rows allowed to remain in the repaired window. */
export function allowedRemainingShortCode(): string[] {
  return A1B.ambiguousUntouched.map((r) => r.txn_id);
}
