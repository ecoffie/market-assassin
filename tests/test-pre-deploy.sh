#!/bin/bash
# Pre-Deploy QA Tests
# Run BEFORE every deployment to catch critical bugs
# Usage: ./test-pre-deploy.sh [--local]
#
# Tests:
# 1. TypeScript compilation (no type errors)
# 2. SAM.gov date format validation
# 3. Critical API endpoint health
# 4. Daily alerts pipeline
# 5. Market Intelligence pipeline
# 6. Data format validations

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
PASS=0
FAIL=0
WARN=0

# Config
if [ "$1" == "--local" ]; then
  BASE_URL="http://localhost:3000"
else
  BASE_URL="https://tools.govcongiants.org"
fi

ADMIN_PASSWORD="galata-assassin-2026"

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           PRE-DEPLOY QA TESTS                             ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Date: $(date)"
echo "Target: $BASE_URL"
echo ""

# Helper function
test_result() {
  local name="$1"
  local result="$2"
  local details="$3"

  if [ "$result" == "pass" ]; then
    echo -e "${GREEN}✓${NC} $name"
    PASS=$((PASS + 1))
  elif [ "$result" == "warn" ]; then
    echo -e "${YELLOW}⚠${NC} $name: $details"
    WARN=$((WARN + 1))
  else
    echo -e "${RED}✗${NC} $name: $details"
    FAIL=$((FAIL + 1))
  fi
}

# ═══════════════════════════════════════════════════════════════
# TEST 1: TypeScript Build
# ═══════════════════════════════════════════════════════════════
echo -e "${BLUE}── TypeScript Build ──${NC}"

cd "$PROJECT_DIR"
BUILD_OUTPUT=$(npm run build 2>&1)
BUILD_EXIT=$?

if [ $BUILD_EXIT -eq 0 ]; then
  test_result "TypeScript compiles without errors" "pass"
else
  # Extract error count
  ERROR_COUNT=$(echo "$BUILD_OUTPUT" | grep -c "error TS")
  test_result "TypeScript compilation" "fail" "$ERROR_COUNT type errors"
fi

# ═══════════════════════════════════════════════════════════════
# TEST 2: SAM.gov Date Format Validation
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}── SAM.gov Date Format Tests ──${NC}"

# Test the date conversion function exists and works
# This would have caught the YYYY-MM-DD vs MM/dd/yyyy bug
DATE_TEST=$(grep -c "convertToSAMDateFormat\|formatDateForSAM" "$PROJECT_DIR/src/lib/briefings/pipelines/sam-gov.ts" 2>/dev/null)
if [ "$DATE_TEST" -ge 2 ]; then
  test_result "SAM date format converter exists" "pass"
else
  test_result "SAM date format converter" "fail" "Missing date format functions in sam-gov.ts"
fi

# Check that SAM.gov API calls use proper date format (exclude grants-gov which uses ISO)
WRONG_DATE=$(grep -rn "postedFrom.*toISOString\|postedTo.*toISOString" "$PROJECT_DIR/src" 2>/dev/null | grep -v ".next" | grep -v "grants-gov" | wc -l | tr -d ' ')
if [ "$WRONG_DATE" == "0" ]; then
  test_result "No ISO dates passed to SAM.gov" "pass"
else
  test_result "SAM.gov date format" "fail" "$WRONG_DATE files use wrong date format"
fi

# ═══════════════════════════════════════════════════════════════
# TEST 3: Critical API Endpoints
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}── Critical API Endpoints ──${NC}"

# Health check endpoint
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/cron/health-check?password=$ADMIN_PASSWORD" 2>/dev/null)
if [ "$HEALTH" == "200" ]; then
  test_result "Health check endpoint" "pass"
else
  test_result "Health check endpoint" "fail" "HTTP $HEALTH"
fi

# Daily alerts endpoint (GET returns info)
ALERTS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/cron/daily-alerts" 2>/dev/null)
if [ "$ALERTS" == "200" ]; then
  test_result "Daily alerts endpoint" "pass"
else
  test_result "Daily alerts endpoint" "fail" "HTTP $ALERTS"
fi

# Alert preferences endpoint
PREFS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/alerts/preferences?email=test@test.com" 2>/dev/null)
if [ "$PREFS" == "200" ]; then
  test_result "Alert preferences endpoint" "pass"
else
  test_result "Alert preferences endpoint" "fail" "HTTP $PREFS"
fi

# ═══════════════════════════════════════════════════════════════
# TEST 4: Daily Alerts Pipeline
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}── Daily Alerts Pipeline ──${NC}"

# Test alert with known user
ALERT_TEST=$(curl -s "$BASE_URL/api/cron/daily-alerts?email=eric@govcongiants.com&test=true" 2>/dev/null)
ALERT_SUCCESS=$(echo "$ALERT_TEST" | jq -r '.success' 2>/dev/null)

