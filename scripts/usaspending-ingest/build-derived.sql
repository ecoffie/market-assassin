-- Build typed, partitioned, clustered tables from awards_raw.
-- Run with: bq query --use_legacy_sql=false < build-derived.sql
--
-- Tables built:
--   awards                — flattened transactions, typed, partitioned, clustered
--   recipients            — one row per UEI, rolled-up totals
--   recipient_executives  — top 5 highly_compensated_officers per recipient (FFATA)
--   naics_summary         — per-NAICS totals
--   agency_summary        — per-agency totals
--
-- Partitioning: fiscal_year (INT) — typical query filters by year window
-- Clustering: recipient_uei, recipient_name — contractor-page lookups

-- 1) Typed awards table (the workhorse — every contractor query hits this)
CREATE OR REPLACE TABLE `market-assasin.usaspending.awards`
PARTITION BY RANGE_BUCKET(fiscal_year, GENERATE_ARRAY(2015, 2030, 1))
CLUSTER BY recipient_uei, recipient_name
AS
SELECT
  contract_transaction_unique_key                                    AS txn_id,
  contract_award_unique_key                                          AS award_id,
  award_id_piid                                                      AS piid,
  modification_number                                                AS mod_number,
  parent_award_id_piid                                               AS parent_piid,
  SAFE_CAST(action_date_fiscal_year AS INT64)                        AS fiscal_year,
  SAFE.PARSE_DATE('%Y-%m-%d', action_date)                           AS action_date,
  SAFE.PARSE_DATE('%Y-%m-%d', period_of_performance_start_date)      AS pop_start_date,
  SAFE.PARSE_DATE('%Y-%m-%d', period_of_performance_current_end_date) AS pop_end_date,
  SAFE_CAST(federal_action_obligation AS FLOAT64)                    AS obligation_amount,
  SAFE_CAST(total_dollars_obligated AS FLOAT64)                      AS total_obligated,
  SAFE_CAST(current_total_value_of_award AS FLOAT64)                 AS current_award_value,
  SAFE_CAST(potential_total_value_of_award AS FLOAT64)               AS potential_award_value,
  recipient_uei                                                      AS recipient_uei,
  recipient_name                                                     AS recipient_name,
  recipient_parent_uei                                               AS parent_uei,
  recipient_parent_name                                              AS parent_name,
  cage_code                                                          AS cage_code,
  recipient_address_line_1                                           AS recipient_address,
  recipient_city_name                                                AS recipient_city,
  recipient_state_code                                               AS recipient_state,
  recipient_zip_4_code                                               AS recipient_zip,
  recipient_country_code                                             AS recipient_country,
  awarding_agency_code                                               AS awarding_agency_code,
  awarding_agency_name                                               AS awarding_agency,
  awarding_sub_agency_code                                           AS awarding_sub_agency_code,
  awarding_sub_agency_name                                           AS awarding_sub_agency,
  awarding_office_code                                               AS awarding_office_code,
  awarding_office_name                                               AS awarding_office,
  funding_agency_name                                                AS funding_agency,
  funding_office_name                                                AS funding_office,
  naics_code                                                         AS naics_code,
  naics_description                                                  AS naics_description,
  product_or_service_code                                            AS psc_code,
  product_or_service_code_description                                AS psc_description,
  type_of_contract_pricing                                           AS contract_pricing_type,
  type_of_set_aside                                                  AS set_aside,
  primary_place_of_performance_state_code                            AS pop_state,
  primary_place_of_performance_city_name                             AS pop_city,
  primary_place_of_performance_country_code                          AS pop_country,
  prime_award_base_transaction_description                           AS description,
  -- Executive comp arrays (kept on transaction rows so we can pick "most recent")
  highly_compensated_officer_1_name                                  AS exec_1_name,
  SAFE_CAST(highly_compensated_officer_1_amount AS FLOAT64)          AS exec_1_amount,
  highly_compensated_officer_2_name                                  AS exec_2_name,
  SAFE_CAST(highly_compensated_officer_2_amount AS FLOAT64)          AS exec_2_amount,
  highly_compensated_officer_3_name                                  AS exec_3_name,
  SAFE_CAST(highly_compensated_officer_3_amount AS FLOAT64)          AS exec_3_amount,
  highly_compensated_officer_4_name                                  AS exec_4_name,
  SAFE_CAST(highly_compensated_officer_4_amount AS FLOAT64)          AS exec_4_amount,
  highly_compensated_officer_5_name                                  AS exec_5_name,
  SAFE_CAST(highly_compensated_officer_5_amount AS FLOAT64)          AS exec_5_amount
