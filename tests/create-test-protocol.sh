#!/bin/bash
# Create Test Protocol from Template
# Usage: ./create-test-protocol.sh "Feature Name" "feature-name"

FEATURE_DISPLAY="$1"
FEATURE_SLUG="$2"
DATE=$(date "+%B %d, %Y")

if [ -z "$FEATURE_DISPLAY" ] || [ -z "$FEATURE_SLUG" ]; then
  echo "Usage: ./create-test-protocol.sh \"Feature Name\" \"feature-name\""
  echo "Example: ./create-test-protocol.sh \"Live Opportunities\" \"live-opps\""
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROTOCOL_FILE="$SCRIPT_DIR/${FEATURE_SLUG}-test-protocol.md"
SCRIPT_FILE="$SCRIPT_DIR/test-${FEATURE_SLUG}.sh"

# Check if files already exist
if [ -f "$PROTOCOL_FILE" ]; then
  echo "Error: $PROTOCOL_FILE already exists"
  exit 1
fi

# Create protocol from template
sed -e "s/\[FEATURE NAME\]/$FEATURE_DISPLAY/g" \
    -e "s/\[DATE\]/$DATE/g" \
    -e "s/\[feature-name\]/$FEATURE_SLUG/g" \
    -e "s/\[endpoint\]/$FEATURE_SLUG/g" \
    -e "s/\[page\]/$FEATURE_SLUG/g" \
    "$SCRIPT_DIR/TEMPLATE-test-protocol.md" > "$PROTOCOL_FILE"

echo "Created: $PROTOCOL_FILE"

# Create test script template
cat > "$SCRIPT_FILE" << 'SCRIPT_TEMPLATE'
#!/bin/bash
# FEATURE_DISPLAY - Automated Tests
# Usage: ./test-FEATURE_SLUG.sh

BASE_URL="https://tools.govcongiants.org"
PASS=0
FAIL=0
SKIP=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "========================================="
echo "FEATURE_DISPLAY"
echo "Automated Test Suite"
echo "========================================="
echo "Target: $BASE_URL"
echo "Date: $(date)"
echo "========================================="
echo ""

# ---------------------------------------------
# API Tests
# ---------------------------------------------
echo "== API TESTS =="
echo ""

# Test API-01: Basic request
echo -n "API-01 Basic request... "
RESULT=$(curl -s -X GET "$BASE_URL/api/FEATURE_SLUG" 2>/dev/null)
SUCCESS=$(echo "$RESULT" | jq -r '.success // false' 2>/dev/null)
if [ "$SUCCESS" == "true" ]; then
  echo -e "${GREEN}PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}"
  ((FAIL++))
fi

# Add more tests here...

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
SCRIPT_TEMPLATE

# Replace placeholders in script
sed -i '' -e "s/FEATURE_DISPLAY/$FEATURE_DISPLAY/g" \
          -e "s/FEATURE_SLUG/$FEATURE_SLUG/g" \
          "$SCRIPT_FILE"

chmod +x "$SCRIPT_FILE"
echo "Created: $SCRIPT_FILE"

echo ""
echo "Next steps:"
echo "1. Edit $PROTOCOL_FILE with specific test cases"
echo "2. Edit $SCRIPT_FILE with automated tests"
echo "3. Run: bash $SCRIPT_FILE"
echo "4. Update tests/README.md with new entry"
