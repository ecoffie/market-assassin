/**
 * Guards the Navy installation gazetteer.
 *
 * Every fixture is a VERBATIM "Anticipated Place of Performance" value from the
 * live LRAE rows (276 distinct values across 5,026 forecasts), not an invented
 * example.
 */
import { describe, it, expect } from 'vitest';
import { resolveNavyPlace, isNavyNonPlace } from './navy-installations';

describe('NAVFAC shorthand', () => {
  it('strips the region prefix and resolves the installation', () => {
    expect(resolveNavyPlace('ML: OCEANA')).toEqual({ city: 'Virginia Beach', state: 'VA' });
    expect(resolveNavyPlace('ML: NORFOLK')).toEqual({ city: 'Norfolk', state: 'VA' });
    expect(resolveNavyPlace('ML: CRANE')).toEqual({ city: 'Crane', state: 'IN' });
    expect(resolveNavyPlace('ML: GREAT LAKES')).toEqual({ city: 'Great Lakes', state: 'IL' });
  });

  it('strips a facility-type suffix too', () => {
    // "PDC"/"FSC"/"CON" qualify a base; they are not a different place.
    expect(resolveNavyPlace('NW: BANGOR PDC')).toEqual({ city: 'Silverdale', state: 'WA' });
    expect(resolveNavyPlace('W: PAX PDC')).toEqual({ city: 'Patuxent River', state: 'MD' });
    expect(resolveNavyPlace('W: BETHESDA FSC')).toEqual({ city: 'Bethesda', state: 'MD' });
  });

  it('resolves an acronym-only base', () => {
    // Aiea, not "Pearl Harbor": the city gazetteer has no "Pearl Harbor" entry,
    // so that name fell back to a HI STATE centroid — which sits in open ocean
    // between islands. Aiea borders the base (~4km) and resolves exactly.
    expect(resolveNavyPlace('JBPHH')).toEqual({ city: 'Aiea', state: 'HI' });
    expect(resolveNavyPlace('ML: NNSY')).toEqual({ city: 'Portsmouth', state: 'VA' });
  });
});

describe('every entry must resolve to a REAL city, not a centroid', () => {
  it('uses the nearest gazetteer-known city when the base name is absent', () => {
    // A silent centroid fallback is the dangerous case: the pin still appears
    // and still carries the right label, so it LOOKS correct while sitting in
    // the wrong place. Sigonella rendered at 42.8N (central Italy) instead of
    // Sicily, and Souda Bay on mainland Greece instead of Crete.
    expect(resolveNavyPlace('E: SIGONELLA')).toEqual({ city: 'Catania', country: 'ITA' });
    expect(resolveNavyPlace('E: SOUDA BAY')).toEqual({ city: 'Chania', country: 'GRC' });
    expect(resolveNavyPlace('POINT MUGU NAWC')).toEqual({ city: 'Port Hueneme', state: 'CA' });
  });
});

describe('OCONUS must stay OCONUS', () => {
  it('resolves foreign bases to their real country', () => {
    // Mapping a foreign base to its US parent command would put Navy work in
    // the wrong hemisphere. Verified against the geocoder: all 12 foreign
    // values land outside the CONUS bounding box.
    expect(resolveNavyPlace('FE: SASEBO')).toEqual({ city: 'Sasebo', country: 'JPN' });
    expect(resolveNavyPlace('E: BAHRAIN')).toEqual({ city: 'Manama', country: 'BHR' });
    expect(resolveNavyPlace('SE: NSGB')).toEqual({ country: 'CUB' });
  });

  it('handles a TRUNCATED foreign name as published', () => {
    // The source ships "DIEGO GARC", cut mid-word.
    expect(resolveNavyPlace('FE: DIEGO GARC')).toEqual({ country: 'IOT' });
  });

  it('reads "City, Country" without mistaking the tail for a US state', () => {
    expect(resolveNavyPlace('Okinawa, Japan')).toEqual({ city: 'Okinawa', country: 'JPN' });
    expect(resolveNavyPlace('Iwakuni, Japan')).toEqual({ city: 'Iwakuni', country: 'JPN' });
  });
});

describe('"City, ST" with a command appended', () => {
  it('keeps the place and drops the command', () => {
    expect(resolveNavyPlace('Philadelphia, PA (NSWC)')).toEqual({ city: 'Philadelphia', state: 'PA' });
    expect(resolveNavyPlace('San Diego, CA North Island')).toEqual({ city: 'San Diego', state: 'CA' });
  });
});

describe('non-places are refused, not guessed', () => {
  it('rejects the two biggest values in the whole column', () => {
    // "TBD" is 1,810 rows and "VENDOR'S FACILITY" is 1,607 — together 68% of
    // the unmapped Navy rows. Neither is a location.
    expect(isNavyNonPlace('TBD')).toBe(true);
    expect(isNavyNonPlace("VENDOR'S FACILITY")).toBe(true);
    expect(resolveNavyPlace('TBD')).toBeUndefined();
    expect(resolveNavyPlace("VENDOR'S FACILITY")).toBeUndefined();
  });

  it('rejects percentage splits before any partial match can fire', () => {
    // "80% Government site; 20% off-site" contains no place, and the ordering
    // guarantees it never falls through to a city lookup.
    for (const s of ['80% Government site; 20% off-site', '100% Contractor Site',
                     '35%-government site, 65%-contractor site']) {
      expect(resolveNavyPlace(s), s).toBeUndefined();
    }
  });

  it('rejects the other explicit non-places', () => {
    for (const s of ['Various', 'Multiple', 'Virtual', 'Remote', 'Secret',
                     'Off Site', 'Govt site', 'N/A', 'Other', 'CONUS']) {
      expect(resolveNavyPlace(s), s).toBeUndefined();
    }
  });

  it('refuses a contract-vehicle code rather than fuzzy-matching it', () => {
    // These are the bulk of what stays unresolved (242 rows). "CON22 PDC" is a
    // vehicle, not a base — there is no honest coordinate for it, and a fuzzy
    // match to "CONCORD" would be a fabricated pin.
    for (const s of ['ML: CON22 PDC', 'SW: PDCMAR', 'L: SIOP', 'H: CONST CON', 'W: CON30']) {
      expect(resolveNavyPlace(s), s).toBeUndefined();
    }
  });

  it('refuses a multi-installation REGION', () => {
    // A region spans many bases; pinning it to one would misstate where the
    // work is. Deliberately absent from the gazetteer.
    for (const s of ['MCI West', 'MCI East', 'MCIWEST', 'EURAFCENT', 'North Capital Region']) {
      expect(resolveNavyPlace(s), s).toBeUndefined();
    }
  });

  it('refuses a NAICS code that leaked into the column', () => {
    expect(resolveNavyPlace('541611: Administrative Management and General Management Consulting Services'))
      .toBeUndefined();
  });
});

describe('bare state codes', () => {
  it('passes a real USPS code straight through', () => {
    expect(resolveNavyPlace('VA')).toEqual({ state: 'VA' });
    expect(resolveNavyPlace('DC')).toEqual({ state: 'DC' });
  });

  it('does not treat a two-letter non-state as a state', () => {
    expect(resolveNavyPlace('ZZ')).toBeUndefined();
  });
});

describe('empty input', () => {
  it('returns undefined rather than throwing', () => {
    expect(resolveNavyPlace(null)).toBeUndefined();
    expect(resolveNavyPlace(undefined)).toBeUndefined();
    expect(resolveNavyPlace('')).toBeUndefined();
  });
});
