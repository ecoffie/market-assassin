# [FEATURE NAME] - Test Protocol

**Feature**: [Brief description]
**Version**: 1.0
**Last Updated**: [DATE]
**Author**: GovCon Giants Engineering

---

## Quick Health Check

```bash
# Quick smoke test - replace with actual endpoint
curl -s "https://tools.govcongiants.org/api/[endpoint]" | jq '.success'
```

**Expected**: Returns `true`

---

## 1. API Tests

### 1.1 [Primary Endpoint] (`/api/[endpoint]`)

| Test ID | Test Case | Input | Expected Result | Pass/Fail |
|---------|-----------|-------|-----------------|-----------|
| API-01 | Basic request | `{}` | Returns success=true | |
| API-02 | With valid params | `{"param": "value"}` | Returns expected data | |
| API-03 | Missing required param | `{}` | Returns 400 error | |
| API-04 | Invalid param value | `{"param": "invalid"}` | Returns error message | |
| API-05 | Large payload | [large data] | Handles gracefully | |

**Curl Commands:**

```bash
# API-01: Basic request
curl -s -X POST "https://tools.govcongiants.org/api/[endpoint]" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '{success, error}'

# API-02: With valid params
curl -s -X POST "https://tools.govcongiants.org/api/[endpoint]" \
  -H "Content-Type: application/json" \
  -d '{"param": "value"}' | jq '.'

# API-03: Missing required param
curl -s -X POST "https://tools.govcongiants.org/api/[endpoint]" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '{success, error}'
```

### 1.2 [Secondary Endpoint] (if applicable)

| Test ID | Test Case | Input | Expected Result | Pass/Fail |
|---------|-----------|-------|-----------------|-----------|
| API-06 | ... | ... | ... | |

---

## 2. Data Quality Tests

| Test ID | Validation | Check Method | Expected |
|---------|------------|--------------|----------|
| DQ-01 | Data format correct | Check response structure | Matches schema |
| DQ-02 | Required fields present | Verify all fields exist | No null/undefined |
| DQ-03 | Values in valid range | Check bounds | Within expected range |
| DQ-04 | Relationships valid | Cross-reference data | Consistent |
| DQ-05 | No duplicate records | Check uniqueness | All unique |

```bash
# DQ-01: Validate response structure
curl -s "https://tools.govcongiants.org/api/[endpoint]" | \
  jq 'has("success") and has("data")'

# DQ-02: Check required fields
curl -s "https://tools.govcongiants.org/api/[endpoint]" | \
  jq '.data | map(select(.requiredField == null)) | length == 0'
```

---

## 3. UI/UX Tests (Manual)

| Test ID | Test Case | Steps | Expected Result | Pass/Fail |
|---------|-----------|-------|-----------------|-----------|
| UI-01 | Page loads | Navigate to /[page] | Page renders without errors | |
| UI-02 | Form submission | Fill form, click submit | Shows success message | |
| UI-03 | Error display | Trigger error state | Shows user-friendly message | |
| UI-04 | Loading states | Trigger async action | Shows loading indicator | |
| UI-05 | Mobile responsive | Resize to 375px width | Layout adjusts properly | |
| UI-06 | Accessibility | Tab through controls | Focus visible, logical order | |

---

## 4. Performance Tests

| Test ID | Test Case | Threshold | Actual | Pass/Fail |
|---------|-----------|-----------|--------|-----------|
| PF-01 | Response time | < 3 seconds | | |
| PF-02 | Time to interactive | < 5 seconds | | |
| PF-03 | Concurrent requests (5x) | All succeed | | |
| PF-04 | Large dataset handling | No timeout | | |

```bash
# PF-01: Measure response time
time curl -s "https://tools.govcongiants.org/api/[endpoint]" > /dev/null

# PF-03: Concurrent requests
for i in {1..5}; do
  curl -s "https://tools.govcongiants.org/api/[endpoint]" | jq -r '.success' &
done
wait
```

---

## 5. Edge Cases

| Test ID | Test Case | Input | Expected Behavior |
|---------|-----------|-------|-------------------|
| EC-01 | Empty input | `{}` or `""` | Graceful error message |
| EC-02 | Null values | `{"field": null}` | Handles without crash |
| EC-03 | Very long strings | 10000+ chars | Truncates or rejects |
| EC-04 | Special characters | `<script>`, `'`, `"` | Sanitized/escaped |
| EC-05 | Network timeout | Slow connection | Shows timeout message |
| EC-06 | Service unavailable | API down | Shows fallback/error |

---

## 6. Security Tests

| Test ID | Test Case | Method | Expected |
|---------|-----------|--------|----------|
| SEC-01 | Auth required | Call without token | 401 Unauthorized |
| SEC-02 | Rate limiting | 100 rapid requests | Throttled after limit |
| SEC-03 | SQL injection | `'; DROP TABLE--` | Sanitized, no effect |
| SEC-04 | XSS prevention | `<script>alert(1)</script>` | Escaped in output |
| SEC-05 | CORS policy | Cross-origin request | Blocked if not allowed |

---

## 7. Integration Tests

| Test ID | Test Case | Steps | Expected |
|---------|-----------|-------|----------|
| IT-01 | Full user flow | [Step 1] → [Step 2] → [Step 3] | Completes successfully |
| IT-02 | Data persistence | Create → Read → Verify | Data matches |
| IT-03 | External API integration | Trigger external call | Returns valid data |
| IT-04 | Email delivery | Trigger email action | Email received |

---

## 8. Regression Checklist

After any code changes, verify:

- [ ] Primary API endpoint returns data
- [ ] All error states handled gracefully
- [ ] UI renders without console errors
- [ ] Loading states work correctly
- [ ] Mobile layout not broken
- [ ] No new TypeScript errors
- [ ] No security vulnerabilities introduced
- [ ] Performance not degraded

---

## 9. Automated Test Script

See: `tests/test-[feature-name].sh`

```bash
# Run automated tests
bash tests/test-[feature-name].sh

# Expected output:
# =========================================
# TEST RESULTS
# =========================================
# Passed:  X
# Failed:  0
# =========================================
# ALL TESTS PASSED
```

---

## 10. Known Issues & Limitations

| Issue | Description | Workaround |
|-------|-------------|------------|
| [Issue 1] | [Description] | [Workaround] |

---

## 11. Test Data Reference

### Sample Valid Inputs
```json
{
  "field1": "valid_value",
  "field2": 123
}
```

### Sample Error Inputs
```json
{
  "field1": "",  // Empty - should error
  "field2": -1   // Out of range - should error
}
```

---

*Protocol maintained by: GovCon Giants Engineering*
*Contact: service@govcongiants.com*
