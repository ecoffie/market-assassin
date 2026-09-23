/**
 * MERGE staging → awards. Staging columns are STRING; every target type is explicit here.
 */

/**
 * IDV vehicle-identity columns retained from the USASpending bulk CSV (2026-09-23).
 *
 * Every one of these is already a column of `awards_ingest_staging` (the CSV the weekly ingest
 * downloads) and was being DROPPED here. Without them `awards` cannot answer "who else holds
 * this vehicle" (no solicitation to group holders by), "until when can it be ordered against"
 * (`pop_end_date` is 0% filled on IDV rows — the IDV's end is its ORDERING end, which the CSV
 * carries as `ordering_period_end_date`) or "is this a multiple-award vehicle".
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
 *
 * Source column → target column (target type):
 */
export const IDV_IDENTITY_COLUMNS = [
  { source: 'solicitation_identifier', target: 'solicitation_identifier', type: 'STRING' },
  { source: 'ordering_period_end_date', target: 'ordering_period_end_date', type: 'DATE' },
  { source: 'award_or_idv_flag', target: 'award_or_idv_flag', type: 'STRING' },
  { source: 'idv_type_code', target: 'idv_type_code', type: 'STRING' },
  { source: 'multiple_or_single_award_idv_code', target: 'multiple_or_single_award_idv_code', type: 'STRING' },
  { source: 'parent_award_agency_id', target: 'parent_award_agency_id', type: 'STRING' },
  { source: 'parent_award_single_or_multiple_code', target: 'parent_award_single_or_multiple_code', type: 'STRING' },
] as const;

export type IdvIdentityColumn = (typeof IDV_IDENTITY_COLUMNS)[number]['target'];

/** Typed projection of one retained column from the all-STRING staging table. */
export function idvIdentitySelectExpr(col: (typeof IDV_IDENTITY_COLUMNS)[number]): string {
  // NULLIF: the CSV encodes "not reported" as an empty field; unknown stays NULL, never ''.
  return col.type === 'DATE'
    ? `SAFE_CAST(NULLIF(${col.source}, '') AS DATE) AS ${col.target}`
    : `CAST(NULLIF(${col.source}, '') AS STRING) AS ${col.target}`;
}

/**
 * Decide from the LIVE target schema whether the MERGE may write the identity columns.
 * The MERGE must not reference a column the DDL has not added yet (that fails the weekly run),
 * and a PARTIAL DDL is a configuration error, not something to silently work around.
 */
export function resolveIdvIdentityColumnsMode(awardsColumns: string[]): 'absent' | 'present' {
  const have = new Set(awardsColumns.map((c) => c.toLowerCase()));
  const present = IDV_IDENTITY_COLUMNS.filter((c) => have.has(c.target));
  if (present.length === 0) return 'absent';
  if (present.length === IDV_IDENTITY_COLUMNS.length) return 'present';
  const missing = IDV_IDENTITY_COLUMNS.filter((c) => !have.has(c.target)).map((c) => c.target);
  throw new Error(`awards has a PARTIAL IDV identity schema (missing: ${missing.join(', ')}) — `
    + 'finish tasks/idv-vehicle-foundation/01-ddl-add-columns.sql before the next ingest');
}

