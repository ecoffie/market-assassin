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

export function buildAwardsMergeSql(input: {
  awardsTable: string;
  stagingFq: string;
  startDate: string;
  /** Write the IDV identity columns. Only true once the additive DDL has landed. */
  idvIdentityColumns?: boolean;
}): string {
  const { awardsTable, stagingFq, startDate } = input;
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
      ON T.txn_id = S.txn_id AND T.action_date >= DATE_SUB(DATE('${startDate}'), INTERVAL 2 DAY)
      WHEN MATCHED THEN UPDATE SET
        ${update}
      WHEN NOT MATCHED THEN INSERT (
        ${insertCols}
      ) VALUES (
        ${insertVals}
      )
    `;
}
