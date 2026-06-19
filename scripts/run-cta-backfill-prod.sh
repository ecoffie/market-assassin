#!/usr/bin/env bash
# PAUSED (Jun 2026): Pilot uses in-memory CTA tagging on the user feed slice.
# Re-run after org-level CTA reporting + full backfill is scheduled.
set -euo pipefail
URL="https://getmindy.ai/api/cron/tag-cta?limit=100&password=${ADMIN_PASSWORD}"
LOG="$(dirname "$0")/../.cta-backfill.log"
batch=0
while true; do
  batch=$((batch + 1))
  resp=$(curl -s --max-time 130 "$URL")
  ts=$(date "+%Y-%m-%d %H:%M:%S")
  echo "[$ts] batch=$batch $resp" >> "$LOG"
  if ! echo "$resp" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    echo "[$ts] TIMEOUT or bad response — retrying next batch" >> "$LOG"
    sleep 5
    continue
  fi
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
