import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, 'semantic-search.ts'), 'utf8');

/**
 * REGRESSION (2026-07-28): both read paths used `.limit(20000)`, but PostgREST hard-caps a
 * response at 1,000 rows regardless of .limit(). The vector scan therefore only ever saw the
 * top 1,000 contractors by obligated dollars — the mega-primes — and never reached the small
 * businesses this feature exists to surface.
 *
 * Measured effect of the fix, same queries:
 *   "cybersecurity and network defense"  before: RITE-SOLUTIONS "Services (defense other)" 0.547
 *                                        after:  JOINT TACTICS "Cyber security and data backup" 0.582
 *   "wildland firefighting crews"        before: 2 helicopter firms then unrelated construction
 *                                        after:  4 dedicated wildland fire suppression firms
 *   scanned                              before: 1000        after: 20000
 *
 * These are source assertions (the query paths need a live DB), pinning the shape so the cap
 * cannot silently come back.
 */
describe('semantic-search paging (PostgREST 1,000-row cap)', () => {
  it('does not rely on .limit() for the vector scan', () => {
    expect(SRC).not.toMatch(/\.limit\(20000\)/);
  });

  it('pages both read paths through fetchAllPages', () => {
    // Two CALL sites — the search path and the partner-fit path. (The definition itself reads
    // `async function fetchAllPages<T>(`, so match the awaited calls specifically.)
    const calls = SRC.match(/await fetchAllPages\(/g) || [];
    expect(calls.length).toBe(2);
    expect(SRC).toMatch(/async function fetchAllPages<T>\(/);
  });

  it('stops paging on a short page rather than looping to the cap', () => {
    expect(SRC).toMatch(/if \(page\.length < to - from \+ 1\) break/);
  });

  it('keeps the page size at the PostgREST maximum', () => {
    expect(SRC).toMatch(/const PAGE = 1000/);
  });

  it('orders by obligated dollars so a capped scan keeps the most significant firms', () => {
    expect(SRC).toMatch(/order\('total_obligated', \{ ascending: false \}\)/);
  });
});

/**
 * REGRESSION (2026-07-28): the partner band was first set to 0.45–0.85 by intuition, and returned
 * four more "Fruits and vegetables" firms for a produce distributor — i.e. exactly the competitors
 * the mode exists to exclude.
 *
 * Measured on 8,000 scored contractors (anchor FOSTER-CAVINESS, "Fruits and vegetables"):
 *   top 50 → 50/50 IDENTICAL capability label (pure competitors)
 *   0.80–0.86 same/near-identical · 0.70–0.80 close cousins
 *   0.60–0.70 GENUINE ADJACENCY   · 0.50–0.60 unrelated noise
 * Retuned to 0.60–0.75. After: oils/fats, meat & poultry, bakery, beverages, catering — real
 * complementary food-service teammates.
 */
describe('partner-fit similarity band', () => {
  it('excludes near-identical firms — those are competitors, not partners', () => {
    // The UPPER bound is what makes partner-fit different from plain similarity search.
    expect(SRC).toMatch(/maxSimilarity \?\? 0\.75/);
    expect(SRC).toMatch(/similarity > maxSim/);
  });

  it('also excludes unrelated firms via a lower bound', () => {
    expect(SRC).toMatch(/minSimilarity \?\? 0\.6/);
  });

  it('additionally drops an identical capability label regardless of cosine', () => {
    // Belt-and-braces: same label = competitor by definition, and it is the most obviously
    // wrong row a user would notice first.
    expect(SRC).toMatch(/r\.capability_label === anchor\.capability_label/);
  });

  it('never matches the anchor against itself', () => {
    expect(SRC).toMatch(/\.neq\('rollup_uei', opts\.rollupUei\)/);
  });

  it('keeps the band tight enough that it cannot silently widen back to the buggy values', () => {
    expect(SRC).not.toMatch(/maxSimilarity \?\? 0\.8[0-9]/);
    expect(SRC).not.toMatch(/minSimilarity \?\? 0\.4[0-9]/);
  });
});

describe('failure behaviour', () => {
  it('returns empty rather than throwing — semantic search is an enhancement, not a dependency', () => {
    // Both exported functions wrap their body in try/catch and return an empty shape.
    expect((SRC.match(/catch \(err\)/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(SRC).toMatch(/return \{ matches: \[\], scanned: 0, query \}/);
  });

  it('uses a measured similarity floor, not an aspirational one', () => {
    // Capability-blob vs free-text tops out well below the 0.8+ people expect from embeddings;
    // the sibling hidden-match feature measured ~0.50 on the same model.
    expect(SRC).toMatch(/CAPABILITY_SEMANTIC_MIN \|\| '0\.30'/);
  });
});
