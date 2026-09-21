#!/usr/bin/env bash
#
# build-lookup-tables.sh — one-time (re-runnable) build of the clustered
# lookup tables that replace full-table scans on /contracts/[piid] and
# /awards/[id]. See build-derived.sql sections 6 & 7 for the canonical defs.
#
# WHY THIS EXISTS: awards is clustered on (recipient_uei, recipient_name), so
# lookups by piid / award_id scanned the whole 63M-row table. On 2026-06-01
# that drained 45.9 TiB/day (2.3x the 20 TiB quota) and 500'd the site. These
# clustered-by-key tables make each cold lookup scan ~MB.
#
# WHEN TO RUN:
#   - After the BQ daily quota resets (~midnight America/Los_Angeles) if the
#     quota is currently exhausted — these builds need ~40 GB of scan budget.
#   - After each monthly USASpending ingest (the source `awards` table changed).
#
# COST: full build scans ~6.5 GB (piid_lookup) + ~34 GB (award_detail_lookup)
#       = ~40 GB one-time, ~$0.25 at $6.25/TB.
#
# PARTITIONING: both tables are RANGE_BUCKET-partitioned on a hash bucket
# (FARM_FINGERPRINT(key) mod 1024) and clustered by key, so a point lookup that
# filters `bucket = MOD(...@key...) AND key = @key` scans ~1/1024 of the table
# (~4.5 MB piid / ~25 MB award). Clustering ALONE on an unpartitioned table did
# NOT prune (measured ~4.86 GB / ~27 GB per lookup on 2026-06-02) — the hash
# partition is what makes byte cost deterministic. See build-derived.sql §6/§7.
#
# AFTER RUNNING: bump DATA_VERSION in src/lib/bigquery/cache.ts so any stale
# KV entries from the old (full-scan) queries are invalidated.
set -euo pipefail

PROJECT="market-assasin"

run() {
  local label="$1"; shift
  echo "==> Building ${label}…"
  bq query --use_legacy_sql=false --project_id="${PROJECT}" "$@"
  echo "    done: ${label}"
}

# Partition spec changes are incompatible with CREATE OR REPLACE, so DROP first.
echo "==> Dropping existing lookup tables (if present)…"
bq query --use_legacy_sql=false --project_id="${PROJECT}" \
  'DROP TABLE IF EXISTS `market-assasin.usaspending.piid_lookup`'
bq query --use_legacy_sql=false --project_id="${PROJECT}" \
  'DROP TABLE IF EXISTS `market-assasin.usaspending.award_detail_lookup`'

run "piid_lookup" '
CREATE TABLE `market-assasin.usaspending.piid_lookup`
PARTITION BY RANGE_BUCKET(bucket, GENERATE_ARRAY(0, 1024, 1))
CLUSTER BY piid_upper AS
WITH per_award AS (
  SELECT
    UPPER(TRIM(piid)) AS piid_upper,
    ARRAY_AGG(piid ORDER BY action_date DESC LIMIT 1)[OFFSET(0)] AS piid,
    award_id,
    ARRAY_AGG(recipient_name ORDER BY obligation_amount DESC NULLS LAST, action_date DESC LIMIT 1)[OFFSET(0)] AS recipient_name,
    SUM(obligation_amount) AS total_obligation,
    MAX(obligation_amount) AS max_obligation,
    MAX(action_date) AS latest_action_date
  FROM `market-assasin.usaspending.awards`
  WHERE piid IS NOT NULL AND TRIM(piid) != ""
  GROUP BY piid_upper, award_id
)
SELECT
  MOD(MOD(FARM_FINGERPRINT(piid_upper), 1024) + 1024, 1024) AS bucket,
  piid_upper, winner.piid AS piid, winner.award_id AS award_id, winner.recipient_name AS recipient_name
FROM (
  SELECT piid_upper,
    ARRAY_AGG(STRUCT(piid, award_id, recipient_name)
      ORDER BY total_obligation DESC NULLS LAST, max_obligation DESC NULLS LAST, latest_action_date DESC NULLS LAST
      LIMIT 1)[OFFSET(0)] AS winner
  FROM per_award GROUP BY piid_upper
)'

run "award_detail_lookup" '
CREATE TABLE `market-assasin.usaspending.award_detail_lookup`
PARTITION BY RANGE_BUCKET(bucket, GENERATE_ARRAY(0, 1024, 1))
CLUSTER BY award_id AS
SELECT
  MOD(MOD(FARM_FINGERPRINT(award_id), 1024) + 1024, 1024) AS bucket,
  award_id, latest.piid, latest.recipient_uei, latest.recipient_name, latest.parent_uei,
  latest.parent_name, latest.cage_code, latest.recipient_city, latest.recipient_state,
  latest.awarding_agency, latest.awarding_sub_agency, latest.awarding_office, latest.funding_agency,
  latest.funding_office, latest.naics_code, latest.naics_description, latest.psc_code,
  latest.psc_description, latest.contract_pricing_type, latest.set_aside,
  total_obligation AS obligation_amount, latest.action_date, latest.pop_start_date,
  latest.pop_end_date, latest.pop_state, latest.pop_city, latest.pop_country,
  latest.fiscal_year, latest.description
FROM (
  SELECT award_id, SUM(obligation_amount) AS total_obligation,
    ARRAY_AGG(STRUCT(piid, recipient_uei, recipient_name, parent_uei, parent_name, cage_code,
      recipient_city, recipient_state, awarding_agency, awarding_sub_agency, awarding_office,
      funding_agency, funding_office, naics_code, naics_description, psc_code, psc_description,
      contract_pricing_type, set_aside, action_date, pop_start_date, pop_end_date, pop_state,
      pop_city, pop_country, fiscal_year, description)
      ORDER BY action_date DESC LIMIT 1)[OFFSET(0)] AS latest
  FROM `market-assasin.usaspending.awards`
  WHERE award_id IS NOT NULL GROUP BY award_id
)'

echo ""
echo "==> Row counts:"
bq query --use_legacy_sql=false --project_id="${PROJECT}" '
SELECT "piid_lookup" AS tbl, COUNT(*) AS row_count FROM `market-assasin.usaspending.piid_lookup`
UNION ALL
SELECT "award_detail_lookup", COUNT(*) FROM `market-assasin.usaspending.award_detail_lookup`'

echo ""
echo "==> NEXT: bump DATA_VERSION in src/lib/bigquery/cache.ts, then deploy."
