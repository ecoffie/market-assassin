import { describe, expect, it } from 'vitest';
import { easternMidnightMs, resolveRange } from './date-range';

// Thu Nov 12 2026, 3:00 PM Eastern (EST, UTC-5) = 20:00 UTC.
const NOW = Date.UTC(2026, 10, 12, 20, 0, 0);

describe('resolveRange', () => {
  it('today starts at Eastern midnight and ends now', () => {
    const r = resolveRange({ range: 'today' }, NOW);
    expect([r.from, r.to]).toEqual(['2026-11-12', '2026-11-12']);
    expect(new Date(r.startMs).toISOString()).toBe('2026-11-12T05:00:00.000Z');
    expect(r.endMs).toBe(NOW);
  });

  it('this week runs Monday to today', () => {
    expect(resolveRange({ range: 'week' }, NOW)).toMatchObject({ from: '2026-11-09', to: '2026-11-12' });
  });

  it('this month and this year', () => {
    expect(resolveRange({ range: 'month' }, NOW)).toMatchObject({ from: '2026-11-01', to: '2026-11-12' });
    expect(resolveRange({ range: 'year' }, NOW)).toMatchObject({ from: '2026-01-01', to: '2026-11-12' });
  });

  it('yesterday is one whole Eastern day', () => {
    const r = resolveRange({ range: 'yesterday' }, NOW);
    expect([r.from, r.to]).toEqual(['2026-11-11', '2026-11-11']);
    expect(r.endMs - r.startMs).toBe(86400_000);
  });

  it('custom dates, with the end capped at today', () => {
    expect(resolveRange({ range: 'custom', from: '2026-09-01', to: '2026-12-31' }, NOW)).toMatchObject({ preset: 'custom', from: '2026-09-01', to: '2026-11-12' });
  });

  it('bad or missing input falls back to the last 30 days', () => {
    expect(resolveRange({}, NOW)).toMatchObject({ preset: '30d', from: '2026-10-14', to: '2026-11-12' });
    expect(resolveRange({ range: 'custom', from: 'x', to: '2026-01-01' }, NOW)).toMatchObject({ preset: '30d' });
    expect(resolveRange({ range: 'custom', from: '2026-11-10', to: '2026-11-01' }, NOW)).toMatchObject({ preset: '30d' });
  });

  it('handles daylight time (EDT, UTC-4)', () => {
    expect(new Date(easternMidnightMs('2026-07-04')).toISOString()).toBe('2026-07-04T04:00:00.000Z');
  });
});
