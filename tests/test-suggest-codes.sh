#!/bin/bash
# Test script for /api/suggest-codes endpoint
# Tests both POST (AI suggestions) and GET (direct search)

BASE_URL="https://tools.govcongiants.org"
PASSED=0
FAILED=0

echo "=========================================="
echo "PSC Code Suggestion Feature - Test Suite"
echo "=========================================="
echo ""

# Helper function
test_result() {
    local name="$1"
    local condition="$2"
    if [ "$condition" = "true" ]; then
        echo "✅ PASS: $name"
        ((PASSED++))
    else
        echo "❌ FAIL: $name"
        ((FAILED++))
    fi
}

echo "--- Test 1: POST with valid IT Security description ---"
RESULT=$(curl -s -X POST "$BASE_URL/api/suggest-codes" \
  -H "Content-Type: application/json" \
  -d '{"description": "We provide IT security consulting, penetration testing, and vulnerability assessments for federal agencies"}')

SUCCESS=$(echo "$RESULT" | jq -r '.success')
NAICS_COUNT=$(echo "$RESULT" | jq '.naicsSuggestions | length')
PSC_COUNT=$(echo "$RESULT" | jq '.pscSuggestions | length')
FIRST_NAICS=$(echo "$RESULT" | jq -r '.naicsSuggestions[0].code')
FIRST_PSC=$(echo "$RESULT" | jq -r '.pscSuggestions[0].code')
HAS_541512=$(echo "$RESULT" | jq '[.naicsSuggestions[].code] | contains(["541512"])')
HAS_D310=$(echo "$RESULT" | jq '[.pscSuggestions[].code] | contains(["D310"])')

test_result "Returns success=true" "$([ "$SUCCESS" = "true" ] && echo true || echo false)"
test_result "Returns 5 NAICS suggestions" "$([ "$NAICS_COUNT" = "5" ] && echo true || echo false)"
test_result "Returns 5 PSC suggestions" "$([ "$PSC_COUNT" = "5" ] && echo true || echo false)"
test_result "NAICS codes are 6 digits" "$([ ${#FIRST_NAICS} = 6 ] && echo true || echo false)"
test_result "PSC codes are 4 characters" "$([ ${#FIRST_PSC} = 4 ] && echo true || echo false)"
test_result "IT Security → includes 541512 (Computer Systems Design)" "$HAS_541512"
test_result "IT Security → includes D310 (Cyber Security)" "$HAS_D310"

echo ""
echo "--- Test 2: POST with Construction description ---"
RESULT=$(curl -s -X POST "$BASE_URL/api/suggest-codes" \
  -H "Content-Type: application/json" \
  -d '{"description": "We are a general contractor specializing in commercial building construction and renovation"}')

SUCCESS=$(echo "$RESULT" | jq -r '.success')
HAS_236=$(echo "$RESULT" | jq '[.naicsSuggestions[].code] | any(startswith("236"))')
HIGH_CONF=$(echo "$RESULT" | jq '[.naicsSuggestions[].confidence] | contains(["high"])')

test_result "Construction query returns success=true" "$([ "$SUCCESS" = "true" ] && echo true || echo false)"
test_result "Construction → includes 236xxx codes" "$HAS_236"
test_result "Has at least one high confidence suggestion" "$HIGH_CONF"

echo ""
echo "--- Test 3: POST with Healthcare description ---"
RESULT=$(curl -s -X POST "$BASE_URL/api/suggest-codes" \
  -H "Content-Type: application/json" \
  -d '{"description": "We provide medical staffing services and healthcare consulting for hospitals"}')

SUCCESS=$(echo "$RESULT" | jq -r '.success')
HAS_621=$(echo "$RESULT" | jq '[.naicsSuggestions[].code] | any(startswith("621"))')

test_result "Healthcare query returns success=true" "$([ "$SUCCESS" = "true" ] && echo true || echo false)"
test_result "Healthcare → includes 621xxx codes" "$HAS_621"

echo ""
echo "--- Test 4: POST with short description (error case) ---"
RESULT=$(curl -s -X POST "$BASE_URL/api/suggest-codes" \
  -H "Content-Type: application/json" \
  -d '{"description": "IT"}')

SUCCESS=$(echo "$RESULT" | jq -r '.success')
HAS_ERROR=$(echo "$RESULT" | jq 'has("error")')

test_result "Short description returns success=false" "$([ "$SUCCESS" = "false" ] && echo true || echo false)"
test_result "Short description returns error message" "$HAS_ERROR"

echo ""
echo "--- Test 5: POST with empty description (error case) ---"
RESULT=$(curl -s -X POST "$BASE_URL/api/suggest-codes" \
  -H "Content-Type: application/json" \
  -d '{"description": ""}')

SUCCESS=$(echo "$RESULT" | jq -r '.success')

test_result "Empty description returns success=false" "$([ "$SUCCESS" = "false" ] && echo true || echo false)"

echo ""
echo "--- Test 6: GET search for 'cyber' ---"
RESULT=$(curl -s "$BASE_URL/api/suggest-codes?q=cyber")

SUCCESS=$(echo "$RESULT" | jq -r '.success')
HAS_D310=$(echo "$RESULT" | jq '[.results[].code] | contains(["D310"])')
COUNT=$(echo "$RESULT" | jq '.count')

test_result "GET search returns success=true" "$([ "$SUCCESS" = "true" ] && echo true || echo false)"
test_result "GET search for 'cyber' includes D310" "$HAS_D310"
test_result "GET search returns count > 0" "$([ "$COUNT" -gt 0 ] && echo true || echo false)"

echo ""
echo "--- Test 7: GET search for 'construction' ---"
RESULT=$(curl -s "$BASE_URL/api/suggest-codes?q=construction")

SUCCESS=$(echo "$RESULT" | jq -r '.success')
COUNT=$(echo "$RESULT" | jq '.count')

test_result "GET search for construction returns success=true" "$([ "$SUCCESS" = "true" ] && echo true || echo false)"
test_result "GET search for construction returns results" "$([ "$COUNT" -gt 0 ] && echo true || echo false)"

echo ""
echo "--- Test 8: GET with short query (error case) ---"
RESULT=$(curl -s "$BASE_URL/api/suggest-codes?q=a")

SUCCESS=$(echo "$RESULT" | jq -r '.success')

test_result "Short query returns success=false" "$([ "$SUCCESS" = "false" ] && echo true || echo false)"

echo ""
echo "--- Test 9: Confidence levels are valid ---"
RESULT=$(curl -s -X POST "$BASE_URL/api/suggest-codes" \
  -H "Content-Type: application/json" \
  -d '{"description": "Software development and cloud computing services"}')

VALID_CONF=$(echo "$RESULT" | jq '[.naicsSuggestions[].confidence] | all(. == "high" or . == "medium" or . == "low")')

test_result "All confidence levels are valid (high/medium/low)" "$VALID_CONF"

echo ""
echo "--- Test 10: Reasons are provided ---"
FIRST_REASON=$(echo "$RESULT" | jq -r '.naicsSuggestions[0].reason')

test_result "Suggestions include reason explanations" "$([ -n "$FIRST_REASON" ] && [ "$FIRST_REASON" != "null" ] && echo true || echo false)"

echo ""
echo "=========================================="
echo "TEST RESULTS: $PASSED passed, $FAILED failed"
echo "=========================================="

if [ $FAILED -gt 0 ]; then
    echo "❌ SOME TESTS FAILED"
    exit 1
else
    echo "✅ ALL TESTS PASSED"
    exit 0
fi
