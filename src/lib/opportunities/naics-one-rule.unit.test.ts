import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { naicsMatchConds } from './map-filters';

/**
 * THE INVARIANT: NAICS matching has one definition. All consumers call it.
 *
 * The rule was written inline in five places (map-filters ×3, map-data ×2, by-office ×1).
 * On 2026-08-23 the 5-digit fix landed on ONE of them, and the same screen then answered
 * differently depending on which control the user touched:
 *
 *   search box  `33641` -> 2,230 rows      (prefix path, fixed)
 *   Filters box `33641` -> 0 rows          (exact path against 6-digit values)
 *
 * Separately, a 6-digit code widening to its 3-digit family is what made a count read 3,555
 * when the truth was 805.
 *
 * These are BEHAVIOURAL assertions on the helper, plus one source check that the copies are
 * actually gone — a helper nobody calls fixes nothing.
 */
describe('naicsMatchConds — the one rule', () => {
  it('a full 6-digit code is EXACT, never its family', () => {
    // The count bug: `eq 333612 OR like 333%` counted 3,528 rows against 118 real matches.
    expect(naicsMatchConds(['333612'])).toEqual(['naics_code.eq.333612']);
    expect(naicsMatchConds(['324110'])).toEqual(['naics_code.eq.324110']);
  });

  it('a 5-digit code widens by PREFIX — the case that matched nothing', () => {
    // Stored codes are 6 digits, so `.eq('33641')` matches zero rows. Measured before the
    // fix: 0 returned against 2,230 real ones.
    expect(naicsMatchConds(['33641'])).toEqual(['naics_code.like.33641%']);
  });

  it('2-, 3- and 4-digit codes widen — the user typed a family and means it', () => {
    expect(naicsMatchConds(['32'])).toEqual(['naics_code.like.32%']);
    expect(naicsMatchConds(['324'])).toEqual(['naics_code.like.324%']);
    expect(naicsMatchConds(['3241'])).toEqual(['naics_code.like.3241%']);
  });

  it('multi-select keeps each code on its own rule', () => {
    expect(naicsMatchConds(['324110', '541'])).toEqual([
      'naics_code.eq.324110',
      'naics_code.like.541%',
    ]);
  });

  it('drops blanks instead of emitting eq.<empty>, which matches nothing silently', () => {
    expect(naicsMatchConds([])).toEqual([]);
    expect(naicsMatchConds(['', '  '])).toEqual([]);
    expect(naicsMatchConds([' 324110 '])).toEqual(['naics_code.eq.324110']);
  });
});

describe('no inline copies survive', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

  it('map-filters defines the rule exactly once', () => {
    const src = read('src/lib/opportunities/map-filters.ts');
    const inline = src.match(/naics_code\.(like|eq)\./g) || [];
    // Only the two branches inside naicsMatchConds itself.
    expect(inline.length).toBe(2);
  });

  it('map-data calls the helper rather than restating the rule', () => {
    const src = read('src/lib/opportunities/map-data.ts');
    expect(src).toContain('naicsMatchConds');
    // A length-threshold literal here means someone re-inlined it.
    expect(src).not.toMatch(/c\.length (<|>)=? \d \? `naics_code/);
  });

  it('by-office uses < 6, not the old <= 4', () => {
    const src = read('src/lib/opportunities/by-office.ts');
    expect(src).toContain('n.length < 6');
    expect(src).not.toContain('n.length <= 4');
  });
});
