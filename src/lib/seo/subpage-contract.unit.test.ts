/**
 * The contractor sub-page contract (subpage-contract.ts). Indexing, sitemap eligibility and every
 * claimed count come from RENDERABLE rows — never from the profile's stored aggregate.
 */
import { describe, it, expect } from 'vitest';
import { decideSubpage, subpageSitemapEligible } from './subpage-contract';

const MIN = 5; // SUBPAGE_MIN_ROWS for /naics and /agencies

describe('stored count > 0 but the page has nothing to render', () => {
  it('genuinely zero rows ⇒ noindex, no table, honest "none" copy, no claimed count', () => {
    // The stored aggregate (e.g. 227) is deliberately not an input: it cannot rescue an empty page.
    expect(decideSubpage('empty', 0, MIN)).toEqual({ indexable: false, showTable: false, notice: 'none', headlineCount: null });
  });

  it('unavailable rows (cold cache, live BQ off) ⇒ noindex, no table, honest "unavailable" copy', () => {
    expect(decideSubpage('unavailable', 0, MIN)).toEqual({ indexable: false, showTable: false, notice: 'unavailable', headlineCount: null });
  });

  it('failed query ⇒ treated as unavailable, never as zero', () => {
    expect(decideSubpage('failed', 0, MIN)).toEqual({ indexable: false, showTable: false, notice: 'unavailable', headlineCount: null });
  });

  it('neither empty nor unavailable pages are sitemap-eligible, whatever the stored count', () => {
    for (const n of [undefined, -1, -2, 0]) expect(subpageSitemapEligible(n, MIN)).toBe(false);
  });
});

describe('1–4 real rows (below the five-row floor)', () => {
  for (const n of [1, 2, 3, 4]) {
    it(`${n} row(s) ⇒ rendered with its real count, noindex, absent from the sitemap`, () => {
      expect(decideSubpage('hit', n, MIN)).toEqual({ indexable: false, showTable: true, notice: null, headlineCount: n });
      expect(subpageSitemapEligible(n, MIN)).toBe(false);
    });
  }
});

describe('5+ real rows', () => {
  for (const n of [5, 17, 242]) {
    it(`${n} rows ⇒ indexable, sitemap-eligible, headline count equals rendered rows`, () => {
      expect(decideSubpage('hit', n, MIN)).toEqual({ indexable: true, showTable: true, notice: null, headlineCount: n });
      expect(subpageSitemapEligible(n, MIN)).toBe(true);
    });
  }

  it('the sitemap predicate and the page predicate agree at every row count (0–300)', () => {
    for (const n of [0, 1, 4, 5, 6, 300]) expect(subpageSitemapEligible(n, MIN)).toBe(decideSubpage('hit', n, MIN).indexable);
  });
});
