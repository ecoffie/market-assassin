# Live Opportunities + Historical Context - Test Protocol

**Feature**: Market Assassin Hit List - Live SAM.gov Opportunities with Historical Intel
**Version**: 1.0
**Last Updated**: March 18, 2026

---

## Quick Health Check

Run this curl command to verify both APIs are operational:

```bash
# Test Live Opportunities
curl -s -X POST "https://tools.govcongiants.org/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"541511","businessType":""}' | jq '.success, .stats'

# Test Historical Context
curl -s -X POST "https://tools.govcongiants.org/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"title":"IT Services","agency":"VA","naics":"541511"}' | jq '.success, .historicalContext.totalPastAwards'
```

**Expected**: Both return `true` and numeric values > 0

---

## 1. API Tests

### 1.1 Live Opportunities API (`/api/sam/live-opportunities`)

| Test ID | Test Case | Input | Expected Result | Pass/Fail |
|---------|-----------|-------|-----------------|-----------|
| LO-01 | Basic NAICS search | `{"naicsCode":"541511"}` | Returns opportunities array, success=true | |
| LO-02 | NAICS with set-aside | `{"naicsCode":"541511","businessType":"SDVOSB"}` | Returns filtered opportunities (may be 0) | |
| LO-03 | Invalid NAICS | `{"naicsCode":"999999"}` | Returns success=true, empty array | |
| LO-04 | Empty NAICS | `{"naicsCode":""}` | Returns opportunities (broad search) | |
| LO-05 | Multiple business types | `{"naicsCode":"541511","businessType":"8a"}` | Returns 8(a) set-aside filtered results | |

**Curl Commands:**

```bash
# LO-01: Basic NAICS
curl -s -X POST "https://tools.govcongiants.org/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"541511","businessType":""}' | jq '{success, total: .stats.total, urgent: .stats.urgent}'

# LO-02: NAICS + SDVOSB
curl -s -X POST "https://tools.govcongiants.org/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"541511","businessType":"SDVOSB"}' | jq '{success, total: .stats.total}'

# LO-03: Invalid NAICS
curl -s -X POST "https://tools.govcongiants.org/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"999999","businessType":""}' | jq '{success, total: .stats.total}'

# LO-04: Empty NAICS (broad search)
curl -s -X POST "https://tools.govcongiants.org/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"","businessType":""}' | jq '{success, total: .stats.total}'

# LO-05: 8(a) filter
curl -s -X POST "https://tools.govcongiants.org/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"541511","businessType":"8a"}' | jq '{success, total: .stats.total}'
```

### 1.2 Historical Context API (`/api/sam/historical-context`)

| Test ID | Test Case | Input | Expected Result | Pass/Fail |
|---------|-----------|-------|-----------------|-----------|
| HC-01 | Valid NAICS lookup | `{"naics":"541511","title":"IT","agency":"VA"}` | Returns incumbents, price range, awards | |
| HC-02 | Different NAICS | `{"naics":"236220","title":"Construction","agency":"DOD"}` | Returns construction contract history | |
| HC-03 | Missing NAICS | `{"title":"IT","agency":"VA"}` | Returns 400 error (NAICS required) | |
| HC-04 | Only NAICS (no title) | `{"naics":"541511"}` | Returns results based on NAICS alone | |
| HC-05 | Rare NAICS | `{"naics":"112111","title":"Cattle","agency":"USDA"}` | Returns success, may have 0 awards | |

**Curl Commands:**

```bash
# HC-01: Valid lookup
curl -s -X POST "https://tools.govcongiants.org/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"naics":"541511","title":"IT Services","agency":"Department of Veterans Affairs"}' | \
  jq '{success, awards: .historicalContext.totalPastAwards, value: .historicalContext.totalHistoricalValue, incumbents: [.historicalContext.incumbents[:3][].name]}'

# HC-02: Construction NAICS
curl -s -X POST "https://tools.govcongiants.org/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"naics":"236220","title":"Commercial Construction","agency":"Department of Defense"}' | \
  jq '{success, awards: .historicalContext.totalPastAwards}'

# HC-03: Missing NAICS (should error)
curl -s -X POST "https://tools.govcongiants.org/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"title":"IT Services","agency":"VA"}' | jq '{success, error}'

# HC-04: NAICS only
curl -s -X POST "https://tools.govcongiants.org/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"naics":"541511"}' | \
  jq '{success, awards: .historicalContext.totalPastAwards}'

# HC-05: Rare NAICS
curl -s -X POST "https://tools.govcongiants.org/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"naics":"112111","title":"Cattle Ranching","agency":"USDA"}' | \
  jq '{success, awards: .historicalContext.totalPastAwards}'
```

