#!/bin/bash
# Build the manifest of USASpending ZIPs to process.
# Filters to: FY2016-FY2026 Contracts Full archives only.
# Uploads to gs://.../manifest/files.json so the Cloud Run job can read it.

set -e

BUCKET="market-assasin-usaspending-staging"
ARCHIVE_LIST_URL="https://files.usaspending.gov/award_data_archive/"

echo "Fetching S3 archive listing..."
# S3 paginates at 1000 keys; loop with marker= until we have everything
KEYS=""
MARKER=""
while true; do
  if [ -z "$MARKER" ]; then
    PAGE=$(curl -s "${ARCHIVE_LIST_URL}")
  else
    PAGE=$(curl -s "${ARCHIVE_LIST_URL}?marker=${MARKER}")
  fi
  NEW_KEYS=$(echo "$PAGE" | grep -oE '<Key>[^<]+</Key>' | sed 's|<Key>||;s|</Key>||')
  if [ -z "$NEW_KEYS" ]; then break; fi
  KEYS="${KEYS}${NEW_KEYS}\n"
  TRUNCATED=$(echo "$PAGE" | grep -oE '<IsTruncated>[^<]+</IsTruncated>' | sed 's|<IsTruncated>||;s|</IsTruncated>||')
  if [ "$TRUNCATED" != "true" ]; then break; fi
  MARKER=$(echo "$NEW_KEYS" | tail -1)
done

echo "Filtering to FY2016-FY2026 Contracts Full..."
# Match e.g. FY2016_036_Contracts_Full_20260506.zip
FILTERED=$(echo -e "$KEYS" | grep -E '^FY(2016|2017|2018|2019|2020|2021|2022|2023|2024|2025|2026)_[0-9]+_Contracts_Full_[0-9]+\.zip$' | sort -u)
COUNT=$(echo "$FILTERED" | grep -c .)
echo "Found $COUNT matching files"

# JSON array
JSON=$(echo "$FILTERED" | jq -R . | jq -s .)
echo "$JSON" > /tmp/usaspending-manifest.json

echo "Uploading manifest to gs://${BUCKET}/manifest/files.json"
gcloud storage cp /tmp/usaspending-manifest.json gs://${BUCKET}/manifest/files.json

echo "Manifest contains $COUNT files. Sample:"
echo "$FILTERED" | head -5
echo "..."
echo "$FILTERED" | tail -3
