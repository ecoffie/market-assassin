/**
 * Guards resolveBuyerLocation + isCityInState — the Gov Buyer location coherence fix.
 *
 * The bug: a State-Dept POC sits on an OVERSEAS notice — pop_city="Seoul",
 * pop_state="KR-11" (a foreign ISO subdivision, NOT a US state) — bought by a DC office.
 * The old code kept the pop CITY and, because "KR-11" isn't a US state, fell the STATE back
 * to the office's "DC" → "Seoul, DC" (a foreign city on a US state it isn't in). The
 * resolver must NEVER produce that: a city is kept only when it's a real GeoNames city IN
 * the resolved state.
 */
import { describe, it, expect } from 'vitest';
import { resolveBuyerLocation, isCityInState } from './city-geocode';

describe('isCityInState', () => {
  it('true only for a real city inside the given US state', () => {
    expect(isCityInState('Washington', 'DC')).toBe(true);
    expect(isCityInState('Louisville', 'KY')).toBe(true);
  });
  it('false for a foreign city, a mismatched pairing, or a non-US state', () => {
    expect(isCityInState('Seoul', 'DC')).toBe(false); // foreign city, not in DC
    expect(isCityInState('Louisville', 'CA')).toBe(false); // real city, wrong state
    expect(isCityInState('Washington', 'KR-11')).toBe(false); // non-US state
    expect(isCityInState('', 'DC')).toBe(false);
  });
});

describe('resolveBuyerLocation', () => {
  it('THE BUG: foreign pop (Seoul / KR-11) + DC office → the OFFICE\'s coherent Washington, DC — NEVER "Seoul, DC"', () => {
    const loc = resolveBuyerLocation({ popCity: 'Seoul', popState: 'KR-11', officeCity: 'Washington', officeState: 'DC' });
    // Seoul is DROPPED (foreign, not in DC); the coherent buying-office city Washington|DC is used.
    expect(loc).toEqual({ state: 'DC', city: 'Washington', approxNote: 'buying office' });
    expect(loc!.city).not.toBe('Seoul');
  });

  it('foreign pop + a buying-office CITY not in the office state → office state-only (no bogus city)', () => {
    // office_city is a base name not in GeoNames → drops to state-level, never fabricated.
    const loc = resolveBuyerLocation({ popCity: 'Manila', popState: null, officeCity: 'JBSA FT SAM HOUSTON', officeState: 'DC' });
    expect(loc).toEqual({ state: 'DC', city: '', approxNote: 'buying office' });
  });

  it('valid US pop city+state → uses the real place of performance', () => {
    const loc = resolveBuyerLocation({ popCity: 'Washington', popState: 'DC', officeCity: null, officeState: null });
    expect(loc).toEqual({ state: 'DC', city: 'Washington', approxNote: '' });
  });

  it('valid US pop state but a city that is not in it → state-only (no bogus "City, WrongState")', () => {
    const loc = resolveBuyerLocation({ popCity: 'Seoul', popState: 'VA', officeCity: null, officeState: null });
    expect(loc).toEqual({ state: 'VA', city: '', approxNote: '' });
  });

  it('accepts a full state name for the office fallback', () => {
    const loc = resolveBuyerLocation({ popCity: 'Paris', popState: 'FR-75', officeCity: 'Washington', officeState: 'District of Columbia' });
    expect(loc).toEqual({ state: 'DC', city: 'Washington', approxNote: 'buying office' });
  });

  it('no real US state anywhere → null (never fabricate a location)', () => {
    expect(resolveBuyerLocation({ popCity: 'Seoul', popState: 'KR-11', officeCity: 'Seoul', officeState: 'KR-11' })).toBeNull();
    expect(resolveBuyerLocation({ popCity: null, popState: null, officeCity: null, officeState: null })).toBeNull();
  });

  it('CANONICAL INVARIANT: a resolved city is ALWAYS in the resolved state', () => {
    const cases = [
      { popCity: 'Seoul', popState: 'KR-11', officeCity: 'Washington', officeState: 'DC' },
      { popCity: 'Manila', popState: null, officeCity: 'Louisville', officeState: 'KY' },
      { popCity: 'Washington', popState: 'DC', officeCity: null, officeState: null },
      { popCity: 'Nowhereville', popState: 'TX', officeCity: null, officeState: null },
    ];
    for (const c of cases) {
      const loc = resolveBuyerLocation(c);
      if (loc && loc.city) expect(isCityInState(loc.city, loc.state)).toBe(true);
    }
  });
});
