/**
 * MERGE staging → awards. Staging columns are STRING; every target type is explicit here.
 *
 * The column lists are DERIVED from the canonical schema (./awards-schema.ts) — never hand-typed
 * here — so the MERGE, the additive DDL, the IDV backfill/rollback and the full rebuild
 * (build-derived.sql) cannot drift apart. See awards-schema-parity.unit.test.ts.
 */
import {
  classifyAwardsSchema,
  IDV_IDENTITY_REQUIRED,
  mergeColumns,
  mergeSelectExpr,
  type LiveAwardsColumn,
} from './awards-schema';

export { IDV_IDENTITY_COLUMNS, idvIdentitySelectExpr, type IdvIdentityColumn } from './awards-schema';

/**
 * Decide from the LIVE target schema (names AND data types) whether the MERGE may write the IDV
 * identity columns.
 *
 *   * none present            → 'absent'  (legacy 41-column MERGE) — ONLY while not required
 *   * all 7 present, typed ok → 'present'
 *   * partial                 → throws (a half-applied DDL is a config error, never worked around)
 *   * any type mismatch       → throws (e.g. ordering_period_end_date STRING instead of DATE)
 *   * a legacy column missing → throws (the MERGE would fail mid-run anyway; fail before it)
 *   * required && absent      → throws — once IDV_IDENTITY_REQUIRED is flipped, the ingest must
 *                               never silently fall back to 41 columns.
 */
export function resolveIdvIdentityColumnsMode(
  live: readonly LiveAwardsColumn[],
  opts: { required?: boolean } = {},
): 'absent' | 'present' {
  const state = classifyAwardsSchema(live, { required: opts.required ?? IDV_IDENTITY_REQUIRED });
  if (!state.ok) {
    throw new Error(`awards schema refused by the ingest: ${state.problems.join(' | ')}`);
  }
  // 'partial' is always a problem, so an ok state is exactly one of these two.
  return state.idvMode === 'present' ? 'present' : 'absent';
}

/**
 * Line layout of the legacy 41-column UPDATE / INSERT lists — kept so the generated statement is
 * BYTE-identical to the one the scheduled weekly ingest has run since #1396 (pinned by
 * __fixtures__/merge-sql-pre-1658.golden.sql). Layout is presentation only: `assertLayout` proves
 * at module load that the flattened layout IS the schema-derived column list, in order, so a
 * column added to awards-schema.ts without updating this layout fails immediately, loudly.
 */
const UPDATE_LAYOUT: readonly (readonly string[])[] = [
  ['award_id', 'piid', 'mod_number', 'parent_piid'],
  ['fiscal_year', 'action_date', 'pop_start_date', 'pop_end_date'],
  ['obligation_amount', 'total_obligated'],
  ['current_award_value', 'potential_award_value'],
  ['recipient_uei', 'recipient_name', 'parent_uei', 'parent_name'],
  ['cage_code', 'recipient_address', 'recipient_city'],
  ['recipient_state', 'recipient_zip', 'recipient_country'],
  ['awarding_agency_code', 'awarding_agency'],
  ['awarding_sub_agency_code', 'awarding_sub_agency'],
  ['awarding_office_code', 'awarding_office'],
  ['funding_agency', 'funding_office'],
  ['naics_code', 'naics_description'],
  ['psc_code', 'psc_description'],
  ['contract_pricing_type', 'set_aside'],
  ['pop_state', 'pop_city', 'pop_country', 'description'],
];
const INSERT_LAYOUT: readonly (readonly string[])[] = [
  ['txn_id', 'award_id', 'piid', 'mod_number', 'parent_piid', 'fiscal_year', 'action_date', 'pop_start_date', 'pop_end_date'],
  ['obligation_amount', 'total_obligated', 'current_award_value', 'potential_award_value'],
  ['recipient_uei', 'recipient_name', 'parent_uei', 'parent_name', 'cage_code', 'recipient_address', 'recipient_city'],
  ['recipient_state', 'recipient_zip', 'recipient_country', 'awarding_agency_code', 'awarding_agency'],
  ['awarding_sub_agency_code', 'awarding_sub_agency', 'awarding_office_code', 'awarding_office'],
  ['funding_agency', 'funding_office', 'naics_code', 'naics_description', 'psc_code', 'psc_description'],
  ['contract_pricing_type', 'set_aside', 'pop_state', 'pop_city', 'pop_country', 'description'],
];

