/**
 * PHASE 2 — the hero opens a LENS, not just a filter.
 *
 * The hero already lands on the market its headline names (agency / industry / posted window).
 * What it could not do is what Eric called the biggest UX insight of the week: Today's Intel
 * should CONFIGURE the map with the day's DNA strands, so the briefing creates the curiosity and
 * the map satisfies it.
 *
 * The real lens (/app hero + daily alert email) is PROFILE-SCOPED — it counts strands across a
 * user's NAICS corpus via /api/app/todays-lens. The public top half of /today is anonymous, so it
 * cannot use that. But the three Featured cards ALREADY carry `dna[]` (100% populated, rendered
 * as chips) — so a lens can be derived with NO new API call and no auth.
 *
 * THE HONESTY PROBLEM this solves: the universe here is THREE cards. A strand on one of three is
 * noise, not "today's pattern". Measured on the live featured set: repeat_buyer on 3/3,
 * set_aside 2/3, and early_cycle / full_open / sb_friendly on 1/3 each. So a strand must appear
 * on at least TWO cards to be called a lens — otherwise the page would announce a pattern that a
 * single opportunity invented. When nothing clears the bar there is NO lens and the hero keeps
 * its existing href, rather than inventing one.
 *
 * Follows the established rule from lib/dashboard/todays-lens.ts: present strands only, top few
 * in declared order — never a strand with no opportunities behind it.
 */
import { describe, it, expect } from 'vitest';
import { featuredLens, withLens, FILTERABLE_STRANDS } from './intel';

const card = (...keys: string[]) => ({ dna: keys.map((k) => ({ key: k, label: k, tone: 'neutral' })) });

describe('the lens is derived from what the featured cards actually share', () => {
  it('names a strand every card carries', () => {
    const l = featuredLens([card('repeat_buyer'), card('repeat_buyer'), card('repeat_buyer')]);
    expect(l.strategy).toBe('repeat_buyer');
    expect(l.labels).toEqual(['Repeat Buyers']);
  });

  it('requires TWO cards — one card is an opportunity, not a pattern', () => {
    // The live set has early_cycle/full_open/sb_friendly on exactly 1 of 3. Calling that
    // "today's lens" would announce a trend a single notice invented.
    const l = featuredLens([card('repeat_buyer', 'sb_friendly'), card('repeat_buyer'), card('set_aside')]);
    expect(l.strategy).toBe('repeat_buyer');
    expect(l.strategy).not.toContain('sb_friendly');
    expect(l.strategy).not.toContain('set_aside');
  });

  it('emits NO lens when nothing is shared (never invents one)', () => {
    const l = featuredLens([card('repeat_buyer'), card('sb_friendly'), card('set_aside')]);
    expect(l.strategy).toBe('');
    expect(l.labels).toEqual([]);
  });

  it('only emits strands the MAP CAN FILTER — full_open/early_cycle have no checkbox', () => {
    // full_open is the 2nd most common strand in the corpus (24,608) but has no .mf-strategy
    // box, so it would produce a lens the map silently ignores.
    const l = featuredLens([card('full_open', 'early_cycle'), card('full_open', 'early_cycle')]);
    expect(l.strategy).toBe('');
    for (const k of l.strategy.split(',').filter(Boolean)) {
      expect(FILTERABLE_STRANDS as readonly string[]).toContain(k);
    }
  });

  it('caps at 3 and keeps the declared order, like the /app lens', () => {
    const all = ['repeat_buyer', 'sb_friendly', 'sources_sought', 'closes_soon', 'set_aside'];
    const l = featuredLens([card(...all), card(...all)]);
    expect(l.strategy.split(',')).toHaveLength(3);
    expect(l.strategy).toBe('repeat_buyer,sb_friendly,sources_sought');
  });

  it('is empty for an empty or single-card set rather than throwing', () => {
    expect(featuredLens([]).strategy).toBe('');
    expect(featuredLens([card('repeat_buyer')]).strategy).toBe('');
  });

  it('labels read like the product, not like database keys', () => {
    const l = featuredLens([card('sb_friendly', 'closes_soon'), card('sb_friendly', 'closes_soon')]);
    expect(l.labels).toEqual(['SB-Friendly', 'Close This Week']);
    expect(l.labels.join()).not.toContain('_');
  });
});

/**
 * The lens COMPOSES with the branch's own subject — it does not replace it.
 *
 * The concentration headline names DoD, so its link must be "DoD AND today's lens", not one or
 * the other. Both params are read by independent handlers on the map (scope params via
 * __applySavedSearch, strategy via the .mf-strategy boxes), so they compose with no new map code.
 */
describe('withLens appends the lens to a branch href without losing its subject', () => {
  it('adds &strategy= to an href that already has a query', () => {
    expect(withLens('/opportunity-map?agency=DEPT%20OF%20DEFENSE', 'repeat_buyer,set_aside'))
      .toBe('/opportunity-map?agency=DEPT%20OF%20DEFENSE&strategy=repeat_buyer%2Cset_aside');
  });

  it('returns the href untouched when there is no lens', () => {
    expect(withLens('/opportunity-map?posted=1', '')).toBe('/opportunity-map?posted=1');
  });

  it('never double-applies a strategy the href already carries', () => {
    const h = '/opportunity-map?opp=abc&strategy=closes_soon';
    expect(withLens(h, 'repeat_buyer')).toBe(h);
  });
});
