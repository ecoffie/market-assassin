#!/bin/bash
# Resumable full re-drain: vehicles/delivery-orders first (--skip-po), value-DESC order.
# Each pass stamps map_loc_source so processed rows drop out; loop until a pass processes 0.
cd "/Users/ericcoffie/Market Assasin/market-assassin"
PASS=0
while true; do
  PASS=$((PASS+1))
  OUT=$(npx tsx scripts/backfill-recompete-map-latlng.ts --go --skip-po --limit 2000 --concurrency 8 2>&1 | grep -vE "injected env")
  echo "=== PASS $PASS ==="
  echo "$OUT" | grep -E "Processing|processed|real task-order|🚨|FAILED" | tail -4
  # stop if a pass processed 0 rows, or a quota storm hit
  if echo "$OUT" | grep -qE "Processing 0 this run|✅ 0 processed"; then echo "DRAINED (0 rows left in skip-po scope)."; break; fi
  if echo "$OUT" | grep -qE "🚨"; then echo "QUOTA STORM — stopping loop (fail-loud left rows NULL for retry)."; break; fi
done
echo "=== skip-po scope drained. Remaining (incl POs) will map by state on a final no-skip pass. ==="
