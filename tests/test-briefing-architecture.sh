#!/bin/bash
# Test: Briefing Architecture Verification
# Ensures send-briefings-fast uses FAST path (no per-user AI calls)

echo "=== Briefing Architecture Test ==="

ROUTE_FILE="src/app/api/cron/send-briefings-fast/route.ts"

echo -n "1. Checking send-briefings-fast uses GREEN format... "
if grep -q "generateSamGreenEmailHtml" "$ROUTE_FILE" && \
   grep -q "from '@/lib/briefings/delivery/sam-green-email-template'" "$ROUTE_FILE"; then
  echo "PASS"
else
  echo "FAIL - Must use sam-green-email-template for GREEN format"
  exit 1
fi

echo -n "2. Checking uses FAST briefing builder (no AI)... "
if grep -q "buildSamGreenBriefing" "$ROUTE_FILE"; then
  echo "PASS"
else
  echo "FAIL - Must use buildSamGreenBriefing (fast, no AI) instead of generateDailyBriefFromSam"
  exit 1
fi

echo -n "3. Checking NOT using SLOW AI generator... "
# Look for actual import/usage of the slow function
if grep -E "^import.*generateDailyBriefFromSam|await generateDailyBriefFromSam|= generateDailyBriefFromSam" "$ROUTE_FILE"; then
  echo "FAIL - Found generateDailyBriefFromSam (SLOW, ~4s per user)"
  echo "  Use buildSamGreenBriefing instead (instant, no AI)"
  exit 1
else
  echo "PASS"
fi

echo -n "4. Checking uses SAM cache for data... "
if grep -q "fetchSamOpportunitiesFromCache" "$ROUTE_FILE"; then
  echo "PASS"
else
  echo "FAIL - Must use fetchSamOpportunitiesFromCache for data"
  exit 1
fi

echo ""
echo "=== All Architecture Tests Passed ==="
echo "send-briefings-fast correctly uses:"
echo "  - GREEN format (sam-green-email-template)"
echo "  - Fast builder (buildSamGreenBriefing - no AI calls)"
echo "  - SAM cache (fetchSamOpportunitiesFromCache)"
