# Market Assassin Test Protocols

Every new feature must have a corresponding test protocol before it's considered complete.

## Test Protocol Requirements

Each new build/feature requires:
1. **Test Protocol Document** (`tests/{feature-name}-test-protocol.md`)
2. **Automated Test Script** (`tests/test-{feature-name}.sh`)
3. **All tests passing** before merge to main

## Current Test Suites

| Feature | Protocol | Script | Tests | Status |
|---------|----------|--------|-------|--------|
| Live Opportunities + Historical | [live-opportunities-test-protocol.md](./live-opportunities-test-protocol.md) | [test-live-opps.sh](./test-live-opps.sh) | 16 | ✅ Passing |
| Daily Health Check | — | [test-health-check.sh](./test-health-check.sh) | 11 | ✅ Passing |
| Content Reaper | — | [test-content-reaper.sh](./test-content-reaper.sh) | 9 | ✅ Passing |

**Total: 36 tests across 3 suites**

## Run All Tests

```bash
# Run all test suites
bash tests/run-all-tests.sh

# Run individual suites
bash tests/test-live-opps.sh
bash tests/test-health-check.sh
bash tests/test-content-reaper.sh
```

## Creating a New Test Protocol

Use the template generator:

```bash
bash tests/create-test-protocol.sh "Feature Name" "feature-name"
```

This creates:
- `tests/{feature-name}-test-protocol.md` — Detailed test documentation
- `tests/test-{feature-name}.sh` — Automated test script

Or manually create using the template at `tests/TEMPLATE-test-protocol.md`

## Test Categories

Each protocol should cover:

1. **API Tests** — Endpoint functionality, error handling
2. **Data Quality Tests** — Validation, business logic
3. **UI/UX Tests** — Manual checklist for visual verification
4. **Performance Tests** — Response times, concurrent requests
5. **Edge Cases** — Error states, empty data, timeouts
6. **Security Tests** — Auth, rate limiting, input sanitization
7. **Integration Tests** — End-to-end user flows
8. **Regression Checklist** — Post-deploy verification

## Test Output Format

Each test script outputs:
```
=========================================
TEST RESULTS
=========================================
Passed:  X
Failed:  Y
Skipped: Z
=========================================
```

Exit codes:
- `0` = All tests passed
- `N` = N tests failed

## CI/CD Integration

Add to your deploy workflow:
```bash
bash tests/run-all-tests.sh || exit 1
```

## Automated Test Coverage

| Category | Live Opps | Health Check | Content Reaper |
|----------|-----------|--------------|----------------|
| API Tests | 10 | 7 | 4 |
| Data Quality | 4 | — | 2 |
| Performance | 2 | — | 1 |
| Page Health | — | 4 | 2 |

---

*Last Updated: March 18, 2026*
