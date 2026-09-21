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
 * RE-MEASURED 2026-07-31 against the CURRENT label-derived embeddings. The old 0.60–0.75 band
 * (measured on a different/richer embedding) returned 0 for EVERY firm — the current embeddings
 * cluster tight (~0.95–1.0 same-label clones) then cliff, so nothing lands in 0.60–0.75. The real
 * "different label but related work" firms sit at 0.80–0.94:
 *   Aircraft landing equipment → Aircraft landing gear COMPONENTS makers (0.86–0.88)
 *   Valves, nonpowered         → Valves POWERED + hose/pipe (0.90–0.92)
 * Above ~0.94 a different label is usually the same work relabeled (a competitor). Band = 0.80–0.94.
 * The identical-label exclusion still drops pure competitors. Some firms (produce, wildland fire)
 * genuinely have no adjacency → an honest empty result. (See the RPC: capability_complement_search.)
 */
describe('partner-fit similarity band', () => {
  it('excludes near-identical firms — those are competitors, not partners (upper bound)', () => {
    expect(SRC).toMatch(/maxSimilarity \?\? 0\.94/);
  });

  it('also excludes unrelated firms via a lower bound', () => {
    expect(SRC).toMatch(/minSimilarity \?\? 0\.80/);
  });

  it('additionally drops an identical capability label regardless of cosine', () => {
    // Belt-and-braces: same label = competitor by definition. Enforced in the RPC (DISTINCT FROM the
    // anchor label) and in the JS fallback (r.capability_label === anchor.capability_label).
    expect(SRC).toMatch(/r\.capability_label === anchor\.capability_label/);
  });

  it('never matches the anchor against itself', () => {
    expect(SRC).toMatch(/\.neq\('rollup_uei', opts\.rollupUei\)/);
  });

  it('does the banded search via the pgvector RPC (fast), not the JS scan', () => {
    expect(SRC).toMatch(/capability_complement_search/);
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
