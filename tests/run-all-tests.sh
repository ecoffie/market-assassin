#!/bin/bash
# Run All Test Suites
# Usage: ./run-all-tests.sh
#
# Exit code = total failures across all suites

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOTAL_PASS=0
TOTAL_FAIL=0
SUITES_RUN=0
SUITES_FAILED=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         MARKET ASSASSIN - FULL TEST SUITE                 ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Date: $(date)"
echo "Target: https://tools.govcongiants.org"
echo ""

# Find all test scripts (except this one and the template creator)
TEST_SCRIPTS=$(find "$SCRIPT_DIR" -maxdepth 1 -name "test-*.sh" -type f | sort)

if [ -z "$TEST_SCRIPTS" ]; then
  echo -e "${YELLOW}No test scripts found in $SCRIPT_DIR${NC}"
  exit 0
fi

# Run each test suite
while IFS= read -r script; do
  [ -z "$script" ] && continue
  SUITE_NAME=$(basename "$script" .sh | sed 's/test-//')

  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}Running: $SUITE_NAME${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""

  # Run the test suite and capture output
  OUTPUT=$(bash "$script" 2>&1)
  EXIT_CODE=$?

  # Parse results from output (macOS compatible)
  PASS_COUNT=$(echo "$OUTPUT" | grep "Passed:" | tail -1 | sed 's/.*Passed:[^0-9]*\([0-9]*\).*/\1/')
  FAIL_COUNT=$(echo "$OUTPUT" | grep "Failed:" | tail -1 | sed 's/.*Failed:[^0-9]*\([0-9]*\).*/\1/')

  # Default to 0 if not found
  PASS_COUNT=${PASS_COUNT:-0}
  FAIL_COUNT=${FAIL_COUNT:-0}

  TOTAL_PASS=$((TOTAL_PASS + PASS_COUNT))
  TOTAL_FAIL=$((TOTAL_FAIL + FAIL_COUNT))
  SUITES_RUN=$((SUITES_RUN + 1))

  if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✓ $SUITE_NAME: $PASS_COUNT passed${NC}"
  else
    echo -e "${RED}✗ $SUITE_NAME: $FAIL_COUNT failed, $PASS_COUNT passed${NC}"
    SUITES_FAILED=$((SUITES_FAILED + 1))
  fi
  echo ""
done <<< "$TEST_SCRIPTS"

# Summary
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    OVERALL RESULTS                        ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Test Suites Run: $SUITES_RUN"
echo "Suites Passed:   $((SUITES_RUN - SUITES_FAILED))"
echo "Suites Failed:   $SUITES_FAILED"
echo ""
echo -e "Total Tests Passed:  ${GREEN}$TOTAL_PASS${NC}"
echo -e "Total Tests Failed:  ${RED}$TOTAL_FAIL${NC}"
echo ""

if [ $TOTAL_FAIL -eq 0 ]; then
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}                    ALL TESTS PASSED                        ${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
else
  echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${RED}                 $TOTAL_FAIL TEST(S) FAILED                  ${NC}"
  echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
fi

echo ""
exit $TOTAL_FAIL
