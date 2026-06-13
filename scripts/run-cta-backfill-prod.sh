#!/usr/bin/env bash
set -euo pipefail
URL="https://getmindy.ai/api/cron/tag-cta?limit=500&password=galata-assassin-2026"
LOG="$(dirname "$0")/../.cta-backfill.log"
batch=0
while true; do
  batch=$((batch + 1))
  resp=$(curl -s --max-time 130 "$URL")
  ts=$(date "+%Y-%m-%d %H:%M:%S")
  echo "[$ts] batch=$batch $resp" >> "$LOG"
  remaining=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('remaining', '?'))")
  processed=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('processed', 0))")
  success=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success', False))")
  if [ "$success" != "True" ]; then
    echo "[$ts] ERROR — stopping" >> "$LOG"
    exit 1
  fi
  if [ "$remaining" = "0" ] || [ "$remaining" = "None" ] || [ "$processed" = "0" ]; then
    echo "[$ts] DONE remaining=$remaining" >> "$LOG"
    exit 0
  fi
  sleep 2
done
