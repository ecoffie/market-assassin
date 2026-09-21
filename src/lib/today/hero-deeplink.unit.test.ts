/**
 * The hero was the LAST unconfigured link on /today.
 *
 * Every headline names something specific — an agency, an industry, a week's postings — and then
 * sent the reader to a bare /opportunity-map showing all 145,467 opportunities. The page made a
 * claim and the map didn't back it up. Phase 2 of "/today is a control panel for the map".
 *
 * Each branch lands on what its OWN headline is about:
 *   concentration ("DoD is driving 66% of new demand")  -> that agency's map
 *   surge         ("Federal buying accelerated")        -> ?posted=7, the week it cites
 *   mover         ("Construction jumped 62%")           -> that industry's map
 *   baseline      ("1,371 posted overnight")            -> ?posted=1, the day it cites
 *
 * KEY DESIGN POINT: the agency and mover branches REUSE `topAgency.href` / `topMover.href` —
 * the exact links Top Buyers and Trending Markets already emit and that were verified narrowing
 * the map. They are NOT rebuilt here. Rebuilding would create a second place that constructs the
 * same URL, which is how this codebase got ?saved= vs ?ss= and the agency display-name-vs-needle
 * mismatch. One emitter, reused.
 */
import { describe, it, expect } from 'vitest';
import { buildHeroStory } from './intel';

const AGENCY = { display: 'Dept of Defense', newThisWeek: 700, href: '/opportunity-map?agency=DEPT%20OF%20DEFENSE' };
const MOVER = { name: 'Food manufacturing', pctChange: 62, href: '/opportunity-map?naics=311999' };

describe('every hero branch lands on the market its headline describes', () => {
  it('concentration → the named agency, reusing the row href (not a rebuilt URL)', () => {
    const h = buildHeroStory({ newToday: 100, newWeek: 1000, prevWeek: 990, topAgency: { ...AGENCY, newThisWeek: 700 } });
    expect(h.headline).toContain('Dept of Defense');
    expect(h.href).toBe(AGENCY.href);
  });

  it('surge → ?posted=7, the week the headline actually cites', () => {
    const h = buildHeroStory({ newToday: 100, newWeek: 2000, prevWeek: 1000 });
    expect(h.headline).toMatch(/accelerated|slowed/);
    expect(h.href).toBe('/opportunity-map?posted=7');
  });

  it('mover → the named industry, reusing the row href', () => {
    // No topAgency and a flat week, so concentration and surge cannot claim this.
    const h = buildHeroStory({ newToday: 100, newWeek: 1000, prevWeek: 990, topMover: MOVER });
    expect(h.headline).toContain('Food manufacturing');
    expect(h.href).toBe(MOVER.href);
  });

  it('baseline → ?posted=1, the overnight window it names', () => {
    const h = buildHeroStory({ newToday: 100, newWeek: 1000, prevWeek: 990 });
    expect(h.headline).toContain('posted overnight');
    expect(h.href).toBe('/opportunity-map?posted=1');
  });

  it('never emits a bare /opportunity-map from any branch', () => {
    // The whole point: no branch may hand back an unconfigured map.
    const cases = [
      { newToday: 100, newWeek: 1000, prevWeek: 990, topAgency: { ...AGENCY, newThisWeek: 700 } },
      { newToday: 100, newWeek: 2000, prevWeek: 1000 },
      { newToday: 100, newWeek: 1000, prevWeek: 990, topMover: MOVER },
      { newToday: 100, newWeek: 1000, prevWeek: 990 },
    ];
    for (const c of cases) expect(buildHeroStory(c).href).not.toBe('/opportunity-map');
  });

  it('degrades to a posted window if a row ever arrives without an href', () => {
    // Defensive: an hrefless row must not produce `undefined` in the address bar.
    const h = buildHeroStory({
      newToday: 100, newWeek: 1000, prevWeek: 990,
      topAgency: { display: 'Dept of Defense', newThisWeek: 700 } as { display: string; newThisWeek: number; href?: string },
    });
    expect(h.href).toBe('/opportunity-map?posted=7');
    expect(h.href).not.toContain('undefined');
  });
});
