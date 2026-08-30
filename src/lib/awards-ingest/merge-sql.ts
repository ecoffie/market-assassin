/**
 * MERGE staging → awards. Staging columns are STRING; every target type is explicit here.
 */

export function buildAwardsMergeSql(input: {
  awardsTable: string;
  stagingFq: string;
  startDate: string;
}): string {
  const { awardsTable, stagingFq, startDate } = input;

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
          CAST(prime_award_base_transaction_description AS STRING) AS description
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
        pop_state=S.pop_state, pop_city=S.pop_city, pop_country=S.pop_country, description=S.description
      WHEN NOT MATCHED THEN INSERT (
        txn_id, award_id, piid, mod_number, parent_piid, fiscal_year, action_date, pop_start_date, pop_end_date,
        obligation_amount, total_obligated, current_award_value, potential_award_value,
        recipient_uei, recipient_name, parent_uei, parent_name, cage_code, recipient_address, recipient_city,
        recipient_state, recipient_zip, recipient_country, awarding_agency_code, awarding_agency,
        awarding_sub_agency_code, awarding_sub_agency, awarding_office_code, awarding_office,
        funding_agency, funding_office, naics_code, naics_description, psc_code, psc_description,
        contract_pricing_type, set_aside, pop_state, pop_city, pop_country, description
      ) VALUES (
        S.txn_id, S.award_id, S.piid, S.mod_number, S.parent_piid, S.fiscal_year, S.action_date, S.pop_start_date, S.pop_end_date,
        S.obligation_amount, S.total_obligated, S.current_award_value, S.potential_award_value,
        S.recipient_uei, S.recipient_name, S.parent_uei, S.parent_name, S.cage_code, S.recipient_address, S.recipient_city,
        S.recipient_state, S.recipient_zip, S.recipient_country, S.awarding_agency_code, S.awarding_agency,
        S.awarding_sub_agency_code, S.awarding_sub_agency, S.awarding_office_code, S.awarding_office,
        S.funding_agency, S.funding_office, S.naics_code, S.naics_description, S.psc_code, S.psc_description,
        S.contract_pricing_type, S.set_aside, S.pop_state, S.pop_city, S.pop_country, S.description
      )
    `;
}