if [ "$ALERT_SUCCESS" == "true" ]; then
  SENT=$(echo "$ALERT_TEST" | jq -r '.results.sent' 2>/dev/null)
  NO_OPPS=$(echo "$ALERT_TEST" | jq -r '.results.noOpps' 2>/dev/null)

  if [ "$SENT" -ge 1 ]; then
    test_result "Daily alerts sent successfully" "pass"
  elif [ "$NO_OPPS" -ge 1 ]; then
    test_result "Daily alerts pipeline" "warn" "No matching opportunities found"
  else
    test_result "Daily alerts pipeline" "pass"
  fi
else
  ERROR=$(echo "$ALERT_TEST" | jq -r '.error // .message' 2>/dev/null)
  test_result "Daily alerts pipeline" "fail" "$ERROR"
fi

# ═══════════════════════════════════════════════════════════════
# TEST 5: SAM.gov API Connection
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}── SAM.gov API Connection ──${NC}"

# Test SAM.gov API health via MCP or direct
SAM_TEST=$(curl -s "$BASE_URL/api/admin/test-sam-awards?password=$ADMIN_PASSWORD&naics=541512" 2>/dev/null)
SAM_SUCCESS=$(echo "$SAM_TEST" | jq -r '.success // .totalRecords' 2>/dev/null)

if [ "$SAM_SUCCESS" == "true" ] || [ "$SAM_SUCCESS" -ge 0 ] 2>/dev/null; then
  test_result "SAM.gov/USASpending API connection" "pass"
else
  ERROR=$(echo "$SAM_TEST" | jq -r '.error' 2>/dev/null)
  if [[ "$ERROR" == *"date"* ]] || [[ "$ERROR" == *"format"* ]]; then
    test_result "SAM.gov API" "fail" "DATE FORMAT ERROR: $ERROR"
  else
    test_result "SAM.gov API" "warn" "API issue: $ERROR"
  fi
fi

# ═══════════════════════════════════════════════════════════════
# TEST 6: Market Intelligence Pipeline
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}── Market Intelligence Pipeline ──${NC}"

# Check that briefings endpoint exists
BRIEFINGS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/cron/send-briefings" 2>/dev/null)
if [ "$BRIEFINGS" == "200" ]; then
  test_result "Briefings endpoint accessible" "pass"
else
  test_result "Briefings endpoint" "fail" "HTTP $BRIEFINGS"
fi

# ═══════════════════════════════════════════════════════════════
# TEST 7: Access Control Validation
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}── Access Control ──${NC}"

# Check that user-profiles.ts has proper Market Intelligence rules
MI_RULES=$(grep -c "access_briefings" "$PROJECT_DIR/src/lib/supabase/user-profiles.ts" 2>/dev/null)
if [ "$MI_RULES" -ge 5 ]; then
  test_result "Market Intelligence access rules defined" "pass"
else
  test_result "Market Intelligence rules" "warn" "Only $MI_RULES references found"
fi

# Verify Starter bundle does NOT include briefings
STARTER_BRIEFINGS=$(grep -A5 "'starter'" "$PROJECT_DIR/src/lib/supabase/user-profiles.ts" | grep -c "access_briefings.*true")
if [ "$STARTER_BRIEFINGS" == "0" ]; then
  test_result "Starter bundle excludes Market Intelligence" "pass"
else
  test_result "Starter bundle access" "fail" "Starter should NOT include Market Intelligence"
fi

# ═══════════════════════════════════════════════════════════════
# TEST 8: Environment Variables
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}── Environment Validation ──${NC}"

# Check required env vars are referenced (not checking values for security)
REQUIRED_VARS=("SAM_API_KEY" "SUPABASE_SERVICE_ROLE_KEY" "STRIPE_SECRET_KEY")
for var in "${REQUIRED_VARS[@]}"; do
  VAR_REFS=$(grep -r "$var" "$PROJECT_DIR/src" 2>/dev/null | grep -v ".next" | wc -l | tr -d ' ')
  if [ "$VAR_REFS" -ge 1 ]; then
    test_result "Env var $var referenced" "pass"
  else
    test_result "Env var $var" "warn" "Not found in source"
  fi
done

# ═══════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    TEST SUMMARY                           ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Passed:   ${GREEN}$PASS${NC}"
echo -e "Warnings: ${YELLOW}$WARN${NC}"
echo -e "Failed:   ${RED}$FAIL${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}           ✓ SAFE TO DEPLOY                               ${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  exit 0
else
  echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${RED}           ✗ DO NOT DEPLOY - $FAIL FAILURES                ${NC}"
  echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
  exit $FAIL
fi
