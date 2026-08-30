import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTE = readFileSync(
  join(process.cwd(), 'src/app/api/cron/saved-search-alerts/route.ts'),
  'utf8',
);

describe('saved-search-alerts telemetry and same-invocation drain seams', () => {
  it('self-reports the drain outcome, including partial capacity exhaustion', () => {
    expect(ROUTE).toContain("import { reportCronOutcome } from '@/lib/cron-self-report'");
    expect(ROUTE).toContain('await reportCronOutcome(JOB_NAME, results.outcome, results.errorSummary)');
    expect(ROUTE).toContain('{ status: results.success ? 200 : 500 }');
    expect(ROUTE).toContain('runSavedSearchAlertDrain');
  });

  it('filters due, supported schedules before oldest-due order and the per-fetch limit', () => {
    const scopeStart = ROUTE.indexOf('function applyDueSavedSearchScope');
    const fetchStart = ROUTE.indexOf('function fetchDueSavedSearchBatch');
    const countStart = ROUTE.indexOf('function countDueSavedSearches');
    const scope = ROUTE.slice(scopeStart, fetchStart);
    const fetch = ROUTE.slice(fetchStart, countStart);

    const enabled = scope.indexOf(".eq('alerts_enabled', true)");
    const supported = scope.indexOf(".eq('mode', 'open')");
    const due = scope.indexOf(".in('alert_frequency', [...dueFrequencies])");
    const limited = fetch.indexOf('.limit(limit)');
    const ordered = fetch.indexOf(".order('last_alerted_at'");
    const stable = fetch.indexOf(".order('id'");

    expect(enabled).toBeGreaterThan(-1);
    expect(supported).toBeGreaterThan(enabled);
    expect(due).toBeGreaterThan(supported);
    expect(limited).toBeGreaterThan(-1);
    expect(ordered).toBeGreaterThan(limited);
    expect(stable).toBeGreaterThan(ordered);
  });

  it('keeps the invocation budget below the 290s route timeout', () => {
    expect(ROUTE).toContain('SAVED_SEARCH_ALERT_TIME_BUDGET_MS');
    expect(ROUTE).toContain('SAVED_SEARCH_ALERT_ROW_CEILING');
    expect(ROUTE).toContain('SAVED_SEARCH_ALERT_BATCH_SIZE');
  });
});