FROM `market-assasin.usaspending.awards_raw`
WHERE recipient_uei IS NOT NULL
  AND SAFE_CAST(action_date_fiscal_year AS INT64) BETWEEN 2015 AND 2030;

-- 2) Recipient rollup (one row per UEI)
CREATE OR REPLACE TABLE `market-assasin.usaspending.recipients`
CLUSTER BY recipient_uei
AS
SELECT
  recipient_uei,
  ANY_VALUE(recipient_name)        AS recipient_name,
  ANY_VALUE(parent_uei)            AS parent_uei,
  ANY_VALUE(parent_name)           AS parent_name,
  ANY_VALUE(cage_code)             AS cage_code,
  ANY_VALUE(recipient_address)     AS address,
  ANY_VALUE(recipient_city)        AS city,
  ANY_VALUE(recipient_state)       AS state,
  ANY_VALUE(recipient_zip)         AS zip,
  ANY_VALUE(recipient_country)     AS country,
  SUM(obligation_amount)           AS total_obligated,
  COUNT(DISTINCT award_id)         AS award_count,
  COUNT(*)                         AS transaction_count,
  MIN(action_date)                 AS first_action_date,
  MAX(action_date)                 AS last_action_date,
  COUNT(DISTINCT awarding_agency)  AS distinct_agency_count,
  COUNT(DISTINCT naics_code)       AS distinct_naics_count
FROM `market-assasin.usaspending.awards`
WHERE recipient_uei IS NOT NULL
GROUP BY recipient_uei;

-- 3) Top-5 executives per recipient (from FFATA disclosures)
-- One row per (recipient, exec) — picked from most recent transaction
-- that had non-null exec data.
CREATE OR REPLACE TABLE `market-assasin.usaspending.recipient_executives`
CLUSTER BY recipient_uei
AS
WITH per_txn AS (
  SELECT
    recipient_uei,
    action_date,
    ARRAY<STRUCT<rank INT64, name STRING, amount FLOAT64>>[
      STRUCT(1, exec_1_name, exec_1_amount),
      STRUCT(2, exec_2_name, exec_2_amount),
      STRUCT(3, exec_3_name, exec_3_amount),
      STRUCT(4, exec_4_name, exec_4_amount),
      STRUCT(5, exec_5_name, exec_5_amount)
    ] AS execs
  FROM `market-assasin.usaspending.awards`
  WHERE exec_1_name IS NOT NULL OR exec_2_name IS NOT NULL
),
exploded AS (
  SELECT recipient_uei, action_date, e.rank, e.name, e.amount
  FROM per_txn, UNNEST(execs) AS e
  WHERE e.name IS NOT NULL AND e.name != ''
),
latest_per_exec AS (
  SELECT
    recipient_uei,
    name,
    rank,
    amount,
    action_date,
    ROW_NUMBER() OVER (
      PARTITION BY recipient_uei, name
      ORDER BY action_date DESC
    ) AS rn
  FROM exploded
)
SELECT recipient_uei, name AS exec_name, rank AS exec_rank, amount AS exec_amount, action_date AS reported_at
FROM latest_per_exec
WHERE rn = 1;

-- 4) NAICS summary
CREATE OR REPLACE TABLE `market-assasin.usaspending.naics_summary`
CLUSTER BY naics_code
AS
SELECT
  naics_code,
  ANY_VALUE(naics_description)     AS naics_description,
  SUM(obligation_amount)           AS total_obligated,
  COUNT(DISTINCT recipient_uei)    AS recipient_count,
  COUNT(DISTINCT awarding_agency)  AS agency_count,
  COUNT(*)                         AS transaction_count
FROM `market-assasin.usaspending.awards`
WHERE naics_code IS NOT NULL
GROUP BY naics_code;

-- 5) Agency summary
CREATE OR REPLACE TABLE `market-assasin.usaspending.agency_summary`
CLUSTER BY awarding_agency
AS
SELECT
  awarding_agency,
  SUM(obligation_amount)           AS total_obligated,
  COUNT(DISTINCT recipient_uei)    AS recipient_count,
  COUNT(DISTINCT naics_code)       AS naics_count,
  COUNT(*)                         AS transaction_count
FROM `market-assasin.usaspending.awards`
WHERE awarding_agency IS NOT NULL
GROUP BY awarding_agency;

