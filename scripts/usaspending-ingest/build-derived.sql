-- Build typed, partitioned, clustered tables from awards_raw.
-- Run with: bq query --use_legacy_sql=false < build-derived.sql
--
-- Tables built:
--   awards                — flattened transactions, typed, partitioned, clustered
--   recipients            — one row per UEI, rolled-up totals
--   recipients_rollup     — one row per PARENT org (COALESCE(parent_uei,uei)),
--                           used by the contractor SEO pages so primes show
--                           their full footprint instead of a single scattered UEI
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

-- 2b) recipients_rollup — one row per PARENT organization.
--
-- Why: USAspending awards scatter across many subsidiary/legal-entity UEIs
-- that share one parent_uei. The per-UEI `recipients` table above therefore
-- under-counts household-name primes: e.g. Lockheed Martin's awards split
-- across 8+ UEIs, so the single-UEI page shows only ~4 agencies / $221B when
-- the true parent footprint is 27 agencies / 234 NAICS / $495B. That under-
-- count was tripping the contractor sub-page thin-content noindex gate
-- (SUBPAGE_MIN_ROWS) on 55.7% of $1B+ primes — exactly the pages we most
-- want indexed. This table rolls everything up to the parent.
--
-- Grouping key: COALESCE(parent_uei, recipient_uei) — a recipient with no
-- distinct parent is its own rollup. Distinct agency/NAICS counts are
-- recomputed at the parent level (you CANNOT sum the per-UEI distinct counts —
-- siblings overlap on agencies/NAICS).
--
-- rollup_name: prefer parent_name; fall back to the highest-spend child's
-- recipient_name when parent_name is absent. Picked deterministically.
-- child_ueis: every member UEI — the pages filter awards by
-- `recipient_uei IN UNNEST(child_ueis)` (preserves cluster pruning) and the
-- slug-redirect resolver maps a subsidiary slug back to its parent.
CREATE OR REPLACE TABLE `market-assasin.usaspending.recipients_rollup`
CLUSTER BY rollup_uei
AS
WITH
-- One pass over awards, grouped to the parent. All the heavy aggregates
-- (distinct counts, sums) compute here exactly once per rollup.
agg AS (
  SELECT
    COALESCE(parent_uei, recipient_uei) AS rollup_uei,
    ANY_VALUE(cage_code)                AS cage_code,
    ANY_VALUE(recipient_address)        AS address,
    ANY_VALUE(recipient_city)           AS city,
    ANY_VALUE(recipient_state)          AS state,
    ANY_VALUE(recipient_zip)            AS zip,
    ANY_VALUE(recipient_country)        AS country,
    SUM(obligation_amount)              AS total_obligated,
    COUNT(DISTINCT award_id)            AS award_count,
    COUNT(*)                            AS transaction_count,
    MIN(action_date)                    AS first_action_date,
    MAX(action_date)                    AS last_action_date,
    COUNT(DISTINCT awarding_agency)     AS distinct_agency_count,
    COUNT(DISTINCT naics_code)          AS distinct_naics_count
  FROM `market-assasin.usaspending.awards`
  WHERE recipient_uei IS NOT NULL
  GROUP BY rollup_uei
),
-- Per-UEI spend within each rollup — drives the deterministic canonical
-- name pick and the child_ueis membership array.
per_uei AS (
  SELECT
    COALESCE(parent_uei, recipient_uei) AS rollup_uei,
    recipient_uei,
    ANY_VALUE(recipient_name)           AS recipient_name,
    ANY_VALUE(parent_name)              AS parent_name,
    SUM(obligation_amount)              AS uei_obligated
  FROM `market-assasin.usaspending.awards`
  WHERE recipient_uei IS NOT NULL
  GROUP BY rollup_uei, recipient_uei
),
-- Collapse per_uei to one row per rollup: the canonical name (prefer any
-- parent_name, else highest-spend child's recipient_name) and the full
-- child UEI set.
names AS (
  SELECT
    rollup_uei,
    COALESCE(
      -- highest-spend non-null parent_name in the group
      ARRAY_AGG(parent_name IGNORE NULLS ORDER BY uei_obligated DESC LIMIT 1)[SAFE_OFFSET(0)],
      -- else highest-spend child recipient_name
      ARRAY_AGG(recipient_name ORDER BY uei_obligated DESC LIMIT 1)[SAFE_OFFSET(0)]
    ) AS rollup_name,
    ARRAY_AGG(recipient_uei ORDER BY uei_obligated DESC) AS child_ueis,
    COUNT(*) AS child_count
  FROM per_uei
  GROUP BY rollup_uei
)
SELECT
  agg.rollup_uei,
  names.rollup_name,
  names.child_ueis,
  names.child_count,
  agg.cage_code,
  agg.address,
  agg.city,
  agg.state,
  agg.zip,
  agg.country,
  agg.total_obligated,
  agg.award_count,
  agg.transaction_count,
  agg.first_action_date,
  agg.last_action_date,
  agg.distinct_agency_count,
  agg.distinct_naics_count
FROM agg
JOIN names USING (rollup_uei);

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
--
-- HASH-BUCKET PARTITION (not clustering alone): clustering on an UNPARTITIONED
-- table does NOT prune reliably for selective point lookups — a single-PIID
-- read measured ~4.86 GB (≈ whole 4.6 GB table) on 2026-06-02. Integer-range
-- partition pruning IS deterministic. We materialize a `bucket` column
-- (FARM_FINGERPRINT(piid_upper) mod 1024, normalized non-negative) and
-- partition on it, so a lookup that filters `bucket = MOD(...@piid...)` scans
-- ~1/1024 of the table (~4.5 MB) then clusters by piid_upper within. The app
-- query MUST filter on BOTH bucket AND piid_upper; let BQ compute the hash from
-- the bound param so JS never has to reproduce FARM_FINGERPRINT.
--
-- Aggregation semantics (matches old getAwardIdByPiid intent, hardened):
-- a PIID can span many transactions across multiple award_ids (mods, etc).
-- We pick the award_id with the largest TOTAL obligation for that PIID, and
-- carry the recipient_name FROM THAT SAME award_id (not ANY_VALUE across the
-- whole PIID, which could surface an unrelated recipient).
--
-- NOTE: build-lookup-tables.sh DROPs this table before re-creating, because
-- BigQuery refuses CREATE OR REPLACE when the partition spec changes.
CREATE TABLE `market-assasin.usaspending.piid_lookup`
PARTITION BY RANGE_BUCKET(bucket, GENERATE_ARRAY(0, 1024, 1))
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
  MOD(MOD(FARM_FINGERPRINT(piid_upper), 1024) + 1024, 1024) AS bucket,
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
-- just moves to award-detail crawls. This holds one row per award_id with
-- everything the detail page renders.
--
-- HASH-BUCKET PARTITION (see piid_lookup note): clustering alone on this
-- unpartitioned 25 GB table did NOT prune — a single award_id read measured
-- ~27 GB. We partition on a bucket = FARM_FINGERPRINT(award_id) mod 1024 so a
-- lookup filtering `bucket = MOD(...@id...)` scans ~1/1024 (~25 MB) then
-- clusters by award_id within. The app query MUST filter on BOTH bucket AND
-- award_id; BQ computes the hash from the bound param.
-- One row per award_id: pick the latest transaction's attributes (ORDER BY
-- action_date DESC) and SUM obligation across the award's transactions.
--
-- NOTE: build-lookup-tables.sh DROPs this table before re-creating (partition
-- spec change is incompatible with CREATE OR REPLACE).
CREATE TABLE `market-assasin.usaspending.award_detail_lookup`
PARTITION BY RANGE_BUCKET(bucket, GENERATE_ARRAY(0, 1024, 1))
CLUSTER BY award_id
AS
SELECT
  MOD(MOD(FARM_FINGERPRINT(award_id), 1024) + 1024, 1024) AS bucket,
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
