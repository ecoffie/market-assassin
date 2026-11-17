import { describe, it, expect } from 'vitest';
import { TABLE_MEASURED_SOURCES, classifyTableFreshness, isTableMeasured } from './table-measured';

const spec = TABLE_MEASURED_SOURCES.dodaac_directory;
const NOW = '2026-11-17T13:05:00Z';

describe('DoDAAC directory freshness is measured from its rows, not the stamp', () => {
  it('is registered as table-measured', () => {
    expect(isTableMeasured('dodaac_directory')).toBe(true);
    expect(isTableMeasured('tier2_sblo')).toBe(false);
    expect(isTableMeasured(undefined)).toBe(false);
  });

  it('production 2026-11-17: refreshed 11-06, 4,901 of 4,902 rows → healthy (the 169-day alert was false)', () => {
    const f = classifyTableFreshness({ spec, newest: '2026-11-06T09:00:31Z', total: 4902, refreshedInWindow: 4901, now: NOW });
    expect(f.status).toBe('healthy');
    expect(f.ageDays).toBe(11);
    expect(f.coverage).toBeCloseTo(0.9998, 3);
  });

  it('producer has not run inside its window → stale', () => {
    const f = classifyTableFreshness({ spec, newest: '2026-09-06T09:00:00Z', total: 4902, refreshedInWindow: 0, now: NOW });
    expect(f.status).toBe('stale');
    expect(f.detail).toMatch(/producer has not run/);
  });

  it('only the SAM gap-fill pass ran (a few new rows, FPDS pass failed) → partial, never healthy', () => {
    // fillDodaacGapsFromSam inserts new offices with updated_at = now, which alone makes
    // MAX(updated_at) look fresh. Coverage is what catches it.
    const f = classifyTableFreshness({ spec, newest: '2026-11-16T09:00:00Z', total: 4910, refreshedInWindow: 8, now: NOW });
    expect(f.status).toBe('partial');
  });

  it('unknown stays unknown: missing timestamp, null counts, empty table', () => {
    expect(classifyTableFreshness({ spec, newest: null, total: 4902, refreshedInWindow: 4901, now: NOW }).status).toBe('unknown');
    expect(classifyTableFreshness({ spec, newest: '2026-11-06T09:00:00Z', total: null, refreshedInWindow: 4901, now: NOW }).status).toBe('unknown');
    expect(classifyTableFreshness({ spec, newest: '2026-11-06T09:00:00Z', total: 4902, refreshedInWindow: null, now: NOW }).status).toBe('unknown');
    expect(classifyTableFreshness({ spec, newest: '2026-11-06T09:00:00Z', total: 0, refreshedInWindow: 0, now: NOW }).status).toBe('unknown');
  });
});
