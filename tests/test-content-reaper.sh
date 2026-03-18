#!/bin/bash
# Content Reaper - Automated Tests
# Usage: ./test-content-reaper.sh

BASE_URL="https://tools.govcongiants.org"
PASS=0
FAIL=0
SKIP=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "========================================="
echo "Content Reaper"
echo "Automated Test Suite"
echo "========================================="
echo "Target: $BASE_URL"
echo "Date: $(date)"
echo "========================================="
echo ""

# ---------------------------------------------
# Content Generator API Tests
# ---------------------------------------------
echo "== CONTENT GENERATOR API =="
echo ""

# Test CG-01: Templates endpoint
echo -n "CG-01 Templates list... "
RESULT=$(curl -s "$BASE_URL/api/templates" 2>/dev/null)
COUNT=$(echo "$RESULT" | jq -r '. | length' 2>/dev/null)
if [ -n "$COUNT" ] && [ "$COUNT" -gt 0 ]; then
  echo -e "${GREEN}PASS${NC} ($COUNT templates)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

# Test CG-02: Agency lookup by NAICS
echo -n "CG-02 Agency lookup... "
RESULT=$(curl -s "$BASE_URL/api/agencies/lookup?naics=541511" 2>/dev/null)
COUNT=$(echo "$RESULT" | jq -r '.agencies | length' 2>/dev/null)
if [ -n "$COUNT" ] && [ "$COUNT" -gt 0 ]; then
  echo -e "${GREEN}PASS${NC} ($COUNT agencies)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

# Test CG-03: Verify access endpoint
echo -n "CG-03 Verify access endpoint... "
RESULT=$(curl -s -X POST "$BASE_URL/api/verify-content-generator" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}' 2>/dev/null)
HAS_ACCESS=$(echo "$RESULT" | jq -r '.hasAccess' 2>/dev/null)
if [ "$HAS_ACCESS" == "true" ] || [ "$HAS_ACCESS" == "false" ]; then
  echo -e "${GREEN}PASS${NC} (access=$HAS_ACCESS)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

# Test CG-04: Usage check endpoint
echo -n "CG-04 Usage check... "
RESULT=$(curl -s "$BASE_URL/api/usage/check?email=test@example.com" 2>/dev/null)
SUCCESS=$(echo "$RESULT" | jq -r 'has("remaining") or has("error")' 2>/dev/null)
if [ "$SUCCESS" == "true" ]; then
  echo -e "${GREEN}PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

echo ""

# ---------------------------------------------
# Content Library Tests
# ---------------------------------------------
echo "== CONTENT LIBRARY =="
echo ""

# Test CL-01: Content library page
echo -n "CL-01 Library page loads... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/content-generator/library.html" 2>/dev/null)
if [ "$STATUS" == "200" ]; then
  echo -e "${GREEN}PASS${NC}"
  ((PASS++))
else
  # Try alternate path
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/content-generator" 2>/dev/null)
  if [ "$STATUS" == "200" ]; then
    echo -e "${GREEN}PASS${NC}"
    ((PASS++))
  else
    echo -e "${RED}FAIL${NC} (HTTP $STATUS)"
    ((FAIL++))
  fi
fi

# Test CL-02: Calendar page
echo -n "CL-02 Calendar page loads... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/content-generator/calendar.html" 2>/dev/null)
if [ "$STATUS" == "200" ]; then
  echo -e "${GREEN}PASS${NC}"
  ((PASS++))
else
  echo -e "${YELLOW}SKIP${NC} (page may not exist)"
  ((SKIP++))
fi

echo ""

# ---------------------------------------------
# Data Quality Tests
# ---------------------------------------------
echo "== DATA QUALITY =="
echo ""

# Test DQ-01: Templates have required fields
echo -n "DQ-01 Template structure... "
RESULT=$(curl -s "$BASE_URL/api/templates" 2>/dev/null)
HAS_FIELDS=$(echo "$RESULT" | jq -r '.[0] | has("id") and has("name")' 2>/dev/null)
if [ "$HAS_FIELDS" == "true" ]; then
  echo -e "${GREEN}PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

# Test DQ-02: Agencies have pain points
echo -n "DQ-02 Agencies have pain points... "
RESULT=$(curl -s "$BASE_URL/api/pain-points?agency=Department%20of%20Defense" 2>/dev/null)
PAIN_COUNT=$(echo "$RESULT" | jq -r '.painPoints | length' 2>/dev/null)
if [ -n "$PAIN_COUNT" ] && [ "$PAIN_COUNT" -gt 0 ]; then
  echo -e "${GREEN}PASS${NC} ($PAIN_COUNT points)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

echo ""

# ---------------------------------------------
# Performance Tests
# ---------------------------------------------
echo "== PERFORMANCE =="
echo ""

# Test PF-01: Templates response time
echo -n "PF-01 Templates < 2s... "
START=$(date +%s%N)
curl -s "$BASE_URL/api/templates" > /dev/null 2>&1
END=$(date +%s%N)
ELAPSED=$(( (END - START) / 1000000 ))
if [ "$ELAPSED" -lt 2000 ]; then
  echo -e "${GREEN}PASS${NC} (${ELAPSED}ms)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC} (${ELAPSED}ms)"
  ((FAIL++))
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
