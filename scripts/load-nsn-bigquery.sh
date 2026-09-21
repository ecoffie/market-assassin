#!/usr/bin/env bash
# NSN Intelligence — load the DLA PUB LOG / FLIS catalog into BigQuery (dataset `nsn`).
# The catalog is STATIC reference data (~50M rows) → it lives in BigQuery next to the
# usaspending contractors, NOT Supabase (memory: nsn_catalog_in_bigquery). `bq load` ingests
# the CSVs natively — the whole set loads in ~50s. Run monthly when DLA refreshes the Reading Room.
#
# Prereq: the 4 zips from https://www.dla.mil/.../FLIS-Data-Electronic-Reading-Room/ in ~/Downloads:
#   IDENTIFICATION.zip  MANAGEMENT.zip  REFERENCE.zip  CAGE.zip
# Auth: GCP_SA_JSON in .env.local (SA has BQ write on project market-assasin).
#
# Usage:  bash scripts/load-nsn-bigquery.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# Extract the service-account JSON from .env.local → a temp creds file for the bq CLI.
node --env-file=.env.local -e "const r=process.env.GCP_SA_JSON;let j;try{j=r.trim().startsWith('{')?JSON.parse(r):JSON.parse(Buffer.from(r.trim(),'base64').toString('utf8'))}catch(e){j=JSON.parse(r.replace(/\\\\n/g,'\n'))}require('fs').writeFileSync('/tmp/nsn-sa.json',JSON.stringify(j))"
export GOOGLE_APPLICATION_CREDENTIALS=/tmp/nsn-sa.json
PROJ=market-assasin
bq --project_id=$PROJ mk --dataset --force "$PROJ:nsn" >/dev/null 2>&1 || true
mkdir -p /tmp/nsn_csv

load() {  # zip csv table
  unzip -o ~/Downloads/"$1" "$2" -d /tmp/nsn_csv/ >/dev/null
  local HDR SCHEMA
  HDR=$(head -1 /tmp/nsn_csv/"$2" | tr -d '"\r')
  SCHEMA=$(echo "$HDR" | tr ',' '\n' | sed 's/$/:STRING/' | paste -sd, -)   # all-STRING; cast at query time
  echo "loading nsn.$3 …"
  bq --project_id=$PROJ load --source_format=CSV --skip_leading_rows=1 --replace \
     --quote='"' --max_bad_records=1000 "$PROJ:nsn.$3" /tmp/nsn_csv/"$2" "$SCHEMA"
  bq --project_id=$PROJ query --use_legacy_sql=false --format=csv "SELECT COUNT(*) AS n FROM nsn.$3" | tail -1
}
load IDENTIFICATION.zip P_FLIS_NSN.CSV      identity
load MANAGEMENT.zip     V_FLIS_MANAGEMENT.CSV management
load REFERENCE.zip      V_FLIS_PART.CSV      parts
load CAGE.zip           P_CAGE.CSV           cage

# (Re)create the joined lookup view the app queries.
bq --project_id=$PROJ query --use_legacy_sql=false '
CREATE OR REPLACE VIEW nsn.reference_lookup AS
WITH price AS (
  SELECT NIIN, SAFE_CAST(UNIT_PRICE AS FLOAT64) AS unit_price,
    NULLIF(TRIM(UI),"") AS unit_of_issue, NULLIF(TRIM(AAC),"") AS aac,
    SAFE.PARSE_DATE("%d-%b-%Y", EFFECTIVE_DATE) AS price_date,
    ROW_NUMBER() OVER (PARTITION BY NIIN ORDER BY SAFE.PARSE_DATE("%d-%b-%Y", EFFECTIVE_DATE) DESC) rn
  FROM nsn.management)
SELECT i.NIIN AS niin, NULLIF(TRIM(i.FSC),"") AS fsc,
  CASE WHEN i.FSC IS NOT NULL AND i.NIIN IS NOT NULL THEN CONCAT(TRIM(i.FSC),TRIM(i.NIIN)) END AS nsn,
  CASE WHEN UPPER(TRIM(i.ITEM_NAME)) IN ("UNKNOWN","") THEN NULL ELSE TRIM(i.ITEM_NAME) END AS item_name,
  NULLIF(TRIM(i.INC),"") AS inc,
  CASE WHEN SAFE_CAST(p.unit_price AS FLOAT64) > 0 THEN p.unit_price END AS unit_price,
  p.unit_of_issue, p.aac, p.price_date
FROM nsn.identity i LEFT JOIN price p ON p.NIIN=i.NIIN AND p.rn=1'
echo "✓ NSN catalog loaded into BigQuery (dataset nsn) + reference_lookup view rebuilt."
