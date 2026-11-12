import { describe, expect, it } from 'vitest';
import { parseDailyRows, summarize } from './report';

describe('GA4 daily visitors', () => {
  it('parses YYYYMMDD rows, sorts oldest first, and drops malformed rows', () => {
    const rows = parseDailyRows({
      rows: [
        { dimensionValues: [{ value: '20261111' }], metricValues: [{ value: '200' }, { value: '150' }, { value: '260' }, { value: '900' }] },
        { dimensionValues: [{ value: '20261110' }], metricValues: [{ value: '100' }, { value: '80' }, { value: '120' }, { value: '400' }] },
        { dimensionValues: [{ value: '(other)' }], metricValues: [{ value: '5' }] },
      ],
    });
    expect(rows.map((r) => r.date)).toEqual(['2026-11-10', '2026-11-11']);
    expect(rows[1]).toEqual({ date: '2026-11-11', visitors: 200, newVisitors: 150, sessions: 260, pageViews: 900 });
  });

  it('averages full days only (today is partial) and never invents a zero', () => {
    const d = (date: string, visitors: number) => ({ date, visitors, newVisitors: 0, sessions: 0, pageViews: 0 });
    expect(summarize([d('2026-11-10', 100), d('2026-11-11', 200), d('2026-11-12', 7)])).toMatchObject({ averageDailyVisitors: 150, fullDaysCounted: 2 });
    expect(summarize([]).averageDailyVisitors).toBeNull();
  });
});
