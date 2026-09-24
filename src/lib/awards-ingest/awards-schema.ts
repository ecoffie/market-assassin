/**
 * THE canonical schema of `market-assasin.usaspending.awards` — one list, every writer derives
 * from it (2026-09-23, awards schema-protection).
 *
 * Why this file exists. Four things write the shape of `awards`, and before this they each carried
 * their own copy of the column list:
 *
 *   1. the weekly MERGE           (src/lib/awards-ingest/merge-sql.ts)            — 41 columns
 *   2. the additive IDV DDL       (tasks/idv-vehicle-foundation/01-ddl-add-columns.sql)
 *   3. the IDV backfill/rollback  (tasks/idv-vehicle-foundation/02-…, 99-…)
 *   4. the full REBUILD           (scripts/usaspending-ingest/build-derived.sql)  — 51 columns,
 *                                  `CREATE OR REPLACE TABLE awards AS SELECT …`
 *
 * (4) is the dangerous one. It recreates the table from its own SELECT list, so any column added
 * by (2) that the rebuild does not select is DROPPED — with every value in it — and nothing fails.
 * Adding the 7 IDV identity columns without touching (4) would have made the next full rebuild
 * silently erase them. Parity between all four is now asserted by
 * `awards-schema-parity.unit.test.ts`, and the rebuild itself refuses to run if the live table
 * has any column outside `AWARDS_COLUMNS` (its first ASSERT).
 *
 * LIVE EVIDENCE for the 51 legacy columns (read-only INFORMATION_SCHEMA.COLUMNS, 2026-09-23,
 * dry-run 10 MiB): 51 columns, exactly this order and these data types; table partitioned
 * `RANGE_BUCKET(fiscal_year, GENERATE_ARRAY(2015, 2030, 1))` (NOT action_date), clustered
 * `recipient_uei, recipient_name`. Recorded in tasks/awards-schema-protection/live-schema-2026-09-23.json.
 */

export type AwardsColumnType = 'STRING' | 'INT64' | 'FLOAT64' | 'DATE';

export interface AwardsColumn {
  /** Column name in `awards`. */
  readonly target: string;
  /** Column name in `awards_raw` / `awards_ingest_staging` (the USASpending CSV header). */
  readonly source: string;
  /** BigQuery data type in `awards` (as INFORMATION_SCHEMA.COLUMNS.data_type reports it). */
  readonly type: AwardsColumnType;
}

