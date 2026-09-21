#!/bin/bash
# Test script for Agency Hierarchy API v2
# Run: ./tests/test-agency-hierarchy.sh [local|prod]

set -e

ENV="${1:-local}"

if [ "$ENV" = "prod" ]; then
  BASE_URL="https://tools.govcongiants.org"
else
  BASE_URL="http://localhost:3000"
fi

echo "Testing Agency Hierarchy API at $BASE_URL"
echo "==========================================="
echo ""

PASS=0
FAIL=0

test_endpoint() {
  local name="$1"
  local endpoint="$2"
  local expected="$3"

  echo -n "Testing: $name... "

  response=$(curl -s "$BASE_URL$endpoint")

  if echo "$response" | grep -q "$expected"; then
    echo "✅ PASS"
    ((PASS++))
  else
    echo "❌ FAIL"
    echo "  Expected: $expected"
    echo "  Got: ${response:0:200}..."
    ((FAIL++))
  fi
}

# Test 1: Service Stats
test_endpoint "Service Stats" \
  "/api/agency-hierarchy?mode=stats" \
  '"success":true'

# Test 2: Search by abbreviation (VA)
test_endpoint "Search VA" \
  "/api/agency-hierarchy?search=VA" \
  'Veterans Affairs'

# Test 3: Search by abbreviation (FEMA)
test_endpoint "Search FEMA" \
  "/api/agency-hierarchy?search=FEMA" \
  'Emergency Management'

# Test 4: Search by abbreviation (DOD)
test_endpoint "Search DOD" \
  "/api/agency-hierarchy?search=DOD" \
  'Defense'

# Test 5: CGAC Lookup (069 = FEMA)
test_endpoint "CGAC 069 Lookup" \
  "/api/agency-hierarchy?cgac=069" \
  '"success":true'

# Test 6: Get Departments
test_endpoint "Get Departments" \
  "/api/agency-hierarchy?mode=departments" \
  '"mode":"departments"'

# Test 7: Direct Agency Lookup
test_endpoint "Agency Lookup" \
  "/api/agency-hierarchy?agency=VA" \
  '"success":true'

# Test 8: Buying Offices
test_endpoint "Buying Offices 541512" \
  "/api/agency-hierarchy?naics=541512&mode=buying" \
  '"mode":"buying"'

# Test 9: Search Offices
test_endpoint "Search Offices" \
  "/api/agency-hierarchy?office=contracting&mode=offices" \
  '"mode":"offices"'

# Test 10: Topic Search (cybersecurity)
test_endpoint "Topic Search" \
  "/api/agency-hierarchy?search=cybersecurity" \
  '"success":true'

# Test 11: Spending Summary
test_endpoint "Spending Summary" \
  "/api/agency-hierarchy?mode=spending" \
  '"mode":"spending"'

# Test 12: Agency Spending
test_endpoint "Agency Spending (DOD)" \
  "/api/agency-hierarchy?mode=spending&agency=DOD" \
  '"mode":"spending"'

# Test 13: Error handling - no params
test_endpoint "Error: No Params" \
  "/api/agency-hierarchy" \
  'At least one parameter required'

# Test 14: Pain points in results
test_endpoint "Pain Points Included" \
  "/api/agency-hierarchy?agency=DOD&include=painPoints" \
  'painPoints'

# Test 15: Contractors in results
test_endpoint "Contractors Included" \
  "/api/agency-hierarchy?agency=Defense&include=contractors" \
  '"success":true'

echo ""
echo "==========================================="
echo "Results: $PASS passed, $FAIL failed"
echo ""

if [ $FAIL -gt 0 ]; then
  exit 1
fi

echo "All tests passed! ✅"
