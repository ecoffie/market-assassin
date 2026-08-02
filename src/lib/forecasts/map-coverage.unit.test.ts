/**
 * Guards the map-gap classification.
 *
 * Every fixture is a VERBATIM pop_state value from the live agency_forecasts
 * table (30,777 rows, 15,021 unmapped), not an invented example.
 */
import { describe, it, expect } from 'vitest';
import { classifyMapGap, isFixable, mapGapLabel } from './map-coverage';

const g = (pop_state: string | null, opts: { city?: string; publishes?: boolean } = {}) =>
  classifyMapGap(
    { map_lat: null, pop_state, pop_city: opts.city ?? null },
    opts.publishes ?? true,
  );

describe('step 1 — a blank means different things for different sources', () => {
  it('is ACCEPTED when the source publishes no location field', () => {
    // HHS (3,643), NASA (225): verified by opening the portal. This is the only
    // honest 0%.
    expect(g(null, { publishes: false })).toBe('NO_LOCATION_PUBLISHED');
  });

  it('is a BUG when the source DOES publish one', () => {
    // EPA had 27 of 50 rows naming a state in raw_data that nothing mapped, and
    // Treasury had 198 clean codes that a country-spelling guard rejected. Both
    // looked identical to HHS from the database side.
    expect(g(null, { publishes: true })).toBe('RECOVERABLE_FORMAT');
    expect(isFixable(g(null, { publishes: true }))).toBe(true);
  });
});

describe('step 2 — a real place in the wrong shape is RECOVERABLE', () => {
  it('catches a city+state written into the state column', () => {
    // NRL ships 9 rows of "Washington, DC" and 3 of "Stennis Space Center, MS".
    expect(g('Washington, DC')).toBe('RECOVERABLE_FORMAT');
    expect(g('Stennis Space Center, MS')).toBe('RECOVERABLE_FORMAT');
  });

  it('catches a multi-state list and a country suffix', () => {
    expect(g('CO; NJ')).toBe('RECOVERABLE_FORMAT');
    expect(g('CA United States')).toBe('RECOVERABLE_FORMAT');
  });
});

describe('step 3 — non-state tokens in a state column are CORRUPT', () => {
  it('flags the two-letter truncation artifacts', () => {
    // DOI/GSA/DOT carry ~670 of these: the first two letters of a word.
    // "Uwharrie Road Maintenance" is in North Carolina, filed as "NO".
    for (const s of ['DI', 'TE', 'WE', 'NO']) {
      expect(g(s), `${s} is not a state`).toBe('CORRUPT_STATE');
    }
  });

  it('does NOT flag real USPS codes that happen to be two letters', () => {
    // VI is genuinely the US Virgin Islands — one of its rows has the city
    // "Red Hook National Park". Lumping it with the truncations would discard
    // 149 real locations.
    for (const s of ['VI', 'DC', 'PR', 'GU', 'CA']) {
      expect(g(s), `${s} IS a state/territory`).not.toBe('CORRUPT_STATE');
    }
  });

  it('flags a NAICS code sitting in the state column', () => {
    // ONR shipped exactly this — a parser wiring bug, not a location.
    expect(g('541611: Administrative Management and General Management Consulting Services'))
      .toBe('CORRUPT_STATE');
  });
});

describe('step 4 — "no single place" is a fact, not a gap', () => {
  it('accepts the explicit non-locations', () => {
    for (const s of ['TBD', 'Various', 'Nationwide', '[Nationwide]', 'Worldwide',
                     'Headquarters', 'HQ', 'Off Site', 'Secret', 'Region 02',
                     "Contractor's Facility", 'Unavailable']) {
      expect(g(s), `"${s}" asserts no single place`).toBe('NOT_A_PLACE');
      expect(isFixable(g(s))).toBe(false);
    }
  });

  it('never invents a centroid for them', () => {
    // A nationwide IDIQ pinned to Kansas is a lie about scope, not a convenience.
    expect(isFixable(g('Nationwide'))).toBe(false);
    expect(mapGapLabel(g('Nationwide'))).toBe('No single location (nationwide or TBD)');
  });
});

describe('step 5 — a withheld location is information', () => {
  it('separates deliberate suppression from a missing field', () => {
    // USDA 1,625 + GSA 53 say this outright. "Withheld" and "never published"
    // are different facts and the user should see which.
    expect(g('Cannot be disclosed')).toBe('SUPPRESSED_BY_SOURCE');
    expect(mapGapLabel(g('Cannot be disclosed'))).toBe('Location withheld by the agency');
  });
});

describe('the UI never shows a blank', () => {
  it('gives every gap a reason', () => {
    for (const s of [null, 'TBD', 'Cannot be disclosed', 'DI', 'Washington, DC']) {
      const label = mapGapLabel(g(s));
      expect(label, `"${s}" must have a label`).toBeTruthy();
    }
  });

  it('returns no label for a mapped row', () => {
    expect(classifyMapGap({ map_lat: 38.9, pop_state: 'DC' }, true)).toBe('MAPPED');
    expect(mapGapLabel('MAPPED')).toBeNull();
  });
});
