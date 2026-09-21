#!/bin/bash
# Test script for /api/sample-opportunities endpoint
# Tests fetching samples and extracting patterns from selections

BASE_URL="https://tools.govcongiants.org"
PASSED=0
FAILED=0

echo "==========================================="
echo "Sample Opportunities Picker - Test Suite"
echo "==========================================="
echo ""

# Helper function
test_result() {
    local name="$1"
    local condition="$2"
    if [ "$condition" = "true" ]; then
        echo "PASS: $name"
        ((PASSED++))
    else
        echo "FAIL: $name"
        ((FAILED++))
    fi
}

echo "--- Test 1: GET fetches sample opportunities ---"
RESULT=$(curl -s "$BASE_URL/api/sample-opportunities")

SUCCESS=$(echo "$RESULT" | jq -r '.success')
COUNT=$(echo "$RESULT" | jq '.count')
HAS_OPPS=$(echo "$RESULT" | jq '.opportunities | length > 0')

test_result "GET returns success=true" "$([ "$SUCCESS" = "true" ] && echo true || echo false)"
test_result "GET returns count > 0" "$([ "$COUNT" -gt 0 ] && echo true || echo false)"
test_result "GET returns opportunities array" "$HAS_OPPS"

echo ""
echo "--- Test 2: POST with description returns samples ---"
RESULT=$(curl -s -X POST "$BASE_URL/api/sample-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"description": "We provide IT security consulting and cybersecurity services"}')

SUCCESS=$(echo "$RESULT" | jq -r '.success')
COUNT=$(echo "$RESULT" | jq '.count')
FIRST_OPP=$(echo "$RESULT" | jq -r '.opportunities[0].notice_id')

test_result "POST with description returns success=true" "$([ "$SUCCESS" = "true" ] && echo true || echo false)"
test_result "POST returns count > 0" "$([ "$COUNT" -gt 0 ] && echo true || echo false)"
test_result "POST returns valid notice_id" "$([ -n "$FIRST_OPP" ] && [ "$FIRST_OPP" != "null" ] && echo true || echo false)"

echo ""
echo "--- Test 3: Opportunities have required fields ---"
HAS_TITLE=$(echo "$RESULT" | jq '.opportunities[0] | has("title")')
HAS_DEPT=$(echo "$RESULT" | jq '.opportunities[0] | has("department")')
HAS_NAICS=$(echo "$RESULT" | jq '.opportunities[0] | has("naics_code")')

test_result "Opportunities have title field" "$HAS_TITLE"
test_result "Opportunities have department field" "$HAS_DEPT"
test_result "Opportunities have naics_code field" "$HAS_NAICS"

echo ""
echo "--- Test 4: Extract patterns from selections ---"
# Get some notice IDs first
NOTICE_IDS=$(echo "$RESULT" | jq -r '[.opportunities[0:5][].notice_id] | @json')

RESULT=$(curl -s -X POST "$BASE_URL/api/sample-opportunities" \
  -H "Content-Type: application/json" \
  -d "{\"action\": \"extract\", \"selectedIds\": $NOTICE_IDS}")

SUCCESS=$(echo "$RESULT" | jq -r '.success')
HAS_NAICS=$(echo "$RESULT" | jq 'has("extractedProfile") and .extractedProfile.naicsCodes != null')
HAS_PSC=$(echo "$RESULT" | jq 'has("extractedProfile") and .extractedProfile.pscCodes != null')
HAS_AGENCIES=$(echo "$RESULT" | jq 'has("extractedProfile") and .extractedProfile.agencies != null')
HAS_REC=$(echo "$RESULT" | jq 'has("recommendation")')

test_result "Extract returns success=true" "$([ "$SUCCESS" = "true" ] && echo true || echo false)"
test_result "Extract returns naicsCodes" "$HAS_NAICS"
test_result "Extract returns pscCodes" "$HAS_PSC"
test_result "Extract returns agencies" "$HAS_AGENCIES"
test_result "Extract returns recommendation" "$HAS_REC"

echo ""
echo "--- Test 5: Extract with no selections returns error ---"
RESULT=$(curl -s -X POST "$BASE_URL/api/sample-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"action": "extract", "selectedIds": []}')

SUCCESS=$(echo "$RESULT" | jq -r '.success')
HAS_ERROR=$(echo "$RESULT" | jq 'has("error")')

test_result "Empty selections returns success=false" "$([ "$SUCCESS" = "false" ] && echo true || echo false)"
test_result "Empty selections returns error message" "$HAS_ERROR"

echo ""
echo "--- Test 6: Diverse industry samples ---"
RESULT=$(curl -s "$BASE_URL/api/sample-opportunities")

# Check that we get samples from multiple industries
ALL_NAICS=$(echo "$RESULT" | jq -r '[.opportunities[].naics_code] | unique')
NAICS_COUNT=$(echo "$ALL_NAICS" | jq 'length')

test_result "Returns samples from multiple NAICS codes" "$([ "$NAICS_COUNT" -gt 3 ] && echo true || echo false)"

echo ""
echo "--- Test 7: Roofer onboarding infers and ranks NAICS 238160 ---"
RESULT=$(curl -s -X POST "$BASE_URL/api/sample-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"description": "roofer in south florida"}')

SUCCESS=$(echo "$RESULT" | jq -r '.success')
INFERRED_ROOFING=$(echo "$RESULT" | jq '(.inferredNaicsCodes // []) | index("238160") != null')
INFERRED_FL=$(echo "$RESULT" | jq '(.inferredStates // []) | index("FL") != null')
FIRST_NAICS=$(echo "$RESULT" | jq -r '.opportunities[0].naics_code')
TOP_FIVE_HAS_ROOFING=$(echo "$RESULT" | jq '[.opportunities[0:5][].naics_code] | index("238160") != null')

test_result "Roofer query returns success=true" "$([ "$SUCCESS" = "true" ] && echo true || echo false)"
test_result "Roofer query infers NAICS 238160" "$INFERRED_ROOFING"
test_result "Roofer query infers Florida" "$INFERRED_FL"
test_result "Roofer query ranks NAICS 238160 first" "$([ "$FIRST_NAICS" = "238160" ] && echo true || echo false)"
test_result "Roofer query keeps NAICS 238160 in top 5" "$TOP_FIVE_HAS_ROOFING"

echo ""
echo "==========================================="
echo "TEST RESULTS: $PASSED passed, $FAILED failed"
echo "==========================================="

if [ $FAILED -gt 0 ]; then
    echo "SOME TESTS FAILED"
    exit 1
else
    echo "ALL TESTS PASSED"
    exit 0
fi
