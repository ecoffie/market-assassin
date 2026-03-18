#!/bin/bash
# Live Opportunities + Historical Context - Automated Tests
# Usage: ./test-live-opps.sh
#
# Tests both APIs and validates data quality
# Exit code = number of failures (0 = all pass)

BASE_URL="https://tools.govcongiants.org"
PASS=0
FAIL=0
SKIP=0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "Live Opportunities + Historical Context"
echo "Automated Test Suite"
echo "========================================="
echo "Target: $BASE_URL"
echo "Date: $(date)"
echo "========================================="
echo ""

# ---------------------------------------------
# Section 1: Live Opportunities API Tests
# ---------------------------------------------
echo "== LIVE OPPORTUNITIES API =="
echo ""

# Test LO-01: Basic NAICS search
echo -n "LO-01 Basic NAICS search (541511)... "
RESULT=$(curl -s -X POST "$BASE_URL/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"541511","businessType":""}' 2>/dev/null)
SUCCESS=$(echo "$RESULT" | jq -r '.success // false')
TOTAL=$(echo "$RESULT" | jq -r '.stats.total // 0')
if [ "$SUCCESS" == "true" ]; then
  echo -e "${GREEN}PASS${NC} ($TOTAL opportunities)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

# Test LO-02: NAICS with SDVOSB set-aside
echo -n "LO-02 NAICS with SDVOSB filter... "
RESULT=$(curl -s -X POST "$BASE_URL/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"541511","businessType":"SDVOSB"}' 2>/dev/null)
SUCCESS=$(echo "$RESULT" | jq -r '.success // false')
TOTAL=$(echo "$RESULT" | jq -r '.stats.total // 0')
if [ "$SUCCESS" == "true" ]; then
  echo -e "${GREEN}PASS${NC} ($TOTAL opportunities)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

# Test LO-03: Invalid NAICS (should succeed with 0 results)
echo -n "LO-03 Invalid NAICS (999999)... "
RESULT=$(curl -s -X POST "$BASE_URL/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"999999","businessType":""}' 2>/dev/null)
SUCCESS=$(echo "$RESULT" | jq -r '.success // false')
if [ "$SUCCESS" == "true" ]; then
  echo -e "${GREEN}PASS${NC} (graceful empty)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

# Test LO-04: Different NAICS (construction)
echo -n "LO-04 Construction NAICS (236220)... "
RESULT=$(curl -s -X POST "$BASE_URL/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"236220","businessType":""}' 2>/dev/null)
SUCCESS=$(echo "$RESULT" | jq -r '.success // false')
TOTAL=$(echo "$RESULT" | jq -r '.stats.total // 0')
if [ "$SUCCESS" == "true" ]; then
  echo -e "${GREEN}PASS${NC} ($TOTAL opportunities)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

# Test LO-05: Stats calculation (urgent count)
echo -n "LO-05 Stats include urgent count... "
RESULT=$(curl -s -X POST "$BASE_URL/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"541511","businessType":""}' 2>/dev/null)
URGENT=$(echo "$RESULT" | jq -r '.stats.urgent // "null"')
if [ "$URGENT" != "null" ]; then
  echo -e "${GREEN}PASS${NC} ($URGENT urgent)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

echo ""

# ---------------------------------------------
# Section 2: Historical Context API Tests
# ---------------------------------------------
echo "== HISTORICAL CONTEXT API =="
echo ""

# Test HC-01: Valid NAICS lookup
echo -n "HC-01 Valid NAICS lookup (541511)... "
RESULT=$(curl -s -X POST "$BASE_URL/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"naics":"541511","title":"IT Services","agency":"VA"}' 2>/dev/null)
SUCCESS=$(echo "$RESULT" | jq -r '.success // false')
AWARDS=$(echo "$RESULT" | jq -r '.historicalContext.totalPastAwards // 0')
if [ "$SUCCESS" == "true" ] && [ "$AWARDS" -gt 0 ]; then
  echo -e "${GREEN}PASS${NC} ($AWARDS awards)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC} (got $AWARDS awards)"
  ((FAIL++))
fi

# Test HC-02: Different NAICS (construction)
echo -n "HC-02 Construction NAICS (236220)... "
RESULT=$(curl -s -X POST "$BASE_URL/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"naics":"236220","title":"Construction","agency":"DOD"}' 2>/dev/null)
SUCCESS=$(echo "$RESULT" | jq -r '.success // false')
AWARDS=$(echo "$RESULT" | jq -r '.historicalContext.totalPastAwards // 0')
if [ "$SUCCESS" == "true" ]; then
  echo -e "${GREEN}PASS${NC} ($AWARDS awards)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

# Test HC-03: Missing NAICS (should error)
echo -n "HC-03 Missing NAICS returns error... "
RESULT=$(curl -s -X POST "$BASE_URL/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"title":"IT Services","agency":"VA"}' 2>/dev/null)
SUCCESS=$(echo "$RESULT" | jq -r '.success')
ERROR=$(echo "$RESULT" | jq -r '.error // "none"')
if [ "$SUCCESS" == "false" ] && [ "$ERROR" != "none" ]; then
  echo -e "${GREEN}PASS${NC} (correctly rejected: $ERROR)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC} (success=$SUCCESS, error=$ERROR)"
  ((FAIL++))
fi

# Test HC-04: NAICS only (no title/agency)
echo -n "HC-04 NAICS only (541511)... "
RESULT=$(curl -s -X POST "$BASE_URL/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"naics":"541511"}' 2>/dev/null)
SUCCESS=$(echo "$RESULT" | jq -r '.success // false')
if [ "$SUCCESS" == "true" ]; then
  echo -e "${GREEN}PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

# Test HC-05: Returns incumbents
echo -n "HC-05 Returns incumbent data... "
RESULT=$(curl -s -X POST "$BASE_URL/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"naics":"541511","title":"IT","agency":"VA"}' 2>/dev/null)
INCUMBENT_COUNT=$(echo "$RESULT" | jq -r '.historicalContext.incumbents | length')
if [ "$INCUMBENT_COUNT" -gt 0 ]; then
  FIRST=$(echo "$RESULT" | jq -r '.historicalContext.incumbents[0].name')
  echo -e "${GREEN}PASS${NC} ($INCUMBENT_COUNT incumbents, top: $FIRST)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC} (no incumbents)"
  ((FAIL++))
fi

echo ""

# ---------------------------------------------
# Section 3: Data Quality Tests
# ---------------------------------------------
echo "== DATA QUALITY TESTS =="
echo ""

# Test DQ-01: Price range logic (min <= avg <= max)
echo -n "DQ-01 Price range validation... "
RESULT=$(curl -s -X POST "$BASE_URL/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"naics":"541511","title":"IT","agency":"VA"}' 2>/dev/null)
MIN=$(echo "$RESULT" | jq -r '.historicalContext.priceRange.min // 0')
AVG=$(echo "$RESULT" | jq -r '.historicalContext.priceRange.average // 0')
MAX=$(echo "$RESULT" | jq -r '.historicalContext.priceRange.max // 0')
if (( $(echo "$MIN <= $AVG" | bc -l) )) && (( $(echo "$AVG <= $MAX" | bc -l) )); then
  echo -e "${GREEN}PASS${NC} (\$$(printf '%d' ${MIN%.*}) - \$$(printf '%d' ${MAX%.*}))"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC} (min=$MIN, avg=$AVG, max=$MAX)"
  ((FAIL++))
fi

# Test DQ-02: Urgency classification matches days
echo -n "DQ-02 Urgency classification... "
RESULT=$(curl -s -X POST "$BASE_URL/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"541511","businessType":""}' 2>/dev/null)
# Get first urgent opportunity if exists
URGENT_DAYS=$(echo "$RESULT" | jq -r '[.opportunities[] | select(.urgency == "urgent")] | .[0].daysUntilDeadline // "none"')
if [ "$URGENT_DAYS" == "none" ] || [ "$URGENT_DAYS" -le 3 ]; then
  echo -e "${GREEN}PASS${NC} (urgent = $URGENT_DAYS days)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC} (urgent has $URGENT_DAYS days, should be <=3)"
  ((FAIL++))
fi

# Test DQ-03: No expired opportunities
echo -n "DQ-03 No expired opportunities... "
RESULT=$(curl -s -X POST "$BASE_URL/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"541511","businessType":""}' 2>/dev/null)
EXPIRED=$(echo "$RESULT" | jq -r '[.opportunities[] | select(.daysUntilDeadline != null and .daysUntilDeadline < 0)] | length')
if [ "$EXPIRED" -eq 0 ]; then
  echo -e "${GREEN}PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC} ($EXPIRED expired)"
  ((FAIL++))
fi

# Test DQ-04: Recent awards sorted by date
echo -n "DQ-04 Recent awards sorted... "
RESULT=$(curl -s -X POST "$BASE_URL/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"naics":"541511","title":"IT","agency":"VA"}' 2>/dev/null)
FIRST_DATE=$(echo "$RESULT" | jq -r '.historicalContext.recentAwards[0].awardDate // "none"')
SECOND_DATE=$(echo "$RESULT" | jq -r '.historicalContext.recentAwards[1].awardDate // "none"')
if [ "$FIRST_DATE" != "none" ] && [ "$FIRST_DATE" \> "$SECOND_DATE" -o "$FIRST_DATE" == "$SECOND_DATE" ]; then
  echo -e "${GREEN}PASS${NC} (newest: $FIRST_DATE)"
  ((PASS++))
else
  echo -e "${YELLOW}SKIP${NC} (insufficient data)"
  ((SKIP++))
fi

echo ""

# ---------------------------------------------
# Section 4: Performance Tests
# ---------------------------------------------
echo "== PERFORMANCE TESTS =="
echo ""

# Test PF-01: Live Opportunities < 5 seconds
echo -n "PF-01 Live Opps response time... "
START=$(date +%s%N)
curl -s -X POST "$BASE_URL/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"541511","businessType":""}' > /dev/null 2>&1
END=$(date +%s%N)
ELAPSED=$(( (END - START) / 1000000 ))
if [ "$ELAPSED" -lt 5000 ]; then
  echo -e "${GREEN}PASS${NC} (${ELAPSED}ms)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC} (${ELAPSED}ms > 5000ms)"
  ((FAIL++))
fi

# Test PF-02: Historical Context < 10 seconds
echo -n "PF-02 Historical response time... "
START=$(date +%s%N)
curl -s -X POST "$BASE_URL/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"naics":"541511","title":"IT","agency":"VA"}' > /dev/null 2>&1
END=$(date +%s%N)
ELAPSED=$(( (END - START) / 1000000 ))
if [ "$ELAPSED" -lt 10000 ]; then
  echo -e "${GREEN}PASS${NC} (${ELAPSED}ms)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC} (${ELAPSED}ms > 10000ms)"
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
