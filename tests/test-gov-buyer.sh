#!/bin/bash
# Dry-run for the Government Buyer Market Research feature.
# Run: ./tests/test-gov-buyer.sh [local|prod] [NAICS]
#
# Exercises the full vertical slice end to end:
#   1. Trigger the daily cron in ENTITIES-ONLY mode for one NAICS
#   2. Confirm sam_entities rows landed (via the rubric API count)
#   3. Mint a gov_buyer test token + provision the test user
#   4. Call the gated /api/gov-buyer/market-research route
#   5. Inspect the rubric output (tiers, marketDepth, Rule-of-Two)
#   6. Verify the access gate: no token -> 401, non-gov_buyer -> 403
#
# PRE-REQS (do these first):
#   - Run the 4 migrations (sam_entities, federal_contacts,
#     user_type_gov_buyer) in Supabase.
#   - Set GOV_BUYER_SEED_NAICS to the test NAICS (or it uses defaults).
#   - jq installed for pretty output (falls back to raw if missing).
#
# Requires deps to call SAM (SAM_API_KEY) + Supabase + BigQuery creds.

set -uo pipefail

ENV="${1:-local}"
NAICS="${2:-541512}"
PASSWORD="${ADMIN_PASSWORD:-galata-assassin-2026}"
TEST_EMAIL="${GOV_BUYER_TEST_EMAIL:-dryrun.tester@agency.gov}"
SELLER_EMAIL="${GOV_BUYER_SELLER_EMAIL:-seller@example.com}"

if [ "$ENV" = "prod" ]; then
  BASE_URL="https://tools.govcongiants.org"
else
  BASE_URL="http://localhost:3000"
fi

HAS_JQ=1; command -v jq >/dev/null 2>&1 || HAS_JQ=0
pp() { if [ "$HAS_JQ" = "1" ]; then jq "$@"; else cat; fi; }

echo "Government Buyer Market Research — dry run"
echo "Base: $BASE_URL   NAICS: $NAICS   Test email: $TEST_EMAIL"
echo "=================================================================="

# ── Step 1: trigger the cron, entities-only, bounded to this NAICS ──
echo ""
echo "[1] Triggering sync-gov-buyer-data (entities only, NAICS=$NAICS)..."
echo "    (entity slices are bounded per run; one call seeds a page)"
CRON_RESP=$(curl -s "$BASE_URL/api/cron/sync-gov-buyer-data?pull=entities&password=$PASSWORD")
echo "$CRON_RESP" | pp '{ success, durationSeconds, entities }' 2>/dev/null || echo "$CRON_RESP"

UPSERTED=$(echo "$CRON_RESP" | { [ "$HAS_JQ" = "1" ] && jq -r '.entities.upserted // 0' || grep -o '"upserted":[0-9]*' | head -1 | cut -d: -f2; })
echo "    -> entities upserted this run: ${UPSERTED:-?}"
if [ "${UPSERTED:-0}" = "0" ]; then
  echo "    ⚠️  0 upserted. Check: SAM_API_KEY set? GOV_BUYER_SEED_NAICS includes $NAICS?"
  echo "       The sync_state slice may already be 'complete' — re-run pulls the next page."
fi

# ── Step 2 + 3: mint a provisioned gov_buyer token ──
echo ""
echo "[2] Minting gov_buyer test token (+ provisioning $TEST_EMAIL)..."
TOKEN_RESP=$(curl -s "$BASE_URL/api/admin/gov-buyer-test-token?password=$PASSWORD&email=$TEST_EMAIL&provision=true")
TOKEN=$(echo "$TOKEN_RESP" | { [ "$HAS_JQ" = "1" ] && jq -r '.sessionToken // empty' || grep -o '"sessionToken":"[^"]*"' | cut -d'"' -f4; })
if [ -z "${TOKEN:-}" ]; then
  echo "    ❌ Failed to mint token:"; echo "$TOKEN_RESP" | pp .
  exit 1
fi
echo "    ✅ token minted, $TEST_EMAIL provisioned as gov_buyer"

# ── Step 4 + 5: call the gated rubric API, inspect output ──
echo ""
echo "[3] Calling /api/gov-buyer/market-research (gov_buyer token)..."
API_RESP=$(curl -s "$BASE_URL/api/gov-buyer/market-research?email=$TEST_EMAIL&naics=$NAICS" \
  -H "x-mi-auth-token: $TOKEN")
echo "$API_RESP" | pp '{ success, marketDepth, ruleOfTwoMet, counts, registeredOnlyCount, dataAsOf, sampleBusinesses: (.businesses[0:3] // []) }' 2>/dev/null || echo "$API_RESP"

# ── Step 6: gate checks ──
echo ""
echo "[4] Access-gate checks..."
NOAUTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE_URL/api/gov-buyer/market-research?email=$TEST_EMAIL&naics=$NAICS")
echo -n "    no token -> expect 401: $NOAUTH_CODE "
[ "$NOAUTH_CODE" = "401" ] && echo "✅" || echo "❌"

# A seller: mint a token but do NOT provision gov_buyer.
SELLER_TOKEN_RESP=$(curl -s "$BASE_URL/api/admin/gov-buyer-test-token?password=$PASSWORD&email=$SELLER_EMAIL")
SELLER_TOKEN=$(echo "$SELLER_TOKEN_RESP" | { [ "$HAS_JQ" = "1" ] && jq -r '.sessionToken // empty' || grep -o '"sessionToken":"[^"]*"' | cut -d'"' -f4; })
SELLER_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE_URL/api/gov-buyer/market-research?email=$SELLER_EMAIL&naics=$NAICS" \
  -H "x-mi-auth-token: $SELLER_TOKEN")
echo -n "    seller token -> expect 403: $SELLER_CODE "
[ "$SELLER_CODE" = "403" ] && echo "✅" || echo "❌ (is $SELLER_EMAIL accidentally a gov_buyer?)"

echo ""
echo "=================================================================="
echo "Dry run complete. Eyeball [3] above:"
echo "  - Do businesses have sane names/state/certs (field mapping OK)?"
echo "  - Are tiers populated, not all 'registered_only' (BQ join working)?"
echo "  - Does marketDepth exclude registered_only but include emerging?"
echo "If field mapping looks wrong, fix entityToRow() in the cron before"
echo "widening GOV_BUYER_SEED_NAICS."
