import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The count must describe the SAME universe as the rows.
 *
 * A demo attendee reported "I cant filter with 333612" (2026-08-22). The filter worked and
 * every rendered card was 333612 — but the header said "3,555 results" when the true total
 * was 805, so they concluded nothing had happened.
 *
 * The cause was here: a single-code NAICS search widened to its 3-digit family for the COUNT
 * query — `naics_code.eq.333612 OR naics_code.like.333%` — which is 3,528 rows against 118
 * real matches. The map header sums each horizon's totalForFilters, so that number became the
 * headline.
 *
 * This is a source-level guard because the defect is a query-shape mistake, not a behaviour
 * reachable from a unit test without a live database. The browser-level contract test
 * (scripts/verify-filter-contract.mjs) covers the end-to-end assertion.
 */
const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/app/recompete-map/route.ts'),
  'utf8',
);

describe('recompete-map NAICS count honesty', () => {
  it('does not widen a full NAICS code to its 3-digit family', () => {
    // The exact shape that caused the bug. If this reappears, the count starts lying again.
    expect(SRC).not.toMatch(/naics_code\.like\.\$\{[^}]*substring\(0,\s*3\)/);
    expect(SRC).not.toContain('substring(0, 3)');
  });

  it('keeps prefix-widening for SHORT codes, where the user means the family', () => {
    // "333" typed by a user is a sector, not a code — widening there is correct and must stay.
    // The threshold is < 6 because stored codes are 6 digits: a 5-digit eq matches nothing
    // (measured — `33361` returned 0 before this was corrected).
    expect(SRC).toMatch(/length < 6/);
    expect(SRC).toMatch(/q\.like\('naics_code'/);
  });

  it('uses exact match only for a full 6-digit code', () => {
    expect(SRC).toMatch(/q\.eq\('naics_code'/);
  });

  it('applies the same filter builder to the count and the rows', () => {
    // The contract only holds if one function feeds both. If the count query stops going
    // through applyFilters, the two can drift apart again silently.
    expect(SRC).toMatch(/totalForFiltersHead\s*=\s*applyFilters\(/);
    expect(SRC).toMatch(/applyFilters\(db\.from\('recompete_opportunities'\)\.select\(COLS/);
  });
});
