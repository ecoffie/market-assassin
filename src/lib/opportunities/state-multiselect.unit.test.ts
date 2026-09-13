/**
 * THE MULTI-STATE CONTRACT. Guards the defect where a state filter FAILED OPEN.
 *
 * Measured on prod 2026-09-12, before this fix:
 *   Open     ?state=FL    -> 1      ?state=FL,GA -> 497     (497 == the UNFILTERED baseline)
 *   Awarded  ?state=FL    -> 4,506  ?state=FL,GA -> 106,965 (== the entire table)
 *   Forecast ?state=FL    -> 372    ?state=Florida -> 20    (same question, two answers)
 * `normalizeStateCode` understands ONE value, so "FL,GA" returned null, the `if` was skipped,
 * and no predicate was added. Every malformed value did it too: FL,XX · XX · ZZZZ · FLA · F.
 *
 * The rule these tests lock in: OR within state, AND across dimensions, and an asked-for
 * filter that resolves to nothing must match NOTHING — never widen to everything.
 */
import { describe, it, expect } from 'vitest';
import { parseStateList, stateOrExpr, NO_MATCH_SENTINEL } from './map-filters';

describe('parseStateList — the multi-state contract', () => {
  it('null ONLY when the user asked for no state (the sole widening case)', () => {
    expect(parseStateList('')).toBeNull();
    expect(parseStateList(null)).toBeNull();
    expect(parseStateList(undefined)).toBeNull();
    expect(parseStateList('   ')).toBeNull();
  });

  it('parses a single code or full name', () => {
    expect(parseStateList('FL')).toEqual(['FL']);
    expect(parseStateList('fl')).toEqual(['FL']);
    expect(parseStateList('Florida')).toEqual(['FL']);
  });

  it('THE BUG: comma-separated states parse to a LIST, not null', () => {
    expect(parseStateList('FL,GA')).toEqual(['FL', 'GA']);
    expect(parseStateList('FL, GA')).toEqual(['FL', 'GA']);
    expect(parseStateList('FL,Georgia')).toEqual(['FL', 'GA']); // mixed forms
    expect(parseStateList('FL,GA,TX')).toEqual(['FL', 'GA', 'TX']);
  });

  it('dedupes equivalent spellings', () => {
    expect(parseStateList('FL,Florida,fl')).toEqual(['FL']);
  });

  it('keeps the valid half of a partly-invalid list (never widens)', () => {
    expect(parseStateList('FL,XX')).toEqual(['FL']);
  });

  it('FAILS CLOSED: asked-for but fully unresolvable returns [] — NOT null', () => {
    // [] and null mean different things. null = "no filter"; [] = "filter matched nothing".
    // Returning null here is precisely the bug: it would widen to the whole corpus.
    for (const bad of ['XX', 'ZZZZ', 'FLA', 'F', 'XX,YY', '123']) {
      const got = parseStateList(bad);
      expect(got, `${bad} must not be null`).not.toBeNull();
      expect(got, `${bad} must resolve to no codes`).toEqual([]);
    }
  });
});

describe('stateOrExpr — OR within the state dimension', () => {
  it('ORs both location columns for one state', () => {
    expect(stateOrExpr(['FL'])).toBe('pop_state.eq.FL,office_address->>state.eq.FL');
  });

  it('ORs every state across both columns', () => {
    expect(stateOrExpr(['FL', 'GA'])).toBe(
      'pop_state.eq.FL,office_address->>state.eq.FL,pop_state.eq.GA,office_address->>state.eq.GA',
    );
  });

  it('null on empty so the caller must handle match-nothing explicitly', () => {
    expect(stateOrExpr([])).toBeNull();
  });
});

describe('NO_MATCH_SENTINEL', () => {
  it('is a value no real 2-letter state column can equal', () => {
    // Guards fail-closed: this is what an unresolvable filter is pinned to.
    expect(NO_MATCH_SENTINEL).toBe('__NONE__');
    expect(NO_MATCH_SENTINEL).not.toMatch(/^[A-Z]{2}$/);
  });

  it('is defined despite the map-filters <-> map-data import cycle', () => {
    // map-filters imports SET_GROUPS from map-data, and map-data imports this sentinel back.
    // A module-level const read through a cycle can be undefined at init — assert it is not,
    // because an undefined sentinel would make `.eq(col, undefined)` and fail OPEN again.
    expect(NO_MATCH_SENTINEL).toBeDefined();
    expect(typeof NO_MATCH_SENTINEL).toBe('string');
  });
});
