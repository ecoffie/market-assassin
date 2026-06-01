-- Agency-breakdown rollup tables — permanent BigQuery quota fix.
--
-- The /agencies pages call getTopRecipientsForAgency + getTopNaicsForAgency,
-- which filter the awards table by awarding_agency. awarding_agency is NOT
-- a cluster key (recipient_uei is), so every cold-miss scanned the FULL
-- ~10 GiB awards partition — the dominant driver of the daily QueryUsage
-- quota exhaustion (the "agency breakdown was 82% of daily scan" note).
--
-- Fix: pre-aggregate ONCE into tiny rollup tables. Page queries then read
-- a few MB instead of scanning 10 GiB. Rebuild monthly after each
-- USASpending ingest (see scripts/bq-refresh-agency-rollups.js).
--
-- Replace `PROJECT.DATASET` with your real values (the refresh script
-- substitutes them from env). Keeping only the top 50 per agency keeps
-- the rollup tables tiny while covering everything the UI shows (top 20
-- recipients / top 15 NAICS).

-- ---------------------------------------------------------------------
-- 1) Top recipients per agency (rolled up by recipient_name, canonical UEI)
-- ---------------------------------------------------------------------
CREATE OR REPLACE TABLE `PROJECT.DATASET.agency_top_recipients`
CLUSTER BY awarding_agency
AS
WITH per_uei AS (
  SELECT
    awarding_agency,
    recipient_uei,
    recipient_name,
    SUM(obligation_amount) AS amount,
    COUNT(DISTINCT award_id) AS awards
  FROM `PROJECT.DATASET.awards`
  WHERE awarding_agency IS NOT NULL
    AND recipient_uei IS NOT NULL
    AND recipient_name IS NOT NULL
  GROUP BY awarding_agency, recipient_uei, recipient_name
),
rolled AS (
  SELECT
    awarding_agency,
    recipient_name,
    SUM(amount) AS total_amount,
    SUM(awards) AS award_count,
    ARRAY_AGG(recipient_uei ORDER BY amount DESC LIMIT 1)[OFFSET(0)] AS recipient_uei
  FROM per_uei
  GROUP BY awarding_agency, recipient_name
),
ranked AS (
  SELECT
    awarding_agency, recipient_name, recipient_uei, total_amount, award_count,
    ROW_NUMBER() OVER (PARTITION BY awarding_agency ORDER BY total_amount DESC) AS rank
  FROM rolled
)
SELECT awarding_agency, recipient_uei, recipient_name, total_amount, award_count, rank
FROM ranked
WHERE rank <= 50;

-- ---------------------------------------------------------------------
-- 2) Top NAICS per agency
-- ---------------------------------------------------------------------
CREATE OR REPLACE TABLE `PROJECT.DATASET.agency_top_naics`
CLUSTER BY awarding_agency
AS
WITH agg AS (
  SELECT
    awarding_agency,
    naics_code,
    ANY_VALUE(naics_description) AS naics_description,
    SUM(obligation_amount) AS total_amount
  FROM `PROJECT.DATASET.awards`
  WHERE awarding_agency IS NOT NULL AND naics_code IS NOT NULL
  GROUP BY awarding_agency, naics_code
),
ranked AS (
  SELECT
    awarding_agency, naics_code, naics_description, total_amount,
    ROW_NUMBER() OVER (PARTITION BY awarding_agency ORDER BY total_amount DESC) AS rank
  FROM agg
)
SELECT awarding_agency, naics_code, naics_description, total_amount, rank
FROM ranked
WHERE rank <= 50;

-- ---------------------------------------------------------------------
-- 3) Top contractors per listicle dimension (agency / naics / sub_agency
--    / state / set_aside) — one unified table for all /top/[slug] pages.
-- ---------------------------------------------------------------------
-- Each /top page filters awards on a dimension that isn't a cluster key
-- and scanned the full table. This pre-rolls the top 50 contractors for
-- every value of each dimension into one clustered table.
CREATE OR REPLACE TABLE `PROJECT.DATASET.top_contractors_by_dimension`
CLUSTER BY dimension, dimension_value
AS
WITH base AS (
  SELECT
    recipient_uei, recipient_name, award_id, obligation_amount,
    awarding_agency, naics_code, awarding_sub_agency, recipient_state, set_aside
  FROM `PROJECT.DATASET.awards`
  WHERE recipient_uei IS NOT NULL AND recipient_name IS NOT NULL
),
-- Unpivot the relevant dimensions into (dimension, dimension_value) rows.
exploded AS (
  SELECT 'agency'     AS dimension, awarding_agency     AS dimension_value, * EXCEPT(awarding_agency, naics_code, awarding_sub_agency, recipient_state, set_aside) FROM base WHERE awarding_agency IS NOT NULL
  UNION ALL
  SELECT 'naics'      AS dimension, naics_code          AS dimension_value, * EXCEPT(awarding_agency, naics_code, awarding_sub_agency, recipient_state, set_aside) FROM base WHERE naics_code IS NOT NULL
  UNION ALL
  SELECT 'sub_agency' AS dimension, awarding_sub_agency AS dimension_value, * EXCEPT(awarding_agency, naics_code, awarding_sub_agency, recipient_state, set_aside) FROM base WHERE awarding_sub_agency IS NOT NULL
  UNION ALL
  SELECT 'state'      AS dimension, recipient_state     AS dimension_value, * EXCEPT(awarding_agency, naics_code, awarding_sub_agency, recipient_state, set_aside) FROM base WHERE recipient_state IS NOT NULL
  UNION ALL
  SELECT 'set_aside'  AS dimension, set_aside           AS dimension_value, * EXCEPT(awarding_agency, naics_code, awarding_sub_agency, recipient_state, set_aside) FROM base WHERE set_aside IS NOT NULL
),
per_uei AS (
  SELECT
    dimension, dimension_value, recipient_uei, recipient_name,
    SUM(obligation_amount) AS amount,
    COUNT(DISTINCT award_id) AS awards
  FROM exploded
  GROUP BY dimension, dimension_value, recipient_uei, recipient_name
),
rolled AS (
  SELECT
    dimension, dimension_value, recipient_name,
    SUM(amount) AS total_amount,
    SUM(awards) AS award_count,
    ARRAY_AGG(recipient_uei ORDER BY amount DESC LIMIT 1)[OFFSET(0)] AS recipient_uei
  FROM per_uei
  GROUP BY dimension, dimension_value, recipient_name
),
ranked AS (
  SELECT
    dimension, dimension_value, recipient_uei, recipient_name, total_amount, award_count,
    ROW_NUMBER() OVER (PARTITION BY dimension, dimension_value ORDER BY total_amount DESC) AS rank
  FROM rolled
)
SELECT dimension, dimension_value, recipient_uei, recipient_name, total_amount, award_count, rank
FROM ranked
WHERE rank <= 50;

