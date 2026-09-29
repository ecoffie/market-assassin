import { describe, expect, it } from 'vitest';
import {
  calendar,
  canaryDown,
  googleIndexedDrop,
  indexedShareByStratum,
  matureEndDay,
  stratumFailures,
  stratumImpressionDrop,
  urlPersistent,
  type StratumDay,
} from './escalate';
import { STRATA, type Stratum } from './types';

const at = (d: number) => new Date(Date.UTC(2026, 8, d)).toISOString();

describe('urlPersistent', () => {
  it('does not escalate a single failure', () => {
    expect(urlPersistent([
      { url: 'u', outcome: 'http_5xx', checked_at: at(3) },
      { url: 'u', outcome: 'ok', checked_at: at(2) },
      { url: 'u', outcome: 'ok', checked_at: at(1) },
    ])).toEqual([]);
  });

  it('escalates the same failure class in 2 of the last 3 crawls', () => {
    const e = urlPersistent([
      { url: 'u', outcome: 'noindex', checked_at: at(3) },
      { url: 'u', outcome: 'ok', checked_at: at(2) },
      { url: 'u', outcome: 'noindex', checked_at: at(1) },
    ]);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ rule: 'url_persistent', evidence: { outcome: 'noindex', hits: 2 } });
  });

  it('keeps failure classes distinct, and only looks at the last 3 crawls', () => {
    expect(urlPersistent([{ url: 'u', outcome: 'http_5xx', checked_at: at(3) }, { url: 'u', outcome: 'noindex', checked_at: at(2) }])).toEqual([]);
    expect(urlPersistent([
      { url: 'u', outcome: 'ok', checked_at: at(5) }, { url: 'u', outcome: 'ok', checked_at: at(4) },
      { url: 'u', outcome: 'http_404', checked_at: at(3) }, { url: 'u', outcome: 'http_404', checked_at: at(2) },
    ])).toEqual([]);
  });

  it("never escalates Google's decisions per URL", () => {
    expect(urlPersistent([{ url: 'u', outcome: 'crawled_not_indexed', checked_at: at(3) }, { url: 'u', outcome: 'crawled_not_indexed', checked_at: at(2) }])).toEqual([]);
  });
});

describe('canaryDown', () => {
  it('needs two consecutive failing runs', () => {
    expect(canaryDown([{ '/': 'http_5xx' }])).toEqual([]);
    expect(canaryDown([{ '/': 'http_5xx' }, { '/': 'ok' }])).toEqual([]);
    const e = canaryDown([{ '/': 'transport_failure' }, { '/': 'http_5xx' }]);
    expect(e).toHaveLength(1);
    expect(e[0].severity).toBe('critical');
  });
});

describe('stratumFailures', () => {
  it('requires the rate over 5% in this run AND the previous one, with a minimum sample', () => {
    const bad = { contractor_root: { total: 100, failures: 10 } };
    const fine = { contractor_root: { total: 100, failures: 2 } };
    expect(stratumFailures(bad, null)).toEqual([]);
    expect(stratumFailures(bad, fine)).toEqual([]);
    expect(stratumFailures(bad, bad)).toHaveLength(1);
    expect(stratumFailures({ hub: { total: 5, failures: 5 } }, { hub: { total: 5, failures: 5 } })).toEqual([]);
  });
});

describe('mature window', () => {
  it('ends at least 3 days behind today (UTC) and is a contiguous calendar', () => {
    expect(matureEndDay(Date.UTC(2026, 8, 29, 12))).toBe('2026-09-26');
    const days = calendar('2026-09-26', 31);
    expect(days[0]).toBe('2026-08-27');
    expect(days[30]).toBe('2026-09-26');
    expect(new Set(days).size).toBe(31);
  });
});

