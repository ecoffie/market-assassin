-- Gold-master recipients* excerpt from build-derived.sql.
-- Safe after the weekly awards MERGE. This does not recreate awards from awards_raw.
-- Do not DROP awards_raw.

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

-- 2c) recipients_rollup_merged — collapse same-NAME parent rollups.
--
-- Why: USAspending assigns MULTIPLE parent_uei values to one corporate family
-- whose names differ only by legal suffix ("LOCKHEED MARTIN CORP" vs
-- "LOCKHEED MARTIN CORPORATION"). recipients_rollup (2b) groups by parent_uei,
-- so these land in separate rollups → separate indexable pages that split a
-- prime's brand-search equity across /lockheed-martin-corp AND
-- /lockheed-martin-corporation. This pass merges parent rollups that share a
-- suffix-stripped normalized name into the single highest-spend rollup, so one
-- canonical page per company carries the whole footprint.
--
-- Merge rule: pure normalized-name match. A top-40-by-spend audit found every
-- fused group to be genuinely the same entity (Lockheed, Boeing, GD, RTX,
-- Leidos, Booz Allen, MIT, Johns Hopkins, …); "GENERAL ELECTRIC" does NOT fuse
-- with "GENERAL DYNAMICS" because the full normalized name must match. The one
-- scary tail case (CRANE CO vs CRANE & CO) turned out correct — USAspending's
-- own parent_uei lineage already links them as one family. No CAGE guard
-- needed (it only created gaps on zero-dollar sub-rollups).
--
-- Identity (name/address/canonical UEI) comes from the dominant (highest-spend)
-- rollup. child_ueis is the UNION across the merged group; distinct agency/NAICS
-- counts are RECOMPUTED from awards over that union (can't sum — overlap). The
-- table is column-compatible with recipients_rollup so the page layer just
-- swaps the table name.
CREATE OR REPLACE TABLE `market-assasin.usaspending.recipients_rollup_merged`
CLUSTER BY rollup_uei
AS
WITH
-- Normalized name per parent rollup: lowercase, strip common legal suffixes
-- and corporate words, collapse to single-spaced alphanumerics.
normed AS (
  SELECT
    rollup_uei,
    rollup_name,
    total_obligated,
    child_ueis,
    TRIM(REGEXP_REPLACE(
      REGEXP_REPLACE(
        LOWER(rollup_name),
        r'\b(corporation|corp|incorporated|inc|llc|l\.?l\.?c|company|co|ltd|limited|lp|l\.?p|plc|holdings|holding|group|the)\b', ''
      ),
      r'[^a-z0-9]+', ' '
    )) AS norm_name
  FROM `market-assasin.usaspending.recipients_rollup`
  WHERE rollup_name IS NOT NULL AND rollup_name != ''
),
-- Map every parent rollup to its merge key = the highest-spend rollup_uei that
-- shares its normalized name. Empty norm_name (name was all suffix words) falls
-- back to its own rollup_uei so it never collides with other empties.
keyed AS (
  SELECT
    n.rollup_uei,
    n.rollup_name,
    n.total_obligated,
    n.child_ueis,
    IF(n.norm_name = '', n.rollup_uei,
      FIRST_VALUE(n.rollup_uei) OVER (
        PARTITION BY n.norm_name ORDER BY n.total_obligated DESC, n.rollup_uei
      )
    ) AS merge_uei
  FROM normed n
),
-- Dominant rollup's identity per merge key (name/address/canonical slug source).
dominant AS (
  SELECT k.merge_uei, r.rollup_name, r.cage_code, r.address, r.city, r.state, r.zip, r.country
  FROM (SELECT DISTINCT merge_uei FROM keyed) k
  JOIN `market-assasin.usaspending.recipients_rollup` r ON r.rollup_uei = k.merge_uei
),
-- Union all child UEIs across every rollup that merged into this key.
members AS (
  SELECT
    merge_uei,
    ARRAY_CONCAT_AGG(child_ueis) AS child_ueis_raw,
    SUM(total_obligated) AS grp_obligated
  FROM keyed
  GROUP BY merge_uei
),
-- De-dupe the unioned child UEI set.
member_ueis AS (
  SELECT merge_uei, ARRAY_AGG(DISTINCT u) AS child_ueis
  FROM members, UNNEST(child_ueis_raw) AS u
  GROUP BY merge_uei
),
-- Recompute the heavy aggregates from awards over the full merged UEI set.
agg AS (
  SELECT
    m.merge_uei,
    SUM(a.obligation_amount)          AS total_obligated,
    COUNT(DISTINCT a.award_id)        AS award_count,
    COUNT(*)                          AS transaction_count,
    MIN(a.action_date)                AS first_action_date,
    MAX(a.action_date)                AS last_action_date,
    COUNT(DISTINCT a.awarding_agency) AS distinct_agency_count,
    COUNT(DISTINCT a.naics_code)      AS distinct_naics_count
  FROM member_ueis m
  CROSS JOIN UNNEST(m.child_ueis) AS cu
  JOIN `market-assasin.usaspending.awards` a ON a.recipient_uei = cu
  GROUP BY m.merge_uei
)
SELECT
  agg.merge_uei                       AS rollup_uei,
  dominant.rollup_name,
  member_ueis.child_ueis,
  ARRAY_LENGTH(member_ueis.child_ueis) AS child_count,
  dominant.cage_code,
  dominant.address,
  dominant.city,
  dominant.state,
  dominant.zip,
  dominant.country,
  agg.total_obligated,
  agg.award_count,
  agg.transaction_count,
  agg.first_action_date,
  agg.last_action_date,
  agg.distinct_agency_count,
  agg.distinct_naics_count
FROM agg
JOIN dominant    ON dominant.merge_uei = agg.merge_uei
JOIN member_ueis ON member_ueis.merge_uei = agg.merge_uei;
