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

  it('is NOT a bug when the row carries no signal at all (2026-08-02)', () => {
    // A source that HAS a place column can still ship a blank one, and there is
    // nothing to recover from a blank. Calling it fixable grew a permanently-red
    // 760 rows (USACE 203, GSA 95, DOJ 60, ONR 37) with no location in ANY column
    // or in raw_data — a number nobody could act on.
    //
    // What DOES make a blank row fixable is the source having said something we
    // failed to parse — that arrives via sourcePlaceText, tested below.
    expect(g(null, { publishes: true })).toBe('NO_LOCATION_PUBLISHED');
    expect(isFixable(g(null, { publishes: true }))).toBe(false);
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

describe('the source\'s OWN answer beats an empty column (Eric, 2026-08-02)', () => {
  const said = (sourcePlaceText: string) =>
    classifyMapGap({ map_lat: null, pop_state: null, pop_city: null, sourcePlaceText }, true);

  it('counts a source-declared non-place as NOT_A_PLACE, not a bug', () => {
    // THE OVER-COUNT: the Navy LRAE publishes a place column, so every blank
    // row read as FIXABLE — 3,788 of them. But 3,546 carry "TBD" (1,810) or
    // "VENDOR'S FACILITY" (1,607) in the source: the Navy DID answer, and the
    // answer is "there is no single place". Work performed on a contractor's
    // own premises has no government location to pin.
    for (const s of ['TBD', "VENDOR'S FACILITY", 'Virtual', 'MULTIPLE', 'Other',
                     'Off Site', '80% Government site; 20% off-site', '100% Contractor Site']) {
      expect(said(s), `"${s}" is the agency saying there is no place`).toBe('NOT_A_PLACE');
      expect(isFixable(said(s))).toBe(false);
    }
  });

  it('still calls an UNRESOLVED shorthand fixable — that is real work', () => {
    // The 228 that remain: contract-vehicle codes and multi-base regions. The
    // source named something; we could not resolve it. That is unfinished.
    for (const s of ['ML: CON22 PDC', 'SW: PDCMAR', 'MCI West', 'ML: OCEANA']) {
      expect(said(s), `"${s}" names something we failed to resolve`).toBe('RECOVERABLE_FORMAT');
      expect(isFixable(said(s))).toBe(true);
    }
  });

  it('reads a withheld location out of pop_CITY, not just pop_state', () => {
    // USDA writes "Cannot be disclosed" into the CITY and leaves state null on
    // 1,627 rows. Testing only pop_state missed every one and counted a
    // deliberate withholding as unfinished work.
    const g = classifyMapGap(
      { map_lat: null, pop_state: null, pop_city: 'Cannot be disclosed' }, true);
    expect(g).toBe('SUPPRESSED_BY_SOURCE');
    expect(isFixable(g)).toBe(false);
  });

  it('reports a signal-less row the same way regardless of the source flag', () => {
    // Both directions are NO_LOCATION_PUBLISHED now: with nothing in pop_state,
    // pop_city or the source row, "the portal has the field" does not make THIS row
    // recoverable. The flag still documents the source-level fact for the ledger.
    for (const publishes of [true, false]) {
      expect(classifyMapGap({ map_lat: null, pop_state: null, pop_city: null }, publishes))
        .toBe('NO_LOCATION_PUBLISHED');
    }
  });
});
