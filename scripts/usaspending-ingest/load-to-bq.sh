#!/bin/bash
# Load gzipped USASpending CSVs from GCS into BigQuery.
#
# Two-phase load:
#   1. Raw landing: bq load with autodetect → usaspending.awards_raw
#      (all 297 columns as STRING — we don't trust source types and
#      autodetect is unreliable across 1200+ files with edge cases)
#   2. Typed materialized table: usaspending.awards (only the ~30 cols
#      we actually use, properly typed, partitioned by FY, clustered
#      on recipient_uei + recipient_name for fast contractor queries)
#
# ORDER MATTERS: run THIS script first (it recreates awards_raw via
# --replace), THEN build-derived.sql (which reads awards_raw to build the
# typed tables and DROPs awards_raw as its last step). awards_raw only needs
# to exist between these two steps — it is not kept between ingest runs.
#
# Why STRING-only in raw: USASpending CSVs have inconsistent types across
# files. A "1" might be numeric in one row and "T" in another for boolean
# fields like is_8a_program_participant. Loading everything as STRING
# avoids hundreds of files failing on type mismatch. We cast in phase 2.

set -e

PROJECT="market-assasin"
DATASET="usaspending"
RAW_TABLE="${PROJECT}:${DATASET}.awards_raw"
BUCKET="market-assasin-usaspending-staging"

# BigQuery wildcards only work at the leaf level, not across directories.
# Strategy: enumerate every .gz path in GCS, write to a list, pass as
# comma-separated URIs. Single bq load handles up to 10,000 URIs per job.
echo "Listing GCS files..."
gcloud storage ls "gs://${BUCKET}/csv-gz/**" 2>/dev/null | grep '\.gz$' > /tmp/usaspending-gcs-uris.txt
URI_COUNT=$(wc -l < /tmp/usaspending-gcs-uris.txt | tr -d ' ')
echo "Found ${URI_COUNT} CSV.gz files in GCS"

if [ "$URI_COUNT" -eq 0 ]; then
  echo "ERROR: no files in GCS. Did the ingest job run?"
  exit 1
fi

# Pull header from the first file. All 1,278 files share the same
# 297-column header.
SAMPLE_FILE=$(head -1 /tmp/usaspending-gcs-uris.txt)
echo "Sampling schema from: $SAMPLE_FILE"
HEADER=$(gcloud storage cat "$SAMPLE_FILE" 2>/dev/null | gunzip 2>/dev/null | head -1)
SCHEMA_JSON=$(echo "$HEADER" | tr ',' '\n' | jq -R 'gsub("\\W"; "_") | {name: ., type: "STRING", mode: "NULLABLE"}' | jq -s .)
echo "$SCHEMA_JSON" > /tmp/usaspending-raw-schema.json
COL_COUNT=$(echo "$SCHEMA_JSON" | jq length)
echo "Schema has $COL_COUNT columns"

# Build comma-separated URI list. bq load accepts this directly.
URI_LIST=$(paste -sd, /tmp/usaspending-gcs-uris.txt)

echo "Loading ${URI_COUNT} CSVs into ${RAW_TABLE}..."
bq load \
  --source_format=CSV \
  --skip_leading_rows=1 \
  --allow_quoted_newlines \
  --allow_jagged_rows \
  --replace \
  --max_bad_records=10000 \
  "${RAW_TABLE}" \
  "${URI_LIST}" \
  /tmp/usaspending-raw-schema.json

echo ""
echo "=== Raw load complete. Row count: ==="
bq query --use_legacy_sql=false --format=pretty \
  "SELECT COUNT(*) AS rows FROM \`${PROJECT}.${DATASET}.awards_raw\`"

echo ""
echo "=== Sample row count by FY: ==="
bq query --use_legacy_sql=false --format=pretty --max_rows=15 \
  "SELECT action_date_fiscal_year AS fy, COUNT(*) AS txns
   FROM \`${PROJECT}.${DATASET}.awards_raw\`
   GROUP BY fy ORDER BY fy"