---

## 2. Data Quality Tests

### 2.1 Live Opportunities Data Validation

| Test ID | Validation | Check Method | Expected |
|---------|------------|--------------|----------|
| DQ-01 | SAM.gov links work | Click `uiLink` in response | Opens valid SAM.gov page |
| DQ-02 | Deadline calculations | Compare `responseDeadline` to `daysUntilDeadline` | Math is correct |
| DQ-03 | Urgency classification | Verify urgency matches days | urgent ≤3, high ≤7, medium ≤14, low >14 |
| DQ-04 | No expired opportunities | Check all `daysUntilDeadline` | All ≥ 0 |
| DQ-05 | NAICS matches request | Check returned `naics` field | Matches requested code |

```bash
# DQ-01 to DQ-05: Get full opportunity and validate
curl -s -X POST "https://tools.govcongiants.org/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"541511","businessType":""}' | \
  jq '.opportunities[0] | {
    title,
    naics,
    deadline: .responseDeadline,
    daysLeft: .daysUntilDeadline,
    urgency,
    link: .uiLink
  }'
```

### 2.2 Historical Context Data Validation

| Test ID | Validation | Check Method | Expected |
|---------|------------|--------------|----------|
| DQ-06 | USASpending links work | Click `contractLink` in recentAwards | Opens valid USASpending page |
| DQ-07 | Price range logic | Compare min/max/average | min ≤ average ≤ max |
| DQ-08 | Incumbent calculations | Sum of individual totals | Should ≤ totalHistoricalValue |
| DQ-09 | Recent awards sorted | Check dates in recentAwards | Sorted newest first |
| DQ-10 | Year history accuracy | Check contractHistory years | Recent years have data |

```bash
# DQ-06 to DQ-10: Validate historical data
curl -s -X POST "https://tools.govcongiants.org/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"naics":"541511","title":"IT","agency":"VA"}' | \
  jq '{
    priceRange: .historicalContext.priceRange,
    priceRangeValid: (.historicalContext.priceRange.min <= .historicalContext.priceRange.average and .historicalContext.priceRange.average <= .historicalContext.priceRange.max),
    recentAwardDates: [.historicalContext.recentAwards[:3][].awardDate],
    yearHistory: [.historicalContext.contractHistory[:3][] | {year, count: .awardCount}],
    sampleLink: .historicalContext.recentAwards[0].contractLink
  }'
```

---

## 3. UI/UX Tests (Manual)

### 3.1 Hit List Display

| Test ID | Test Case | Steps | Expected Result | Pass/Fail |
|---------|-----------|-------|-----------------|-----------|
| UI-01 | Live badge visible | Load Market Assassin reports | "LIVE FROM SAM.GOV" badge appears | |
| UI-02 | Urgency badges color-coded | View opportunity cards | Red=urgent, Orange=high, Yellow=medium, Green=low | |
| UI-03 | Days countdown accurate | Compare to SAM.gov | Days match actual deadline | |
| UI-04 | Set-aside badges shown | View opportunities with set-asides | Badge shows "SDVOSB", "8(a)", etc. | |
| UI-05 | SAM.gov link works | Click "View on SAM.gov" | Opens correct opportunity | |

### 3.2 Historical Context Modal

