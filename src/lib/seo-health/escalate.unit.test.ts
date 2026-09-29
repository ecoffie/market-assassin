import { describe, expect, it } from 'vitest';
import { canaryDown, googleIndexedDrop, gscSectionDrop, sectionFailures, urlPersistent } from './escalate';

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

  it('keeps failure classes distinct: one 5xx plus one noindex is not persistent', () => {
    expect(urlPersistent([
      { url: 'u', outcome: 'http_5xx', checked_at: at(3) },
      { url: 'u', outcome: 'noindex', checked_at: at(2) },
    ])).toEqual([]);
  });

  it('only looks at the last 3 crawls', () => {
    expect(urlPersistent([
      { url: 'u', outcome: 'ok', checked_at: at(5) },
      { url: 'u', outcome: 'ok', checked_at: at(4) },
      { url: 'u', outcome: 'http_404', checked_at: at(3) },
      { url: 'u', outcome: 'http_404', checked_at: at(2) },
    ])).toEqual([]);
  });

  it("never escalates Google's decisions per URL", () => {
    expect(urlPersistent([
      { url: 'u', outcome: 'crawled_not_indexed', checked_at: at(3) },
      { url: 'u', outcome: 'crawled_not_indexed', checked_at: at(2) },
    ])).toEqual([]);
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

describe('sectionFailures', () => {
  it('requires the rate over 5% in this run AND the previous one, with a minimum sample', () => {
    const bad = { contractors: { total: 100, failures: 10 } };
    const fine = { contractors: { total: 100, failures: 2 } };
    expect(sectionFailures(bad, null)).toEqual([]);
    expect(sectionFailures(bad, fine)).toEqual([]);
    expect(sectionFailures(bad, bad)).toHaveLength(1);
    expect(sectionFailures({ tiny: { total: 5, failures: 5 } }, { tiny: { total: 5, failures: 5 } })).toEqual([]);
  });
});

describe('gscSectionDrop', () => {
  const series = (base: number, last3: number[]) => [
    ...Array.from({ length: 28 }, (_, i) => ({ day: `2026-08-${String(i + 1).padStart(2, '0')}`, section: 'contractors', impressions: base })),
    ...last3.map((v, i) => ({ day: `2026-09-0${i + 1}`, section: 'contractors', impressions: v })),
  ];

  it('escalates 3 consecutive days more than 40% under the 28-day baseline', () => {
    const e = gscSectionDrop(series(100, [50, 40, 30]));
    expect(e).toHaveLength(1);
    expect(e[0].evidence.baseline).toBe(100);
  });

  it('does not escalate when one of the 3 days recovers', () => {
    expect(gscSectionDrop(series(100, [50, 80, 30]))).toEqual([]);
  });

  it('ignores sections with a tiny baseline (noise)', () => {
    expect(gscSectionDrop(series(10, [0, 0, 0]))).toEqual([]);
  });
});

describe('googleIndexedDrop', () => {
  const now = Date.UTC(2026, 8, 29);
  const rows = (n: number, indexed: number, daysAgo: number) =>
    Array.from({ length: n }, (_, i) => ({ outcome: (i < indexed ? 'indexed' : 'crawled_not_indexed') as 'indexed' | 'crawled_not_indexed', checked_at: new Date(now - daysAgo * 86_400_000).toISOString() }));

  it('escalates a drop of more than 10 points week over week', () => {
    const e = googleIndexedDrop([...rows(100, 60, 10), ...rows(100, 40, 2)], now);
    expect(e).toHaveLength(1);
  });

  it('does not escalate small moves or thin samples', () => {
    expect(googleIndexedDrop([...rows(100, 60, 10), ...rows(100, 55, 2)], now)).toEqual([]);
    expect(googleIndexedDrop([...rows(20, 20, 10), ...rows(20, 0, 2)], now)).toEqual([]);
  });

  it('excludes inspection errors from the share', () => {
    const errs = Array.from({ length: 200 }, () => ({ outcome: 'inspection_error' as const, checked_at: new Date(now - 2 * 86_400_000).toISOString() }));
    expect(googleIndexedDrop([...rows(100, 60, 10), ...rows(100, 60, 2), ...errs], now)).toEqual([]);
  });
});
