import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Filters-panel NAICS chip input must resolve through the CANONICAL catalog.
 *
 * 2026-08-23, Hector Jaquez Jr (JPAC Global): "I tried to search NAICS 324110 in the Mindy
 * map and it doesn't exist. Are you pulling in fuel contracts?"
 *
 * We were — 226 SAM records under 324110. Two separate defects kept him from seeing them:
 *
 *  1. The chip input called /api/suggest-codes, which is keyword-GROUNDING against
 *     USASpending, not a code lookup. Measured: it returned NOTHING for "324", "324110" or
 *     "petroleum". No suggestion means no chip; no chip means FILT.naics stays empty; so the
 *     NAICS filter could never be applied from the Filters panel at all.
 *
 *  2. Typed-but-uncommitted text looked like a filter. With "324" in the box the button read
 *     "Show 138,452 results" — the true UNFILTERED count. Correct, and completely misleading.
 *
 * Both are fixed here, in one change, because fixing only the affordance would leave the
 * discovery path broken and fixing only the endpoint would leave the perception bug.
 */
const SRC = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('NAICS chips resolve through the canonical catalog', () => {
  it('queries /api/app/naics-search for NAICS, not the keyword-grounding endpoint', () => {
    expect(SRC).toContain("'/api/app/naics-search?q='");
    expect(SRC).toContain("'/api/app/naics-search?counts=0&q='");
  });

  it('keeps suggest-codes for PSC/FSC, which have no catalog yet', () => {
    // Not a blanket swap — those code types still need the old path.
    expect(SRC).toMatch(/want==='naics'[\s\S]{0,240}suggest-codes/);
  });

  it('reads the catalog title field, falling back to the legacy name', () => {
    // /api/app/naics-search returns `title`; suggest-codes returns `name`. Reading only one
    // would render blank labels for whichever endpoint answered.
    expect(SRC).toContain('r.title||r.name');
  });

  it('renders live inventory on the suggestion row', () => {
    expect(SRC).toContain("bits.push(r.open+' open')");
    expect(SRC).toMatch(/recompetes\+' recompete'/);
  });

  it('omits a count it could not compute rather than showing zero', () => {
    // "0 open" on a failed count tells a contractor we do not cover their industry — the
    // exact lie this whole thread is about. typeof-guarded, so undefined renders nothing.
    expect(SRC).toContain("typeof r.open==='number'");
  });
});

describe('pending text is visibly NOT a filter', () => {
  it('has a reflectPending that surfaces uncommitted input', () => {
    expect(SRC).toContain('function reflectPending()');
    expect(SRC).toContain('is not applied yet');
  });

  it('runs on every keystroke, on commit, and whenever the count updates', () => {
    // Three entry points: typing, chipping, and the count refresh. Missing any one leaves
    // the note stale, which is its own small lie.
    const hooks = SRC.match(/reflectPending/g) || [];
    expect(hooks.length).toBeGreaterThanOrEqual(4);
  });

  it('marks the Apply button so the count cannot read as filtered', () => {
    expect(SRC).toContain("ap.classList.add('has-pending')");
    expect(SRC).toContain("ap.classList.remove('has-pending')");
  });

  it('styles pending as a caution state, not an error', () => {
    // The user has not done anything wrong — they have not finished. Amber, not red.
    expect(SRC).toContain('.mf-err.pending');
  });
});

describe('the committed-only rule survives', () => {
  it('still refuses unresolved free text into the query', () => {
    // The pre-existing guard: pending text blocks Apply rather than leaking into FILT.naics.
    expect(SRC).toContain('is not a code');
    expect(SRC).toContain('FILT.naics=_nc.value()');
  });
});