| Test ID | Test Case | Steps | Expected Result | Pass/Fail |
|---------|-----------|-------|-----------------|-----------|
| UI-06 | Modal opens | Click "View History & Incumbents" | Modal appears with loading state | |
| UI-07 | Stats display | View modal header | Shows Past Awards, Total Value, Avg Contract, Price Range | |
| UI-08 | Incumbents list | View Top Incumbents section | Shows company names, award counts, values | |
| UI-09 | Current incumbent flag | Check incumbent badges | "CURRENT" badge on recent winners | |
| UI-10 | Recent awards display | View Recent Similar Awards | Shows recipient, amount, date, link | |
| UI-11 | Strategic insights | Scroll to bottom | Shows competitive intel bullets | |
| UI-12 | Modal close | Click X or outside | Modal closes cleanly | |
| UI-13 | Error handling | Test with invalid NAICS | Shows graceful error message | |

---

## 4. Performance Tests

| Test ID | Test Case | Threshold | Actual | Pass/Fail |
|---------|-----------|-----------|--------|-----------|
| PF-01 | Live Opportunities response time | < 5 seconds | | |
| PF-02 | Historical Context response time | < 10 seconds | | |
| PF-03 | Concurrent requests (5x) | All succeed | | |
| PF-04 | Large result set handling | 50+ opportunities | | |

```bash
# PF-01: Measure Live Opportunities response time
time curl -s -X POST "https://tools.govcongiants.org/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"541511","businessType":""}' > /dev/null

# PF-02: Measure Historical Context response time
time curl -s -X POST "https://tools.govcongiants.org/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"naics":"541511","title":"IT","agency":"VA"}' > /dev/null

# PF-03: Concurrent requests
for i in {1..5}; do
  curl -s -X POST "https://tools.govcongiants.org/api/sam/live-opportunities" \
    -H "Content-Type: application/json" \
    -d '{"naicsCode":"541511"}' | jq -r '.success' &
done
wait
```

---

## 5. Edge Cases

| Test ID | Test Case | Input | Expected Behavior |
|---------|-----------|-------|-------------------|
| EC-01 | No opportunities found | Very rare NAICS | Empty array, helpful message |
| EC-02 | No historical data | New NAICS code | Shows 0 awards, suggests alternatives |
| EC-03 | API timeout | Slow network | Graceful timeout message |
| EC-04 | SAM.gov API down | Service unavailable | Cached data or error message |
| EC-05 | USASpending API down | Service unavailable | Error state with retry option |
| EC-06 | Malformed request | Invalid JSON | 400 error with message |

```bash
# EC-01: Rare NAICS with no opps
curl -s -X POST "https://tools.govcongiants.org/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"111111"}' | jq '{success, total: .stats.total}'

# EC-06: Malformed request
curl -s -X POST "https://tools.govcongiants.org/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d 'not json' | jq '.'
```

---

## 6. Integration Tests

| Test ID | Test Case | Steps | Expected |
|---------|-----------|-------|----------|
| IT-01 | Full user flow | Enter NAICS → Generate Reports → View Hit List → Click History | All steps work seamlessly |
| IT-02 | Opportunity to history link | Click opportunity → View History | Historical data matches opportunity NAICS |
| IT-03 | Multiple NAICS support | Enter "541511, 541512" | Both codes searched |
| IT-04 | Premium vs Standard | Test with both tiers | History button visible for Premium |

---

## 7. Regression Checklist

After any code changes, verify:

- [ ] Live Opportunities API returns data
- [ ] Historical Context API returns data
- [ ] Hit List section renders in UI
- [ ] Urgency badges display correctly
- [ ] "View History" button works
- [ ] Modal displays all sections
- [ ] SAM.gov links are valid
- [ ] USASpending links are valid
- [ ] No console errors in browser
- [ ] No server errors in Vercel logs

---

## 8. Automated Test Script

Save as `test-live-opps.sh`:

