-- Typed subaward table on top of subawards_raw.
-- Run with: bq query --use_legacy_sql=false < build-derived.sql
--
-- Schema notes:
--   - prime_uei / subawardee_uei = the JOIN keys to recipients
--   - Partitioned by subaward_fy (range bucket) for fast year filters
--   - Clustered by prime_uei + subawardee_uei since contractor pages
--     query "subs from this UEI" and "primes paying this UEI"

CREATE OR REPLACE TABLE `market-assasin.usaspending.subawards`
PARTITION BY RANGE_BUCKET(subaward_fy, GENERATE_ARRAY(2020, 2030, 1))
CLUSTER BY prime_uei, subawardee_uei
AS
SELECT
  prime_award_unique_key                                AS prime_award_id,
  prime_award_piid                                      AS prime_piid,
  SAFE_CAST(prime_award_amount AS FLOAT64)              AS prime_amount,
  SAFE.PARSE_DATE('%Y-%m-%d', prime_award_base_action_date)   AS prime_action_date,
  SAFE_CAST(prime_award_base_action_date_fiscal_year AS INT64) AS prime_fy,
  prime_award_awarding_agency_code                      AS awarding_agency_code,
  prime_award_awarding_agency_name                      AS awarding_agency,
  prime_award_awarding_sub_agency_name                  AS awarding_sub_agency,
  prime_awardee_uei                                     AS prime_uei,
  prime_awardee_name                                    AS prime_name,
  prime_awardee_parent_uei                              AS prime_parent_uei,
  prime_awardee_parent_name                             AS prime_parent_name,
  prime_award_naics_code                                AS naics_code,
  prime_award_naics_description                         AS naics_description,
  -- Subaward fields
  subaward_number                                       AS subaward_number,
  SAFE_CAST(subaward_amount AS FLOAT64)                 AS subaward_amount,
  SAFE.PARSE_DATE('%Y-%m-%d', subaward_action_date)     AS subaward_action_date,
  SAFE_CAST(subaward_action_date_fiscal_year AS INT64)  AS subaward_fy,
  subawardee_uei                                        AS subawardee_uei,
  subawardee_name                                       AS subawardee_name,
  subawardee_dba_name                                   AS subawardee_dba,
  subawardee_parent_uei                                 AS subawardee_parent_uei,
  subawardee_parent_name                                AS subawardee_parent_name,
  subawardee_city_name                                  AS subawardee_city,
  subawardee_state_code                                 AS subawardee_state,
  subawardee_country_code                               AS subawardee_country,
  subaward_primary_place_of_performance_state_code      AS subaward_pop_state,
  subaward_primary_place_of_performance_country_code    AS subaward_pop_country,
  subaward_description                                  AS description
FROM `market-assasin.usaspending.subawards_raw`
WHERE subawardee_uei IS NOT NULL
  AND prime_awardee_uei IS NOT NULL
  AND SAFE_CAST(subaward_amount AS FLOAT64) > 0;

-- Rollup: subs PAID BY a prime (powers "Subawards Paid Out" on
-- /contractors/<prime>)
CREATE OR REPLACE TABLE `market-assasin.usaspending.subawards_by_prime`
CLUSTER BY prime_uei
AS
SELECT
  prime_uei,
  ANY_VALUE(prime_name)         AS prime_name,
  COUNT(*)                      AS subaward_count,
  COUNT(DISTINCT subawardee_uei) AS distinct_subs,
  SUM(subaward_amount)          AS total_paid_out
FROM `market-assasin.usaspending.subawards`
GROUP BY prime_uei;

-- Rollup: subs RECEIVED by a subawardee (powers "Subawards Received"
-- on /contractors/<sub>)
CREATE OR REPLACE TABLE `market-assasin.usaspending.subawards_by_subawardee`
CLUSTER BY subawardee_uei
AS
SELECT
  subawardee_uei,
  ANY_VALUE(subawardee_name)    AS subawardee_name,
  COUNT(*)                      AS subaward_count,
  COUNT(DISTINCT prime_uei)     AS distinct_primes,
  SUM(subaward_amount)          AS total_received
FROM `market-assasin.usaspending.subawards`
GROUP BY subawardee_uei;
