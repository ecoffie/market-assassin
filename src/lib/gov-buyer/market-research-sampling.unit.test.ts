import { describe, it, expect } from 'vitest';
import fs from 'fs';

/**
 * TWO defects made every market report "capable: 0, Rule of Two NOT met" —
 * on the engine behind the Navy Gold Coast demo.
 *
 *  1. `.limit(50)` with NO ordering: Postgres returned an arbitrary page of a
 *     44,788-firm market, of which only ~5.6% have any award history. So ~47 of
 *     50 candidates were never-won registrants and the BQ join correctly found
 *     nothing for them.
 *  2. `queryCached` defaults to cacheOnly:TRUE — on a cache miss it returns []
 *     WITHOUT querying BigQuery. fetchActivity never opted into live BQ, so the
 *     award history was empty regardless of who was sampled.
 *
 * A contracting officer would have read "zero capable firms" for a market with
 * hundreds of proven performers — a confident 0 where the truth is the opposite,
 * and exactly what the Market Research Workspace PRD forbids ("Show Unknown,
 * NOT 0"). Source-level guards; the live behaviour is verified by hand against
 * BigQuery (541512: 0 → 138 capable).
 */
const SRC = fs.readFileSync('src/lib/gov-buyer/market-research.ts', 'utf8');

describe('market research candidate sampling', () => {
  it('opts into live BigQuery — cacheOnly:false is present', () => {
    // Without this, fetchActivity silently returns [] on any cache miss.
    expect(SRC).toMatch(/cacheOnly:\s*false/);
  });

  it('does not take a bare unordered .limit() as the candidate pool', () => {
    // The original bug, verbatim: `.eq('exclusion_flag', false)\n    .limit(limit)`
    expect(SRC).not.toMatch(/exclusion_flag',\s*false\)\s*\n\s*\.limit\(limit\)/);
  });

  it('pages a pool wider than the requested limit', () => {
    expect(SRC).toMatch(/POOL_TARGET/);
    // Paged, because PostgREST caps a single select at 1000 rows.
    expect(SRC).toMatch(/\.range\(/);
  });

  it('keeps performers AND registrants — new entrants are never dropped', () => {
    // The fairness rule in the module header: emerging/registered-only firms
    // stay visible; they just stop crowding performers out of the sample.
    expect(SRC).toMatch(/const performers = pool\.filter/);
    expect(SRC).toMatch(/const rest = pool\.filter/);
  });
});