```bash
#!/bin/bash
# Live Opportunities + Historical Context - Automated Tests
# Usage: ./test-live-opps.sh

BASE_URL="https://tools.govcongiants.org"
PASS=0
FAIL=0

echo "========================================="
echo "Live Opportunities Test Suite"
echo "========================================="

# Test 1: Live Opportunities basic
echo -n "LO-01 Basic NAICS search... "
RESULT=$(curl -s -X POST "$BASE_URL/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"541511","businessType":""}' | jq -r '.success')
if [ "$RESULT" == "true" ]; then
  echo "PASS"
  ((PASS++))
else
  echo "FAIL"
  ((FAIL++))
fi

# Test 2: Live Opportunities with set-aside
echo -n "LO-02 NAICS with set-aside... "
RESULT=$(curl -s -X POST "$BASE_URL/api/sam/live-opportunities" \
  -H "Content-Type: application/json" \
  -d '{"naicsCode":"541511","businessType":"SDVOSB"}' | jq -r '.success')
if [ "$RESULT" == "true" ]; then
  echo "PASS"
  ((PASS++))
else
  echo "FAIL"
  ((FAIL++))
fi

# Test 3: Historical Context basic
echo -n "HC-01 Valid NAICS lookup... "
RESULT=$(curl -s -X POST "$BASE_URL/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"naics":"541511","title":"IT","agency":"VA"}' | jq -r '.success')
if [ "$RESULT" == "true" ]; then
  echo "PASS"
  ((PASS++))
else
  echo "FAIL"
  ((FAIL++))
fi

# Test 4: Historical Context returns data
echo -n "HC-02 Returns award data... "
AWARDS=$(curl -s -X POST "$BASE_URL/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"naics":"541511","title":"IT","agency":"VA"}' | jq -r '.historicalContext.totalPastAwards')
if [ "$AWARDS" -gt 0 ]; then
  echo "PASS ($AWARDS awards)"
  ((PASS++))
else
  echo "FAIL (0 awards)"
  ((FAIL++))
fi

# Test 5: Historical Context missing NAICS
echo -n "HC-03 Missing NAICS returns error... "
RESULT=$(curl -s -X POST "$BASE_URL/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"title":"IT","agency":"VA"}' | jq -r '.success')
if [ "$RESULT" == "false" ]; then
  echo "PASS"
  ((PASS++))
else
  echo "FAIL"
  ((FAIL++))
fi

# Test 6: Price range validation
echo -n "DQ-07 Price range logic... "
PRICE_CHECK=$(curl -s -X POST "$BASE_URL/api/sam/historical-context" \
  -H "Content-Type: application/json" \
  -d '{"naics":"541511","title":"IT","agency":"VA"}' | \
  jq -r '.historicalContext.priceRange | .min <= .average and .average <= .max')
if [ "$PRICE_CHECK" == "true" ]; then
  echo "PASS"
  ((PASS++))
else
  echo "FAIL"
  ((FAIL++))
fi

echo "========================================="
echo "Results: $PASS passed, $FAIL failed"
echo "========================================="

exit $FAIL
```

---

## 9. Known Issues & Limitations

| Issue | Description | Workaround |
|-------|-------------|------------|
| Set-aside filters restrictive | "Small Business" filter may return 0 results | Use broader search first |
| Historical data limited to 100 | USASpending returns max 100 per request | Pagination not implemented |
| NAICS exact match only | Prefix search (541*) not supported | Enter full 6-digit code |
| SAM.gov rate limits | Too many requests may be throttled | Built-in 30s timeout |

---

## 10. Test Data Reference

### Common NAICS Codes for Testing

| NAICS | Description | Expected Results |
|-------|-------------|------------------|
| 541511 | Custom Computer Programming | High volume IT contracts |
| 541512 | Computer Systems Design | Similar to 541511 |
| 236220 | Commercial Construction | Construction contracts |
| 561210 | Facilities Support Services | Facility management |
| 541330 | Engineering Services | Engineering contracts |
| 112111 | Beef Cattle Ranching | Low/no results (good edge case) |

### Business Type Codes

| Input | SAM.gov Code | Description |
|-------|--------------|-------------|
| SDVOSB | SDVOSBC | Service-Disabled Veteran-Owned |
| VOSB | VSB | Veteran-Owned |
| 8a | 8A | 8(a) Program |
| WOSB | WOSB | Women-Owned |
| HUBZone | HZC | HUBZone |
| Small Business | SBP | Small Business Set-Aside |

---

*Protocol maintained by: GovCon Giants Engineering*
*Contact: service@govcongiants.com*
