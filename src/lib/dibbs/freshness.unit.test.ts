import { describe, it, expect } from 'vitest';
import { dibbsFreshnessNotice, formatDibbsUpdateDate } from './freshness';

describe('DIBBS panel freshness notice', () => {
  it('paused: Eric-approved wording with the date read from the data', () => {
    expect(dibbsFreshnessNotice({ paused: true, lastUpdatedAt: '2026-11-02T08:00:37.757+00:00' })).toBe(
      'DIBBS updates are paused. Last successful data update: November 2, 2026. Listings may be outdated. Verify current status and deadlines with DIBBS.',
    );
  });
  it('the date is UTC, so a late-UTC timestamp never shows the previous day', () => {
    expect(formatDibbsUpdateDate('2026-11-02T00:30:00Z')).toBe('November 2, 2026');
  });
  it('an unreadable timestamp says unknown, never a guessed date', () => {
    expect(dibbsFreshnessNotice({ paused: true, lastUpdatedAt: null })).toContain('Last successful data update: unknown.');
    expect(dibbsFreshnessNotice({ paused: true, lastUpdatedAt: 'garbage' })).toContain('unknown');
  });
  it('not paused: no notice', () => {
    expect(dibbsFreshnessNotice({ paused: false, lastUpdatedAt: '2026-11-02T08:00:37Z' })).toBeNull();
    expect(dibbsFreshnessNotice(null)).toBeNull();
  });
});