describe('stratumImpressionDrop (calendar-complete)', () => {
  const END = '2026-09-26';
  const days = calendar(END, 31);
  // Search Console omits zero rows: `values` has one entry per calendar day; 0 => no row at all.
  const series = (stratum: Stratum, values: number[]): StratumDay[] =>
    days.flatMap((day, i) => (values[i] > 0 ? [{ day, stratum, impressions: values[i] }] : []));
  const base = (v: number) => Array.from({ length: 28 }, () => v);

  it('escalates 3 consecutive mature days more than 40% under the preceding 28 days', () => {
    const r = stratumImpressionDrop(series('contractor_root', [...base(100), 50, 40, 30]), { complete: true, endDay: END, strata: STRATA });
    expect(r.evaluated).toBe(true);
    expect(r.escalations).toHaveLength(1);
    expect(r.escalations[0]).toMatchObject({ rule: 'gsc_stratum_drop', key: 'contractor_root', evidence: { baseline: 100 } });
  });

  it('catches a stratum that disappears entirely (no rows at all on the recent days)', () => {
    const r = stratumImpressionDrop(series('contractor_root', [...base(100), 0, 0, 0]), { complete: true, endDay: END, strata: STRATA });
    expect(r.escalations.map((e) => e.key)).toEqual(['contractor_root']);
    expect(r.escalations[0].evidence.recent).toEqual([
      { day: '2026-09-24', impressions: 0 }, { day: '2026-09-25', impressions: 0 }, { day: '2026-09-26', impressions: 0 },
    ]);
  });

  it('uses consecutive CALENDAR days, not the last three dates that happen to have rows', () => {
    // Recent: day1 = 0 (no row), day2 = 90, day3 = 0 (no row). Only the calendar view sees the gap.
    const r = stratumImpressionDrop(series('contractor_root', [...base(100), 0, 90, 0]), { complete: true, endDay: END, strata: STRATA });
    expect(r.escalations).toEqual([]); // day 2 recovered above the floor, so not 3 consecutive low days
  });

  it('does not escalate when one of the 3 days recovers, or for a small (not established) stratum', () => {
    expect(stratumImpressionDrop(series('contractor_root', [...base(100), 50, 80, 30]), { complete: true, endDay: END, strata: STRATA }).escalations).toEqual([]);
    expect(stratumImpressionDrop(series('hub', [...base(10), 0, 0, 0]), { complete: true, endDay: END, strata: STRATA }).escalations).toEqual([]);
  });

  it('returns NO verdict from an incomplete response, even when the data would look like a collapse', () => {
    const r = stratumImpressionDrop(series('contractor_root', [...base(100), 0, 0, 0]), { complete: false, endDay: END, strata: STRATA });
    expect(r).toEqual({ evaluated: false, escalations: [], baselines: {} });
  });
});

describe('indexed share, per stratum only', () => {
  const now = Date.UTC(2026, 8, 29);
  const rows = (stratum: Stratum, n: number, indexed: number, daysAgo: number) =>
    Array.from({ length: n }, (_, i) => ({ stratum, outcome: (i < indexed ? 'indexed' : 'crawled_not_indexed') as 'indexed' | 'crawled_not_indexed', checked_at: new Date(now - daysAgo * 86_400_000).toISOString() }));

  it('escalates a >10-point drop within one stratum', () => {
    const shares = indexedShareByStratum([...rows('contractor_root', 100, 60, 10), ...rows('contractor_root', 100, 40, 2)], STRATA, now);
    const e = googleIndexedDrop(shares);
    expect(e).toHaveLength(1);
    expect(e[0].key).toBe('contractor_root');
  });

  it('does NOT escalate when only the mix of strata changes (Simpson trap)', () => {
    // Each stratum is stable week over week: hubs ~90% indexed, contractor subpages ~20%.
    // Last week's sample was mostly hubs, this week's mostly subpages. A global share would
    // "fall" from ~83% to ~27%; per stratum nothing moved.
    const prev = [...rows('hub', 90, 81, 10), ...rows('contractor_contracts', 10, 2, 10)];
    const cur = [...rows('hub', 10, 9, 2), ...rows('contractor_contracts', 90, 18, 2)];
    const shares = indexedShareByStratum([...prev, ...cur], STRATA, now);
    expect(googleIndexedDrop(shares)).toEqual([]);
    const hub = shares.find((s) => s.stratum === 'hub')!;
    expect(hub.current.share).toBeCloseTo(0.9);
    expect(hub.previous.share).toBeCloseTo(0.9);
  });

  it('needs >= 50 inspections in each window, and ignores inspection errors', () => {
    expect(googleIndexedDrop(indexedShareByStratum([...rows('hub', 20, 20, 10), ...rows('hub', 20, 0, 2)], STRATA, now))).toEqual([]);
    const errs = Array.from({ length: 200 }, () => ({ stratum: 'hub' as Stratum, outcome: 'inspection_error' as const, checked_at: new Date(now - 2 * 86_400_000).toISOString() }));
    const shares = indexedShareByStratum([...rows('hub', 100, 60, 10), ...rows('hub', 100, 60, 2), ...errs], STRATA, now);
    expect(shares.find((s) => s.stratum === 'hub')!.current.n).toBe(100);
    expect(googleIndexedDrop(shares)).toEqual([]);
  });
});
