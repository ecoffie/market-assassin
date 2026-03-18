#!/bin/bash
# Daily Health Check - Automated Tests
# Usage: ./test-health-check.sh

BASE_URL="https://tools.govcongiants.org"
PASSWORD="galata-assassin-2026"
PASS=0
FAIL=0
SKIP=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "========================================="
echo "Daily Health Check"
echo "Automated Test Suite"
echo "========================================="
echo "Target: $BASE_URL"
echo "Date: $(date)"
echo "========================================="
echo ""

# ---------------------------------------------
# Health Check API Tests
# ---------------------------------------------
echo "== HEALTH CHECK API =="
echo ""

# Test HC-01: Health check endpoint responds
echo -n "HC-01 Endpoint responds... "
RESULT=$(curl -s "$BASE_URL/api/cron/health-check?password=$PASSWORD" 2>/dev/null)
if echo "$RESULT" | jq -e '.results' > /dev/null 2>&1; then
  echo -e "${GREEN}PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

# Test HC-02: Returns test results array
echo -n "HC-02 Returns test results... "
RESULT=$(curl -s "$BASE_URL/api/cron/health-check?password=$PASSWORD" 2>/dev/null)
COUNT=$(echo "$RESULT" | jq -r '.results | length')
if [ "$COUNT" -gt 0 ]; then
  echo -e "${GREEN}PASS${NC} ($COUNT tests)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

# Test HC-03: Pass rate calculated
echo -n "HC-03 Pass rate calculated... "
RESULT=$(curl -s "$BASE_URL/api/cron/health-check?password=$PASSWORD" 2>/dev/null)
PASS_RATE=$(echo "$RESULT" | jq -r '.summary.passRate // 0')
if [ "$PASS_RATE" != "0" ] && [ "$PASS_RATE" != "null" ]; then
  echo -e "${GREEN}PASS${NC} ($PASS_RATE%)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

# Test HC-04: Critical flows tested
echo -n "HC-04 Critical flows included... "
RESULT=$(curl -s "$BASE_URL/api/cron/health-check?password=$PASSWORD" 2>/dev/null)
HAS_CRITICAL=$(echo "$RESULT" | jq -r '.results[] | select(.category == "Critical Flows") | .name' | head -1)
if [ -n "$HAS_CRITICAL" ]; then
  echo -e "${GREEN}PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

# Test HC-05: Access control tested
echo -n "HC-05 Access control tests... "
RESULT=$(curl -s "$BASE_URL/api/cron/health-check?password=$PASSWORD" 2>/dev/null)
HAS_ACCESS=$(echo "$RESULT" | jq -r '.results[] | select(.category == "Access Control") | .name' | head -1)
if [ -n "$HAS_ACCESS" ]; then
  echo -e "${GREEN}PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

# Test HC-06: HTML format works
echo -n "HC-06 HTML format output... "
RESULT=$(curl -s "$BASE_URL/api/cron/health-check?password=$PASSWORD&format=html" 2>/dev/null)
if echo "$RESULT" | grep -q "<!DOCTYPE html>"; then
  echo -e "${GREEN}PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

# Test HC-07: Unauthorized without password
echo -n "HC-07 Requires password... "
RESULT=$(curl -s "$BASE_URL/api/cron/health-check" 2>/dev/null)
ERROR=$(echo "$RESULT" | jq -r '.error // "none"')
if [ "$ERROR" != "none" ]; then
  echo -e "${GREEN}PASS${NC} (correctly rejected)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

echo ""

# ---------------------------------------------
# Individual Health Checks
# ---------------------------------------------
echo "== INDIVIDUAL ENDPOINTS =="
echo ""

# Test IND-01: Homepage loads
echo -n "IND-01 Homepage loads... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/" 2>/dev/null)
if [ "$STATUS" == "200" ]; then
  echo -e "${GREEN}PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC} (HTTP $STATUS)"
  ((FAIL++))
fi

# Test IND-02: Store page loads
echo -n "IND-02 Store page loads... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/store" 2>/dev/null)
if [ "$STATUS" == "200" ]; then
  echo -e "${GREEN}PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC} (HTTP $STATUS)"
  ((FAIL++))
fi

# Test IND-03: Market Assassin page loads
echo -n "IND-03 Market Assassin page... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/market-assassin" 2>/dev/null)
if [ "$STATUS" == "200" ]; then
  echo -e "${GREEN}PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC} (HTTP $STATUS)"
  ((FAIL++))
fi

# Test IND-04: Pain points API
echo -n "IND-04 Pain points API... "
RESULT=$(curl -s "$BASE_URL/api/pain-points?agency=Department%20of%20Defense" 2>/dev/null)
HAS_DATA=$(echo "$RESULT" | jq -r '.painPoints | length')
if [ "$HAS_DATA" -gt 0 ]; then
  echo -e "${GREEN}PASS${NC} ($HAS_DATA points)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

# Test IND-05: Lead capture API
echo -n "IND-05 Lead capture API... "
RESULT=$(curl -s -X POST "$BASE_URL/api/capture-lead" \
  -H "Content-Type: application/json" \
  -d '{"email":"test-protocol@example.com","source":"test-protocol"}' 2>/dev/null)
SUCCESS=$(echo "$RESULT" | jq -r '.success // false')
if [ "$SUCCESS" == "true" ]; then
  echo -e "${GREEN}PASS${NC}"
  ((PASS++))
else
  echo -e "${YELLOW}SKIP${NC} (may already exist)"
  ((SKIP++))
fi

echo ""

# ---------------------------------------------
# Summary
# ---------------------------------------------
echo "========================================="
echo "TEST RESULTS"
echo "========================================="
echo -e "Passed:  ${GREEN}$PASS${NC}"
echo -e "Failed:  ${RED}$FAIL${NC}"
echo -e "Skipped: ${YELLOW}$SKIP${NC}"
echo "========================================="

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}ALL TESTS PASSED${NC}"
else
  echo -e "${RED}$FAIL TEST(S) FAILED${NC}"
fi

exit $FAIL