export function buildAwardsMergeSql(input: {
  awardsTable: string;
  stagingFq: string;
  startDate: string;
  /** Write the IDV identity columns. Only true once the additive DDL has landed. */
  idvIdentityColumns?: boolean;
}): string {
  const { awardsTable, stagingFq, startDate } = input;
  const idv = input.idvIdentityColumns === true ? IDV_IDENTITY_COLUMNS : [];
  const idvSelect = idv.map((c) => `,\n          ${idvIdentitySelectExpr(c)}`).join('');
  const idvUpdate = idv.map((c) => `,\n        ${c.target}=S.${c.target}`).join('');
  const idvInsertCols = idv.map((c) => `, ${c.target}`).join('');
  const idvInsertVals = idv.map((c) => `, S.${c.target}`).join('');

  return `
      MERGE ${awardsTable} T
      USING (
        SELECT
          CAST(contract_transaction_unique_key AS STRING) AS txn_id,
          CAST(contract_award_unique_key AS STRING) AS award_id,
          CAST(award_id_piid AS STRING) AS piid,
          CAST(modification_number AS STRING) AS mod_number,
          CAST(parent_award_id_piid AS STRING) AS parent_piid,
          SAFE_CAST(action_date_fiscal_year AS INT64) AS fiscal_year,
          SAFE_CAST(action_date AS DATE) AS action_date,
          SAFE_CAST(period_of_performance_start_date AS DATE) AS pop_start_date,
          SAFE_CAST(period_of_performance_current_end_date AS DATE) AS pop_end_date,
          SAFE_CAST(federal_action_obligation AS FLOAT64) AS obligation_amount,
          SAFE_CAST(total_dollars_obligated AS FLOAT64) AS total_obligated,
          SAFE_CAST(current_total_value_of_award AS FLOAT64) AS current_award_value,
          SAFE_CAST(potential_total_value_of_award AS FLOAT64) AS potential_award_value,
          CAST(recipient_uei AS STRING) AS recipient_uei,
          CAST(recipient_name AS STRING) AS recipient_name,
          CAST(recipient_parent_uei AS STRING) AS parent_uei,
          CAST(recipient_parent_name AS STRING) AS parent_name,
          CAST(cage_code AS STRING) AS cage_code,
          CAST(recipient_address_line_1 AS STRING) AS recipient_address,
          CAST(recipient_city_name AS STRING) AS recipient_city,
          CAST(recipient_state_code AS STRING) AS recipient_state,
          CAST(recipient_zip_4_code AS STRING) AS recipient_zip,
          CAST(recipient_country_code AS STRING) AS recipient_country,
          CAST(awarding_agency_code AS STRING) AS awarding_agency_code,
          CAST(awarding_agency_name AS STRING) AS awarding_agency,
          CAST(awarding_sub_agency_code AS STRING) AS awarding_sub_agency_code,
          CAST(awarding_sub_agency_name AS STRING) AS awarding_sub_agency,
          CAST(awarding_office_code AS STRING) AS awarding_office_code,
          CAST(awarding_office_name AS STRING) AS awarding_office,
          CAST(funding_agency_name AS STRING) AS funding_agency,
          CAST(funding_office_name AS STRING) AS funding_office,
          CAST(naics_code AS STRING) AS naics_code,
          CAST(naics_description AS STRING) AS naics_description,
          CAST(product_or_service_code AS STRING) AS psc_code,
          CAST(product_or_service_code_description AS STRING) AS psc_description,
          CAST(type_of_contract_pricing AS STRING) AS contract_pricing_type,
          CAST(type_of_set_aside AS STRING) AS set_aside,
          CAST(primary_place_of_performance_state_code AS STRING) AS pop_state,
          CAST(primary_place_of_performance_city_name AS STRING) AS pop_city,
          CAST(primary_place_of_performance_country_code AS STRING) AS pop_country,
          CAST(prime_award_base_transaction_description AS STRING) AS description${idvSelect}
        FROM \`${stagingFq}\`
        WHERE contract_transaction_unique_key IS NOT NULL
          AND contract_transaction_unique_key != ''
      ) S
      ON T.txn_id = S.txn_id AND T.action_date >= DATE_SUB(DATE('${startDate}'), INTERVAL 2 DAY)
      WHEN MATCHED THEN UPDATE SET
        award_id=S.award_id, piid=S.piid, mod_number=S.mod_number, parent_piid=S.parent_piid,
        fiscal_year=S.fiscal_year, action_date=S.action_date, pop_start_date=S.pop_start_date, pop_end_date=S.pop_end_date,
        obligation_amount=S.obligation_amount, total_obligated=S.total_obligated,
        current_award_value=S.current_award_value, potential_award_value=S.potential_award_value,
        recipient_uei=S.recipient_uei, recipient_name=S.recipient_name, parent_uei=S.parent_uei, parent_name=S.parent_name,
        cage_code=S.cage_code, recipient_address=S.recipient_address, recipient_city=S.recipient_city,
        recipient_state=S.recipient_state, recipient_zip=S.recipient_zip, recipient_country=S.recipient_country,
        awarding_agency_code=S.awarding_agency_code, awarding_agency=S.awarding_agency,
        awarding_sub_agency_code=S.awarding_sub_agency_code, awarding_sub_agency=S.awarding_sub_agency,
        awarding_office_code=S.awarding_office_code, awarding_office=S.awarding_office,
        funding_agency=S.funding_agency, funding_office=S.funding_office,
        naics_code=S.naics_code, naics_description=S.naics_description,
        psc_code=S.psc_code, psc_description=S.psc_description,
        contract_pricing_type=S.contract_pricing_type, set_aside=S.set_aside,
        pop_state=S.pop_state, pop_city=S.pop_city, pop_country=S.pop_country, description=S.description${idvUpdate}
      WHEN NOT MATCHED THEN INSERT (
        txn_id, award_id, piid, mod_number, parent_piid, fiscal_year, action_date, pop_start_date, pop_end_date,
        obligation_amount, total_obligated, current_award_value, potential_award_value,
        recipient_uei, recipient_name, parent_uei, parent_name, cage_code, recipient_address, recipient_city,
        recipient_state, recipient_zip, recipient_country, awarding_agency_code, awarding_agency,
        awarding_sub_agency_code, awarding_sub_agency, awarding_office_code, awarding_office,
        funding_agency, funding_office, naics_code, naics_description, psc_code, psc_description,
        contract_pricing_type, set_aside, pop_state, pop_city, pop_country, description${idvInsertCols}
      ) VALUES (
        S.txn_id, S.award_id, S.piid, S.mod_number, S.parent_piid, S.fiscal_year, S.action_date, S.pop_start_date, S.pop_end_date,
        S.obligation_amount, S.total_obligated, S.current_award_value, S.potential_award_value,
        S.recipient_uei, S.recipient_name, S.parent_uei, S.parent_name, S.cage_code, S.recipient_address, S.recipient_city,
        S.recipient_state, S.recipient_zip, S.recipient_country, S.awarding_agency_code, S.awarding_agency,
        S.awarding_sub_agency_code, S.awarding_sub_agency, S.awarding_office_code, S.awarding_office,
        S.funding_agency, S.funding_office, S.naics_code, S.naics_description, S.psc_code, S.psc_description,
        S.contract_pricing_type, S.set_aside, S.pop_state, S.pop_city, S.pop_country, S.description${idvInsertVals}
      )
    `;
}