function assertLayout(name: string, layout: readonly (readonly string[])[], expected: readonly string[]): void {
  const flat = layout.flat();
  if (flat.length !== expected.length || flat.some((c, i) => c !== expected[i])) {
    throw new Error(`merge-sql ${name} layout drifted from awards-schema.ts: layout=[${flat.join(',')}] schema=[${expected.join(',')}]`);
  }
}
const LEGACY_MERGE_TARGETS = mergeColumns({ idvIdentityColumns: false }).map((c) => c.target);
assertLayout('INSERT', INSERT_LAYOUT, LEGACY_MERGE_TARGETS);
assertLayout('UPDATE', UPDATE_LAYOUT, LEGACY_MERGE_TARGETS.filter((c) => c !== 'txn_id'));

/**
 * How the MERGE finds the existing row for a staged transaction. The identity is `txn_id`, ALWAYS,
 * wherever the row lives today — never `txn_id` + a date the source can change.
 *
 * History (A1, 2026-10-04): the ON clause was `T.txn_id = S.txn_id AND T.action_date >= start − 2d`.
 * When USASpending RE-DATED a transaction into the window, the existing row (old date, before the
 * bound) did not match, so the MERGE INSERTED a second copy: 126 stale rows / $17.23M across 9 FYs,
 * removed by A1b. The bound was added to "prune the 63M-row scan" — it never could: the table is
 * partitioned on fiscal_year, and the date-bounded and unbounded MERGEs both dry-run at 42.97 GiB.
 *
 *   * `located`   — `txn_id` + `T.fiscal_year IN (<literal FYs>)`, where the FYs are every partition
 *                   that holds ANY staged txn_id today (measured by `buildMergeLocateSql` just before).
 *                   Matches exactly the rows an unbounded `txn_id` join would, and the literal FY
 *                   list partition-prunes (dry-run: 3.86 GiB for one FY, 8.21 GiB for two).
 *                   An empty list renders `ON FALSE` — no staged key exists anywhere, every row inserts.
 *   * `unbounded` — `txn_id` alone. Full scan (42.97 GiB). Used only when an existing match has a NULL
 *                   fiscal_year, which no FY list can name.
 */
export type MergeIdentity =
  | { kind: 'located'; fiscalYears: readonly number[] }
  | { kind: 'unbounded' };

/** A fiscal year we are willing to render as a SQL literal. Anything else is a bug upstream. */
function assertFiscalYearLiteral(fy: number): number {
  if (!Number.isInteger(fy) || fy < 1990 || fy > 2100) {
    throw new Error(`merge identity: refusing fiscal_year literal ${JSON.stringify(fy)}`);
  }
  return fy;
}

function fyList(fys: readonly number[]): string {
  return [...new Set(fys.map(assertFiscalYearLiteral))].sort((a, b) => a - b).join(', ');
}

export function mergeOnClause(identity: MergeIdentity): string {
  if (identity.kind === 'unbounded') return 'T.txn_id = S.txn_id';
  if (identity.fiscalYears.length === 0) return 'FALSE';
  return `T.txn_id = S.txn_id AND T.fiscal_year IN (${fyList(identity.fiscalYears)})`;
}

