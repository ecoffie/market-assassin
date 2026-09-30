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

describe('real rows are preserved', () => {
  it('one real row ⇒ indexable and sitemap-eligible when the floor is one row (the /contracts contract)', () => {
    expect(decideSubpage('hit', 1, 1)).toEqual({ indexable: true, showTable: true, notice: null, headlineCount: 1 });
    expect(subpageSitemapEligible(1, 1)).toBe(true);
  });

  it('a small real dataset below the NAICS/agency thin floor is still RENDERED (not replaced), just not indexed', () => {
    const d = decideSubpage('hit', 2, MIN);
    expect(d.showTable).toBe(true);
    expect(d.headlineCount).toBe(2);
    expect(d.indexable).toBe(false);
    expect(subpageSitemapEligible(2, MIN)).toBe(false);
  });

  it('populated rows ⇒ the headline count IS the rendered row count', () => {
    for (const n of [5, 17, 242]) expect(decideSubpage('hit', n, MIN)).toMatchObject({ indexable: true, showTable: true, headlineCount: n });
    expect(subpageSitemapEligible(5, MIN)).toBe(true);
    expect(subpageSitemapEligible(4, MIN)).toBe(false);
  });

  it('the sitemap predicate and the page predicate agree for every row count', () => {
    for (const n of [0, 1, 4, 5, 6, 300]) expect(subpageSitemapEligible(n, MIN)).toBe(decideSubpage('hit', n, MIN).indexable);
  });
});