-- 6) PIID lookup  (BQ-quota saver — powers /contracts/[piid])
-- The awards table is clustered on (recipient_uei, recipient_name), NOT piid,
-- so `WHERE UPPER(piid)=@x` was a ~830 MB FULL-TABLE SCAN per request. Bots
-- crawl tens of thousands of unique PIIDs → 45.9 TiB/day → quota blown daily.
-- This clustered lookup makes each resolve scan ~MB instead of the full table.
--
-- Aggregation semantics (matches old getAwardIdByPiid intent, hardened):
-- a PIID can span many transactions across multiple award_ids (mods, etc).
-- We pick the award_id with the largest TOTAL obligation for that PIID, and
-- carry the recipient_name FROM THAT SAME award_id (not ANY_VALUE across the
-- whole PIID, which could surface an unrelated recipient). Two-step:
--   per_award: collapse to one row per (piid_upper, award_id) with its total
--   then: pick the winning award per piid_upper via STRUCT ARRAY_AGG.
CREATE OR REPLACE TABLE `market-assasin.usaspending.piid_lookup`
CLUSTER BY piid_upper
AS
WITH per_award AS (
  SELECT
    UPPER(TRIM(piid))                                            AS piid_upper,
    ARRAY_AGG(piid ORDER BY action_date DESC LIMIT 1)[OFFSET(0)] AS piid,
    award_id,
    ARRAY_AGG(recipient_name ORDER BY obligation_amount DESC NULLS LAST,
                                      action_date DESC LIMIT 1)[OFFSET(0)] AS recipient_name,
    SUM(obligation_amount)  AS total_obligation,
    MAX(obligation_amount)  AS max_obligation,
    MAX(action_date)        AS latest_action_date
  FROM `market-assasin.usaspending.awards`
  WHERE piid IS NOT NULL AND TRIM(piid) != ''
  GROUP BY piid_upper, award_id
)
SELECT
  piid_upper,
  winner.piid          AS piid,
  winner.award_id      AS award_id,
  winner.recipient_name AS recipient_name
FROM (
  SELECT
    piid_upper,
    ARRAY_AGG(
      STRUCT(piid, award_id, recipient_name)
      ORDER BY total_obligation DESC NULLS LAST,
               max_obligation   DESC NULLS LAST,
               latest_action_date DESC NULLS LAST
      LIMIT 1
    )[OFFSET(0)] AS winner
  FROM per_award
  GROUP BY piid_upper
);

-- 7) Award detail lookup  (BQ-quota saver — powers /awards/[id])
-- Same disease as PIID: award_id is NOT in the awards cluster key, so
-- `WHERE award_id=@id` scans 10-15 GB per cold lookup (see getAwardById).
-- If we restore /contracts→/awards/[id] redirects WITHOUT this, the drain
-- just moves to award-detail crawls. This clustered table holds one row per
-- award_id with everything the detail page renders. Cold lookups scan ~MB.
-- One row per award_id: pick the latest transaction's attributes (ORDER BY
-- action_date DESC) and SUM obligation across the award's transactions.
CREATE OR REPLACE TABLE `market-assasin.usaspending.award_detail_lookup`
CLUSTER BY award_id
AS
SELECT
  award_id,
  -- scalar attributes taken from the most-recent transaction of the award
  latest.piid,
  latest.recipient_uei,
  latest.recipient_name,
  latest.parent_uei,
  latest.parent_name,
  latest.cage_code,
  latest.recipient_city,
  latest.recipient_state,
  latest.awarding_agency,
  latest.awarding_sub_agency,
  latest.awarding_office,
  latest.funding_agency,
  latest.funding_office,
  latest.naics_code,
  latest.naics_description,
  latest.psc_code,
  latest.psc_description,
  latest.contract_pricing_type,
  latest.set_aside,
  total_obligation AS obligation_amount,
  latest.action_date,
  latest.pop_start_date,
  latest.pop_end_date,
  latest.pop_state,
  latest.pop_city,
  latest.pop_country,
  latest.fiscal_year,
  latest.description
FROM (
  SELECT
    award_id,
    SUM(obligation_amount) AS total_obligation,
    ARRAY_AGG(
      STRUCT(
        piid, recipient_uei, recipient_name, parent_uei, parent_name, cage_code,
        recipient_city, recipient_state, awarding_agency, awarding_sub_agency,
        awarding_office, funding_agency, funding_office, naics_code,
        naics_description, psc_code, psc_description, contract_pricing_type,
        set_aside, action_date, pop_start_date, pop_end_date, pop_state,
        pop_city, pop_country, fiscal_year, description
      )
      ORDER BY action_date DESC LIMIT 1
    )[OFFSET(0)] AS latest
  FROM `market-assasin.usaspending.awards`
  WHERE award_id IS NOT NULL
  GROUP BY award_id
);