/** The 51 columns live in `awards` today, in table order (ordinal_position 1..51). */
export const AWARDS_LEGACY_COLUMNS = [
  { target: 'txn_id', source: 'contract_transaction_unique_key', type: 'STRING' },
  { target: 'award_id', source: 'contract_award_unique_key', type: 'STRING' },
  { target: 'piid', source: 'award_id_piid', type: 'STRING' },
  { target: 'mod_number', source: 'modification_number', type: 'STRING' },
  { target: 'parent_piid', source: 'parent_award_id_piid', type: 'STRING' },
  { target: 'fiscal_year', source: 'action_date_fiscal_year', type: 'INT64' },
  { target: 'action_date', source: 'action_date', type: 'DATE' },
  { target: 'pop_start_date', source: 'period_of_performance_start_date', type: 'DATE' },
  { target: 'pop_end_date', source: 'period_of_performance_current_end_date', type: 'DATE' },
  { target: 'obligation_amount', source: 'federal_action_obligation', type: 'FLOAT64' },
  { target: 'total_obligated', source: 'total_dollars_obligated', type: 'FLOAT64' },
  { target: 'current_award_value', source: 'current_total_value_of_award', type: 'FLOAT64' },
  { target: 'potential_award_value', source: 'potential_total_value_of_award', type: 'FLOAT64' },
  { target: 'recipient_uei', source: 'recipient_uei', type: 'STRING' },
  { target: 'recipient_name', source: 'recipient_name', type: 'STRING' },
  { target: 'parent_uei', source: 'recipient_parent_uei', type: 'STRING' },
  { target: 'parent_name', source: 'recipient_parent_name', type: 'STRING' },
  { target: 'cage_code', source: 'cage_code', type: 'STRING' },
  { target: 'recipient_address', source: 'recipient_address_line_1', type: 'STRING' },
  { target: 'recipient_city', source: 'recipient_city_name', type: 'STRING' },
  { target: 'recipient_state', source: 'recipient_state_code', type: 'STRING' },
  { target: 'recipient_zip', source: 'recipient_zip_4_code', type: 'STRING' },
  { target: 'recipient_country', source: 'recipient_country_code', type: 'STRING' },
  { target: 'awarding_agency_code', source: 'awarding_agency_code', type: 'STRING' },
  { target: 'awarding_agency', source: 'awarding_agency_name', type: 'STRING' },
  { target: 'awarding_sub_agency_code', source: 'awarding_sub_agency_code', type: 'STRING' },
  { target: 'awarding_sub_agency', source: 'awarding_sub_agency_name', type: 'STRING' },
  { target: 'awarding_office_code', source: 'awarding_office_code', type: 'STRING' },
  { target: 'awarding_office', source: 'awarding_office_name', type: 'STRING' },
  { target: 'funding_agency', source: 'funding_agency_name', type: 'STRING' },
  { target: 'funding_office', source: 'funding_office_name', type: 'STRING' },
  { target: 'naics_code', source: 'naics_code', type: 'STRING' },
  { target: 'naics_description', source: 'naics_description', type: 'STRING' },
  { target: 'psc_code', source: 'product_or_service_code', type: 'STRING' },
  { target: 'psc_description', source: 'product_or_service_code_description', type: 'STRING' },
  { target: 'contract_pricing_type', source: 'type_of_contract_pricing', type: 'STRING' },
  { target: 'set_aside', source: 'type_of_set_aside', type: 'STRING' },
  { target: 'pop_state', source: 'primary_place_of_performance_state_code', type: 'STRING' },
  { target: 'pop_city', source: 'primary_place_of_performance_city_name', type: 'STRING' },
  { target: 'pop_country', source: 'primary_place_of_performance_country_code', type: 'STRING' },
  { target: 'description', source: 'prime_award_base_transaction_description', type: 'STRING' },
  { target: 'exec_1_name', source: 'highly_compensated_officer_1_name', type: 'STRING' },
  { target: 'exec_1_amount', source: 'highly_compensated_officer_1_amount', type: 'FLOAT64' },
  { target: 'exec_2_name', source: 'highly_compensated_officer_2_name', type: 'STRING' },
  { target: 'exec_2_amount', source: 'highly_compensated_officer_2_amount', type: 'FLOAT64' },
  { target: 'exec_3_name', source: 'highly_compensated_officer_3_name', type: 'STRING' },
  { target: 'exec_3_amount', source: 'highly_compensated_officer_3_amount', type: 'FLOAT64' },
  { target: 'exec_4_name', source: 'highly_compensated_officer_4_name', type: 'STRING' },
  { target: 'exec_4_amount', source: 'highly_compensated_officer_4_amount', type: 'FLOAT64' },
  { target: 'exec_5_name', source: 'highly_compensated_officer_5_name', type: 'STRING' },
  { target: 'exec_5_amount', source: 'highly_compensated_officer_5_amount', type: 'FLOAT64' },
] as const satisfies readonly AwardsColumn[];

/**
 * IDV vehicle-identity columns retained from the USASpending bulk CSV (2026-09-23, PR #1658).
 *
 * Every one of these is already a column of `awards_ingest_staging` (the CSV the weekly ingest
 * downloads) and of `awards_raw` (the full-archive CSV the rebuild reads). Without them `awards`
 * cannot answer "who else holds this vehicle" (no solicitation to group holders by), "until when
 * can it be ordered against" (`pop_end_date` is 0% filled on IDV rows — the IDV's end is its
 * ORDERING end, which the CSV carries as `ordering_period_end_date`) or "is this a
 * multiple-award vehicle".
 *
 * Measured in staging (load of 2026-09-20, action_date 2026-06-03..2026-09-18, 72,024 IDV
 * transaction rows): solicitation_identifier 88.4% (63,660), ordering_period_end_date 100%,
 * multiple_or_single_award_idv_code 99.98% (72,007).
 *
 * Values are per TRANSACTION, exactly as reported. The award-level value is the one on the
 * award's latest transaction (by action_date, then mod) that carries it — readers derive it; the
 * ingest never propagates a value to rows that did not report it.
 *
 * `parent_award_agency_id` completes the canonical parent id for an order:
 * `CONT_IDV_<parent_piid>_<parent_award_agency_id>` (e.g. CONT_IDV_FA850124D0005_9700).
 */