export function buildAwardsMergeSql(input: {
  awardsTable: string;
  stagingFq: string;
  /** Required: there is no default identity, so no caller can fall back to a date-bounded match. */
  identity: MergeIdentity;
  /** Write the IDV identity columns. Only true once the additive DDL has landed. */
  idvIdentityColumns?: boolean;
}): string {
  const { awardsTable, stagingFq, identity } = input;
  const idvOn = input.idvIdentityColumns === true;
  const cols = mergeColumns({ idvIdentityColumns: idvOn });
  const extra = cols.slice(LEGACY_MERGE_TARGETS.length); // the IDV columns (none when off)
  const select = cols.map((c) => `          ${mergeSelectExpr(c)}`).join(',\n');
  const update = UPDATE_LAYOUT.map((line) => line.map((c) => `${c}=S.${c}`).join(', ')).join(',\n        ')
    + extra.map((c) => `,\n        ${c.target}=S.${c.target}`).join('');
  const insertCols = INSERT_LAYOUT.map((line) => line.join(', ')).join(',\n        ')
    + extra.map((c) => `, ${c.target}`).join('');
  const insertVals = INSERT_LAYOUT.map((line) => line.map((c) => `S.${c}`).join(', ')).join(',\n        ')
    + extra.map((c) => `, S.${c.target}`).join('');

  return `
      MERGE ${awardsTable} T
      USING (
        SELECT
${select}
        FROM \`${stagingFq}\`
        WHERE contract_transaction_unique_key IS NOT NULL
          AND contract_transaction_unique_key != ''
      ) S
      ON ${mergeOnClause(identity)}
      WHEN MATCHED THEN UPDATE SET
        ${update}
      WHEN NOT MATCHED THEN INSERT (
        ${insertCols}
      ) VALUES (
        ${insertVals}
      )
    `;
}

// ─── Locate → plan → transactional MERGE (the ingest's write path) ─────────────────────────────

/** The staged-key expression, identical to the MERGE's `S.txn_id` / `S.fiscal_year`. */
const STAGED_KEY_FILTER = `contract_transaction_unique_key IS NOT NULL
          AND contract_transaction_unique_key != ''`;

/**
 * ONE read-only query, ONE row: what the staged keys are, and where (which fiscal_year partitions)
 * the target already holds them. It reads `awards.txn_id` + `awards.fiscal_year` once (dry-run
 * 3.13 GiB on 66.3M rows) — the price of matching on identity instead of on a guessed date.
 */
export function buildMergeLocateSql(input: { awardsTable: string; stagingFq: string }): string {
  const txn = mergeColumns({ idvIdentityColumns: false }).find((c) => c.target === 'txn_id')!;
  const fy = mergeColumns({ idvIdentityColumns: false }).find((c) => c.target === 'fiscal_year')!;
  return `
      WITH S AS (
        SELECT ${mergeSelectExpr(txn)}, ${mergeSelectExpr(fy)}
        FROM \`${input.stagingFq}\`
        WHERE ${STAGED_KEY_FILTER}
      ),
      SA AS (
        SELECT COUNT(*) AS staged_rows, COUNT(DISTINCT txn_id) AS staged_keys,
          COUNTIF(fiscal_year IS NULL) AS staged_null_fy,
          ARRAY_AGG(DISTINCT fiscal_year IGNORE NULLS ORDER BY fiscal_year) AS staged_fys
        FROM S
      ),
      LA AS (
        SELECT COUNT(*) AS located_rows, COUNT(DISTINCT T.txn_id) AS located_keys,
          COUNTIF(T.fiscal_year IS NULL) AS located_null_fy,
          ARRAY_AGG(DISTINCT T.fiscal_year IGNORE NULLS ORDER BY T.fiscal_year) AS located_fys
        FROM ${input.awardsTable} T
        WHERE T.txn_id IN (SELECT txn_id FROM S)
      )
      SELECT * FROM SA CROSS JOIN LA
    `;
}

/** The locate row, as `bq query --format=json` returns it (numbers arrive as strings). */
export interface MergeLocateRow {
  staged_rows: number | string;
  staged_keys: number | string;
  staged_null_fy: number | string;
  staged_fys: readonly (number | string | null)[] | null;
  located_rows: number | string;
  located_keys: number | string;
  located_null_fy: number | string;
  located_fys: readonly (number | string | null)[] | null;
}

