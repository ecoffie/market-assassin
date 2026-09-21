#!/bin/bash
# Load all gzipped subaward CSVs from GCS into BigQuery.
#
# Mirrors scripts/usaspending-ingest/load-to-bq.sh (prime award load).
# All columns loaded as STRING in the raw landing table to avoid
# per-file type mismatch failures; typed cast happens in
# build-derived.sql.

set -e

PROJECT="market-assasin"
DATASET="usaspending"
RAW_TABLE="${PROJECT}:${DATASET}.subawards_raw"
BUCKET="market-assasin-usaspending-staging"

echo "Listing GCS files..."
gcloud storage ls "gs://${BUCKET}/subawards-csv-gz/**" 2>/dev/null | grep '\.gz$' > /tmp/subaward-gcs-uris.txt
URI_COUNT=$(wc -l < /tmp/subaward-gcs-uris.txt | tr -d ' ')
echo "Found ${URI_COUNT} subaward CSV.gz files in GCS"

if [ "$URI_COUNT" -eq 0 ]; then
  echo "ERROR: no files in GCS. Did the Cloud Run job run successfully?"
  exit 1
fi

# Pull header from the first file. All files share the same 118-column header.
SAMPLE_FILE=$(head -1 /tmp/subaward-gcs-uris.txt)
echo "Sampling schema from: $SAMPLE_FILE"
HEADER=$(gcloud storage cat "$SAMPLE_FILE" 2>/dev/null | gunzip 2>/dev/null | head -1)
SCHEMA_JSON=$(echo "$HEADER" | tr ',' '\n' | jq -R 'gsub("\\W"; "_") | {name: ., type: "STRING", mode: "NULLABLE"}' | jq -s .)
echo "$SCHEMA_JSON" > /tmp/subaward-raw-schema.json
COL_COUNT=$(echo "$SCHEMA_JSON" | jq length)
echo "Schema has $COL_COUNT columns"

URI_LIST=$(paste -sd, /tmp/subaward-gcs-uris.txt)

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
  /tmp/subaward-raw-schema.json

echo ""
echo "=== Raw load complete. Row count: ==="
bq query --use_legacy_sql=false --format=pretty \
  "SELECT COUNT(*) AS n FROM \`${PROJECT}.${DATASET}.subawards_raw\`"