export const IDV_IDENTITY_COLUMNS = [
  { source: 'solicitation_identifier', target: 'solicitation_identifier', type: 'STRING' },
  { source: 'ordering_period_end_date', target: 'ordering_period_end_date', type: 'DATE' },
  { source: 'award_or_idv_flag', target: 'award_or_idv_flag', type: 'STRING' },
  { source: 'idv_type_code', target: 'idv_type_code', type: 'STRING' },
  { source: 'multiple_or_single_award_idv_code', target: 'multiple_or_single_award_idv_code', type: 'STRING' },
  { source: 'parent_award_agency_id', target: 'parent_award_agency_id', type: 'STRING' },
  { source: 'parent_award_single_or_multiple_code', target: 'parent_award_single_or_multiple_code', type: 'STRING' },
] as const satisfies readonly AwardsColumn[];

export type IdvIdentityColumn = (typeof IDV_IDENTITY_COLUMNS)[number]['target'];

/** All 58 columns, in the order the full rebuild creates them (legacy 51, then the 7 IDV). */
export const AWARDS_COLUMNS: readonly AwardsColumn[] = [...AWARDS_LEGACY_COLUMNS, ...IDV_IDENTITY_COLUMNS];

/**
 * Columns the weekly MERGE never writes: the FFATA executive-compensation fields are NOT in the
 * USASpending bulk-download CSV, so incremental rows leave them NULL. Only the full rebuild
 * (awards_raw carries them) populates them.
 */
export const MERGE_EXEMPT: ReadonlySet<string> = new Set([
  'exec_1_name', 'exec_1_amount', 'exec_2_name', 'exec_2_amount', 'exec_3_name',
  'exec_3_amount', 'exec_4_name', 'exec_4_amount', 'exec_5_name', 'exec_5_amount',
]);

/** Columns the weekly MERGE inserts, in order (58 − MERGE_EXEMPT when IDV is on; 41 otherwise). */
export function mergeColumns(opts: { idvIdentityColumns: boolean }): readonly AwardsColumn[] {
  const base = AWARDS_LEGACY_COLUMNS.filter((c) => !MERGE_EXEMPT.has(c.target));
  return opts.idvIdentityColumns ? [...base, ...IDV_IDENTITY_COLUMNS] : base;
}

/**
 * Must the live table carry the 7 IDV identity columns?
 *
 * FALSE until tasks/idv-vehicle-foundation/01-ddl-add-columns.sql has landed in production.
 * Flip to TRUE in the commit AFTER that DDL is applied and verified (INFORMATION_SCHEMA shows all
 * 7 with the right types). From then on the ingest REFUSES to run against a table missing them
 * (instead of silently falling back to the 41-column MERGE), post-apply verify requires ≥ 58
 * columns, and `verify:oracles --only awards-schema` enforces 58.
 */
export const IDV_IDENTITY_REQUIRED = false;

/** Partitioning / clustering of the live table (INFORMATION_SCHEMA.TABLES.ddl, 2026-09-23). */
export const AWARDS_PARTITIONING = 'RANGE_BUCKET(fiscal_year, GENERATE_ARRAY(2015, 2030, 1))';
export const AWARDS_CLUSTERING = ['recipient_uei', 'recipient_name'] as const;

/**
 * Typed projection of one IDV identity column from an all-STRING source table (staging or
 * awards_raw). Used VERBATIM by the MERGE and by build-derived.sql (asserted byte-equal).
 */
export function idvIdentitySelectExpr(col: (typeof IDV_IDENTITY_COLUMNS)[number]): string {
  // NULLIF: the CSV encodes "not reported" as an empty field; unknown stays NULL, never ''.
  return col.type === 'DATE'
    ? `SAFE_CAST(NULLIF(${col.source}, '') AS DATE) AS ${col.target}`
    : `CAST(NULLIF(${col.source}, '') AS STRING) AS ${col.target}`;
}

const IDV_TARGETS: ReadonlySet<string> = new Set(IDV_IDENTITY_COLUMNS.map((c) => c.target));

/** MERGE projection from the all-STRING staging table (legacy columns keep their historical form). */
export function mergeSelectExpr(col: AwardsColumn): string {
  if (IDV_TARGETS.has(col.target)) {
    return idvIdentitySelectExpr(col as (typeof IDV_IDENTITY_COLUMNS)[number]);
  }
  return col.type === 'STRING'
    ? `CAST(${col.source} AS STRING) AS ${col.target}`
    : `SAFE_CAST(${col.source} AS ${col.type}) AS ${col.target}`;
}

