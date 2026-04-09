#!/bin/bash
# =============================================================================
# BRIEFING SYSTEM QA/QC TEST SCRIPT
# =============================================================================
#
# Run this script before and after deploying briefing system changes.
# Tests the following:
# 1. LLM Router (Groq → Claude Haiku → OpenAI fallback)
# 2. Briefing generation speed
# 3. Email delivery
# 4. Batch processing
#
# Usage:
#   ./tests/test-briefing-system.sh local   # Test local dev
#   ./tests/test-briefing-system.sh prod    # Test production
#
# =============================================================================

set -e

ENV="${1:-local}"
PASSWORD="galata-assassin-2026"
TEST_EMAIL="eric@govcongiants.com"

if [ "$ENV" == "prod" ]; then
  BASE_URL="https://tools.govcongiants.org"
else
  BASE_URL="http://localhost:3000"
fi

echo "=========================================="
echo "BRIEFING SYSTEM QA/QC TESTS"
echo "Environment: $ENV"
echo "Base URL: $BASE_URL"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass() {
  echo -e "${GREEN}✓ PASS${NC}: $1"
}

fail() {
  echo -e "${RED}✗ FAIL${NC}: $1"
}

warn() {
  echo -e "${YELLOW}⚠ WARN${NC}: $1"
}

# =============================================================================
# TEST 1: Check if GROQ_API_KEY is configured (via LLM Router test)
# =============================================================================
echo "TEST 1: LLM Router Configuration"
echo "--------------------------------"

RESPONSE=$(curl -s "${BASE_URL}/api/admin/test-ai-briefing?password=${PASSWORD}&email=${TEST_EMAIL}" 2>/dev/null)

if echo "$RESPONSE" | grep -q '"success":true'; then
  pass "AI Briefing generator is working"

  # Extract processing time
  PROCESSING_TIME=$(echo "$RESPONSE" | grep -o '"processingTimeMs":[0-9]*' | grep -o '[0-9]*')

  if [ -n "$PROCESSING_TIME" ]; then
    echo "   Processing time: ${PROCESSING_TIME}ms"

    if [ "$PROCESSING_TIME" -lt 5000 ]; then
      pass "Processing time < 5s (likely using Groq)"
    elif [ "$PROCESSING_TIME" -lt 15000 ]; then
      warn "Processing time 5-15s (may be using Claude)"
    else
      warn "Processing time > 15s (slow - check LLM config)"
    fi
  fi

  # Extract opportunity count
  OPP_COUNT=$(echo "$RESPONSE" | grep -o '"opportunities":[0-9]*' | grep -o '[0-9]*')
  if [ -n "$OPP_COUNT" ] && [ "$OPP_COUNT" -gt 0 ]; then
    pass "Generated $OPP_COUNT opportunities"
  else
    warn "No opportunities generated"
  fi
else
  fail "AI Briefing generator failed"
  echo "   Response: $(echo "$RESPONSE" | head -c 200)"
fi

echo ""

# =============================================================================
# TEST 2: Check briefing_log for recent deliveries
# =============================================================================
echo "TEST 2: Briefing Delivery Status"
echo "--------------------------------"

# Query Supabase for recent briefing logs
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtycHllbGZyYmljbXZzbXdvdnRpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODA3NTUwMCwiZXhwIjoyMDgzNjUxNTAwfQ.vt66ATmjPwS0HclhBP1g1-dQ-aEPEbWwG4xcn8j4GCg"