export interface MergeIdentityPlan {
  identity: MergeIdentity;
  /** Rows the staged keys must have after the MERGE, ANYWHERE in the table: every existing row kept + one per new key. */
  expectedRowsAfter: number;
  stagedKeys: number;
  locatedRows: number;
  locatedKeys: number;
}

function count(v: number | string, name: string): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`merge identity: locate field ${name}=${JSON.stringify(v)} is not a count`);
  return n;
}

function years(v: MergeLocateRow['staged_fys'], name: string): number[] {
  return (v ?? []).filter((x): x is number | string => x !== null).map((x) => assertFiscalYearLiteral(count(x, name)));
}

/**
 * Turn the locate row into the MERGE identity + the exact row count the transaction must ASSERT.
 * Refuses (throws, nothing written) when the staging table carries the same transaction key twice:
 * two staged copies of one txn_id would either fail the MERGE or INSERT a duplicate.
 */
export function planMergeIdentity(row: MergeLocateRow): MergeIdentityPlan {
  const stagedRows = count(row.staged_rows, 'staged_rows');
  const stagedKeys = count(row.staged_keys, 'staged_keys');
  const locatedRows = count(row.located_rows, 'located_rows');
  const locatedKeys = count(row.located_keys, 'located_keys');
  count(row.staged_null_fy, 'staged_null_fy');
  const locatedNullFy = count(row.located_null_fy, 'located_null_fy');
  if (stagedRows !== stagedKeys) {
    throw new Error(
      `merge identity: staging holds ${stagedRows} rows for ${stagedKeys} transaction keys — `
      + 'a duplicated source key would be merged twice; refusing the MERGE (nothing written)',
    );
  }
  if (locatedKeys > stagedKeys || locatedRows < locatedKeys) {
    throw new Error(`merge identity: inconsistent locate row ${JSON.stringify(row)}`);
  }
  const located = years(row.located_fys, 'located_fys');
  years(row.staged_fys, 'staged_fys'); // validated (a non-integer year is an upstream bug), not needed for the plan
  const identity: MergeIdentity = locatedNullFy > 0 ? { kind: 'unbounded' } : { kind: 'located', fiscalYears: located };
  return {
    identity,
    expectedRowsAfter: locatedRows + (stagedKeys - locatedKeys),
    stagedKeys,
    locatedRows,
    locatedKeys,
  };
}

export const MERGE_IDENTITY_ASSERT_MESSAGE =
  'awards MERGE identity: a staged txn_id gained a row (duplicate canonical transaction) — rolled back';

/**
 * The write the ingest executes: ONE transaction holding the identity MERGE and an ASSERT that the
 * staged keys own exactly `expectedRowsAfter` rows afterwards, counted across the WHOLE table (one
 * read of the txn_id column, ~2.6 GiB — deliberately not limited to the planned partitions, so the
 * guard does not share the plan's blind spots). Any extra row — a missed match, a writer landing
 * between locate and MERGE, a future regression of the ON clause — fails the ASSERT and BigQuery
 * rolls the whole MERGE back.
 */
export function buildAwardsMergeScript(input: {
  awardsTable: string;
  stagingFq: string;
  plan: MergeIdentityPlan;
  idvIdentityColumns?: boolean;
}): string {
  const { awardsTable, stagingFq, plan } = input;
  const merge = buildAwardsMergeSql({
    awardsTable, stagingFq, identity: plan.identity, idvIdentityColumns: input.idvIdentityColumns,
  }).trimEnd();
  const expected = count(plan.expectedRowsAfter, 'expectedRowsAfter');
  return `
      BEGIN TRANSACTION;
${merge};
      ASSERT ((
        SELECT COUNT(*) FROM ${awardsTable} T
        WHERE T.txn_id IN (
            SELECT ${mergeSelectExpr(mergeColumns({ idvIdentityColumns: false })[0])}
            FROM \`${stagingFq}\`
            WHERE ${STAGED_KEY_FILTER}
          )
      ) = ${expected})
        AS '${MERGE_IDENTITY_ASSERT_MESSAGE}';
      COMMIT TRANSACTION;
    `;
}