/** build-derived.sql step-1 projection from the all-STRING awards_raw (asserted by the parity test). */
export function rebuildSelectExpr(col: AwardsColumn): string {
  if (IDV_TARGETS.has(col.target)) {
    return idvIdentitySelectExpr(col as (typeof IDV_IDENTITY_COLUMNS)[number]);
  }
  if (col.type === 'STRING') return `${col.source} AS ${col.target}`;
  if (col.type === 'DATE') return `SAFE.PARSE_DATE('%Y-%m-%d', ${col.source}) AS ${col.target}`;
  return `SAFE_CAST(${col.source} AS ${col.type}) AS ${col.target}`;
}

// ─── Live-schema classification (INFORMATION_SCHEMA.COLUMNS) ────────────────────────────────

/** One row of `INFORMATION_SCHEMA.COLUMNS` for `awards`: names AND types, never names only. */
export interface LiveAwardsColumn {
  name: string;
  dataType: string;
}

/** SQL that reads the live column list + types (INFORMATION_SCHEMA; ~10 MiB billed minimum). */
export function awardsColumnsQuery(project = 'market-assasin', dataset = 'usaspending'): string {
  return `SELECT column_name, data_type FROM \`${project}.${dataset}.INFORMATION_SCHEMA.COLUMNS\` `
    + `WHERE table_name = 'awards' ORDER BY ordinal_position`;
}

export interface AwardsSchemaState {
  columnCount: number;
  /** 'present' = all 7 IDV identity columns; 'absent' = none; 'partial' = some (a config error). */
  idvMode: 'present' | 'absent' | 'partial';
  missingLegacy: string[];
  missingIdv: string[];
  /** `name: live TYPE ≠ expected TYPE` for every known column whose live type is wrong. */
  typeMismatches: string[];
  /** Live columns the canonical schema does not know — a full rebuild would DROP these. */
  unknownColumns: string[];
  required: boolean;
  /** No missing legacy, no type mismatch, not partial, and (when required) IDV present. */
  ok: boolean;
  problems: string[];
}

export function classifyAwardsSchema(
  live: readonly LiveAwardsColumn[],
  opts: { required?: boolean } = {},
): AwardsSchemaState {
  const required = opts.required ?? IDV_IDENTITY_REQUIRED;
  const byName = new Map(live.map((c) => [c.name.toLowerCase(), c.dataType.toUpperCase()]));
  const known = new Set(AWARDS_COLUMNS.map((c) => c.target));

  const missingLegacy = AWARDS_LEGACY_COLUMNS.filter((c) => !byName.has(c.target)).map((c) => c.target);
  const missingIdv = IDV_IDENTITY_COLUMNS.filter((c) => !byName.has(c.target)).map((c) => c.target);
  const typeMismatches = AWARDS_COLUMNS
    .filter((c) => byName.has(c.target) && byName.get(c.target) !== c.type)
    .map((c) => `${c.target}: live ${byName.get(c.target)} ≠ expected ${c.type}`);
  const unknownColumns = [...byName.keys()].filter((n) => !known.has(n));
  const idvMode = missingIdv.length === 0
    ? 'present'
    : missingIdv.length === IDV_IDENTITY_COLUMNS.length ? 'absent' : 'partial';

  const problems: string[] = [];
  if (missingLegacy.length) problems.push(`missing legacy column(s): ${missingLegacy.join(', ')}`);
  if (typeMismatches.length) problems.push(`type mismatch: ${typeMismatches.join('; ')}`);
  if (idvMode === 'partial') {
    problems.push(`PARTIAL IDV identity schema (missing: ${missingIdv.join(', ')}) — finish `
      + 'tasks/idv-vehicle-foundation/01-ddl-add-columns.sql');
  }
  if (required && idvMode === 'absent') {
    problems.push('IDV identity columns are REQUIRED (IDV_IDENTITY_REQUIRED=true) but absent from awards — '
      + `apply tasks/idv-vehicle-foundation/01-ddl-add-columns.sql (missing: ${missingIdv.join(', ')})`);
  }

  return {
    columnCount: live.length,
    idvMode,
    missingLegacy,
    missingIdv,
    typeMismatches,
    unknownColumns,
    required,
    ok: problems.length === 0,
    problems,
  };
}
