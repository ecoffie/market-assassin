# Market Assassin Test Protocols

Every new feature must have a corresponding test protocol before it's considered complete.

## Test Protocol Requirements

Each new build/feature requires:
1. **Test Protocol Document** (`tests/{feature-name}-test-protocol.md`)
2. **Automated Test Script** (`tests/test-{feature-name}.sh`)
3. **All tests passing** before merge to main

## Current Test Protocols

| Feature | Protocol | Script | Status | Last Run |
|---------|----------|--------|--------|----------|
| Live Opportunities + Historical | [live-opportunities-test-protocol.md](./live-opportunities-test-protocol.md) | [test-live-opps.sh](./test-live-opps.sh) | ✅ 16/16 | Mar 18, 2026 |
| Daily Health Check | [health-check-test-protocol.md](./health-check-test-protocol.md) | [test-health-check.sh](./test-health-check.sh) | ✅ 12/12 | Mar 18, 2026 |
| Content Reaper | [content-reaper-test-protocol.md](./content-reaper-test-protocol.md) | [test-content-reaper.sh](./test-content-reaper.sh) | ✅ 10/10 | Mar 18, 2026 |
| Smart Profiles | [smart-profiles-test-protocol.md](./smart-profiles-test-protocol.md) | [test-smart-profiles.sh](./test-smart-profiles.sh) | ✅ 8/8 | Mar 18, 2026 |
| Briefings System | [briefings-test-protocol.md](./briefings-test-protocol.md) | [test-briefings.sh](./test-briefings.sh) | ✅ 14/14 | Mar 18, 2026 |

## Run All Tests

```bash
# Run all test suites
bash tests/run-all-tests.sh

# Run specific test
bash tests/test-live-opps.sh
bash tests/test-health-check.sh
```

## Creating a New Test Protocol

Use the template generator:

```bash
bash tests/create-test-protocol.sh "Feature Name" "feature-name"
```

Or manually create using the template at `tests/TEMPLATE-test-protocol.md`

## Test Categories

Each protocol should cover:

1. **API Tests** - Endpoint functionality, error handling
2. **Data Quality Tests** - Validation, business logic
3. **UI/UX Tests** - Manual checklist for visual verification
4. **Performance Tests** - Response times, concurrent requests
5. **Edge Cases** - Error states, empty data, timeouts
6. **Integration Tests** - End-to-end user flows
7. **Regression Checklist** - Post-deploy verification

## CI/CD Integration

Test scripts return exit codes:
- `0` = All tests passed
- `N` = N tests failed

Add to your deploy workflow:
```bash
bash tests/run-all-tests.sh || exit 1
```

---

*Last Updated: March 18, 2026*
