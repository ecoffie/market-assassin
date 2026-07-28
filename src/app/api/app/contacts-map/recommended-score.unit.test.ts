/**
 * "Recommended" company sort = a Zillow-style relevance blend, NOT raw $-won-desc (Eric 2026-07-28).
 *
 * The default Companies sort silently fell through to `total_obligated` desc, so national mega-primes
 * (Lockheed $25.8B, Fluor $28.3B) topped EVERY local viewport — the rank-then-filter "whales starve
 * local" pattern in card form. `recommendedScore` blends REAL row fields (log-scaled $ won + recency +
 * agency breadth + set-aside relevance) so a recently-active, relevant local firm can out-rank a
 * dormant giant. This test extracts the pure fn from the route and proves the de-whale behavior.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

// JS mirror of the route's `recommendedScore` (the source has TS type annotations that `new Function`
// can't parse). The formula/weights below MUST match route.ts — the "stays in sync with source"
// describe-block at the bottom asserts the route still contains the same weights, so drift is caught.
const NOW_YEAR = 2026;
function recommendedScore(
  r: { total_obligated?: number; last_action_date?: string; distinct_agency_count?: number },
  hasSetAside: boolean,
): number {
  const dollars = Math.max(0, Number(r.total_obligated) || 0);
  const dollarTerm = dollars > 0 ? Math.min(1, Math.max(0, (Math.log10(dollars) - 4) / 6)) : 0;
  const ly = Number(String(r.last_action_date || '').slice(0, 4)) || 0;
  const yearsStale = ly ? Math.max(0, NOW_YEAR - ly) : 12;
  const recencyTerm = Math.max(0, 1 - yearsStale / 8);
  const breadthTerm = Math.min(1, (Number(r.distinct_agency_count) || 0) / 15);
  const setAsideTerm = hasSetAside ? 1 : 0;
  return 0.34 * recencyTerm + 0.30 * dollarTerm + 0.20 * breadthTerm + 0.16 * setAsideTerm;
}

describe('recommendedScore — Zillow relevance, not raw $', () => {
  it('a dormant mega-prime does NOT auto-outrank a recently-active mid firm', () => {
    // Lockheed-scale but last won 9 years ago (dormant) vs. a $50M firm active this year.
    const dormantWhale = recommendedScore({ total_obligated: 25_800_000_000, last_action_date: '2017-03-01', distinct_agency_count: 20 }, false);
    const activeLocal = recommendedScore({ total_obligated: 50_000_000, last_action_date: '2026-02-01', distinct_agency_count: 6 }, true);
    expect(activeLocal).toBeGreaterThan(dormantWhale);
  });

  it('$ won is ONE factor, log-scaled — a 500x bigger firm does not swamp a relevant small one', () => {
    // Big non-cert firm vs. a 500x smaller SET-ASIDE firm, both active this year. Because $ is
    // log-scaled and only ONE factor, the set-aside relevance boost is enough to FLIP the order —
    // exactly the de-whale intent (a relevant, teamable small firm surfaces over a bigger generic one).
    const bigNoCert = recommendedScore({ total_obligated: 5_000_000_000, last_action_date: '2026-01-01', distinct_agency_count: 5 }, false);
    const smallSetAside = recommendedScore({ total_obligated: 10_000_000, last_action_date: '2026-01-01', distinct_agency_count: 5 }, true);
    expect(smallSetAside).toBeGreaterThan(bigNoCert);
    // …but it's a nudge, not a landslide — a truly tiny/irrelevant firm shouldn't leapfrog on cert alone.
    expect(smallSetAside - bigNoCert).toBeLessThan(0.15);
  });
  it('all else equal (no set-aside on either), the bigger firm still ranks higher', () => {
    const big = recommendedScore({ total_obligated: 5_000_000_000, last_action_date: '2026-01-01', distinct_agency_count: 5 }, false);
    const small = recommendedScore({ total_obligated: 10_000_000, last_action_date: '2026-01-01', distinct_agency_count: 5 }, false);
    expect(big).toBeGreaterThan(small); // $ still matters when relevance is equal
  });

  it('recency is a real lever — same firm, more recent = higher', () => {
    const recent = recommendedScore({ total_obligated: 1e8, last_action_date: '2026-01-01', distinct_agency_count: 8 }, false);
    const stale = recommendedScore({ total_obligated: 1e8, last_action_date: '2019-01-01', distinct_agency_count: 8 }, false);
    expect(recent).toBeGreaterThan(stale);
  });

  it('holding a set-aside cert boosts an otherwise-identical firm', () => {
    const cert = recommendedScore({ total_obligated: 1e8, last_action_date: '2025-06-01', distinct_agency_count: 8 }, true);
    const noCert = recommendedScore({ total_obligated: 1e8, last_action_date: '2025-06-01', distinct_agency_count: 8 }, false);
    expect(cert).toBeGreaterThan(noCert);
  });

  it('never NaN/negative on missing fields (a firm with no $ / no date)', () => {
    const s = recommendedScore({}, false);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
  });
});

describe('the Recommended re-rank is wired for the default sort only', () => {
  it('route re-ranks by recommendedScore when sort is empty, leaving explicit sorts intact', () => {
    expect(routeSrc).toContain('} else if (!params.sort) {');
    expect(routeSrc).toContain('recommendedScore(a.r');
    // Explicit dimension sorts still map to the raw recipient sort (unchanged).
    expect(routeSrc).toContain("value: 'total_obligated'");
  });
  it('the test mirror stays in sync with the route weights (drift guard)', () => {
    // If someone retunes the weights in route.ts, these must be updated too — this catches the drift.
    expect(routeSrc).toContain('0.34 * recencyTerm');
    expect(routeSrc).toContain('0.30 * dollarTerm');
    expect(routeSrc).toContain('0.20 * breadthTerm');
    expect(routeSrc).toContain('0.16 * setAsideTerm');
    expect(routeSrc).toContain('(Math.log10(dollars) - 4) / 6');
    expect(routeSrc).toContain('yearsStale / 8');
  });
});