BRIEFING_LOGS=$(curl -s "https://krpyelfrbicmvsmwovti.supabase.co/rest/v1/briefing_log?select=delivery_status,created_at&order=created_at.desc&limit=20" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" 2>/dev/null)

SENT_COUNT=$(echo "$BRIEFING_LOGS" | grep -o '"delivery_status":"sent"' | wc -l | tr -d ' ')
FAILED_COUNT=$(echo "$BRIEFING_LOGS" | grep -o '"delivery_status":"failed"' | wc -l | tr -d ' ')
PENDING_COUNT=$(echo "$BRIEFING_LOGS" | grep -o '"delivery_status":"pending"' | wc -l | tr -d ' ')

echo "   Recent briefing_log entries:"
echo "   - Sent: $SENT_COUNT"
echo "   - Failed: $FAILED_COUNT"
echo "   - Pending: $PENDING_COUNT"

if [ "$SENT_COUNT" -gt 0 ]; then
  pass "Briefings are being delivered"
else
  warn "No recent successful deliveries"
fi

if [ "$FAILED_COUNT" -gt 5 ]; then
  warn "High failure count ($FAILED_COUNT) - check logs"
fi

echo ""

# =============================================================================
# TEST 3: Check daily-alerts (control group - known working)
# =============================================================================
echo "TEST 3: Daily Alerts (Control)"
echo "--------------------------------"

ALERT_LOGS=$(curl -s "https://krpyelfrbicmvsmwovti.supabase.co/rest/v1/alert_log?select=delivery_status,created_at&order=created_at.desc&limit=20" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" 2>/dev/null)

ALERT_SENT=$(echo "$ALERT_LOGS" | grep -o '"delivery_status":"sent"' | wc -l | tr -d ' ')

if [ "$ALERT_SENT" -gt 5 ]; then
  pass "Daily alerts working ($ALERT_SENT recent sends)"
else
  warn "Daily alerts may be slow (only $ALERT_SENT recent sends)"
fi

echo ""

# =============================================================================
# TEST 4: Check vercel.json cron config
# =============================================================================
echo "TEST 4: Cron Configuration"
echo "--------------------------------"

CRON_COUNT=$(grep -c '"path": "/api/cron/send-briefings"' /Users/ericcoffie/Market\ Assasin/market-assassin/vercel.json 2>/dev/null || echo "0")

echo "   send-briefings cron entries: $CRON_COUNT"

if [ "$CRON_COUNT" -ge 10 ]; then
  pass "Multiple cron runs configured ($CRON_COUNT runs/day)"
else
  warn "Only $CRON_COUNT cron runs - may not cover 250 users"
fi

# Check batch size
BATCH_SIZE=$(grep -o 'BATCH_SIZE = [0-9]*' /Users/ericcoffie/Market\ Assasin/market-assassin/src/app/api/cron/send-briefings/route.ts 2>/dev/null | grep -o '[0-9]*')

if [ -n "$BATCH_SIZE" ]; then
  echo "   BATCH_SIZE: $BATCH_SIZE users/run"

  DAILY_CAPACITY=$((CRON_COUNT * BATCH_SIZE))
  echo "   Daily capacity: $DAILY_CAPACITY users"

  if [ "$DAILY_CAPACITY" -ge 250 ]; then
    pass "Capacity sufficient for 250 users"
  else
    warn "Capacity ($DAILY_CAPACITY) may be insufficient for 250 users"
  fi
fi

echo ""

# =============================================================================
# TEST 5: Email delivery test (optional)
# =============================================================================
echo "TEST 5: Email Delivery Test"
echo "--------------------------------"

if [ "$ENV" == "prod" ]; then
  echo "   Skipping email send test in prod (use &send=true manually)"
  echo "   To test: ${BASE_URL}/api/admin/test-ai-briefing?password=${PASSWORD}&email=${TEST_EMAIL}&send=true"
else
  echo "   Running email delivery test..."

  EMAIL_RESPONSE=$(curl -s "${BASE_URL}/api/admin/test-ai-briefing?password=${PASSWORD}&email=${TEST_EMAIL}&send=true" 2>/dev/null)

  if echo "$EMAIL_RESPONSE" | grep -q '"emailSent":true'; then
    pass "Email delivered successfully"
  else
    warn "Email delivery failed or skipped"
  fi
fi

echo ""
echo "=========================================="
echo "QA/QC TESTS COMPLETE"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. If all tests pass, deploy with: vercel --prod"
echo "2. Monitor first cron run in Vercel logs"
echo "3. Check briefing_log 30 min after deployment"
echo ""
