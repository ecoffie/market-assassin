/**
 * Guards the domestic-country test in geocode().
 *
 * THE BUG (2026-08-01): the OCONUS branch tested `iso3 !== 'USA' && iso3 !== 'US'`.
 * That is correct for SAM, which writes ISO3 codes — and silently wrong for the
 * forecast portals, which spell the country out. Treasury, HHS, NASA and EPA all
 * store "United States", so every row took the FOREIGN branch, failed the
 * ISO3_TO_ISO2 lookup, and returned no coordinate. Treasury held 198 clean
 * 2-letter states and mapped 0 of 200 rows.
 *
 * The failure is invisible from the geocoder's own side: it returns "no pin",
 * which is indistinguishable from an honestly-unplaceable row. It only surfaced
 * as a whole-agency 0% after a backfill.
 */
import { describe, it, expect } from 'vitest';
import { geocode } from './map-data';

const noOffice = null;

describe('geocode() domestic-country handling', () => {
  it('places a bare state for EVERY spelling of the US the sources emit', () => {
    // SAM writes ISO3; the forecast portals write it out in full. Both are domestic.
    for (const country of ['USA', 'US', 'United States', 'UNITED STATES OF AMERICA', null]) {
      const g = geocode('', 'WV', noOffice, null, country);
      expect(g.state, `country=${country} must resolve as domestic`).toBe('WV');
      expect(g.source, `country=${country} must keep the pop state`).toBe('pop');
    }
  });

  it('still routes a genuinely foreign country away from US soil', () => {
    // The original guard exists to stop Rome/Jeddah/Vienna landing on the US
    // buying office. Loosening the domestic test must not loosen that.
    const g = geocode('Rome', null, { city: 'Washington', state: 'DC' }, null, 'ITA');
    expect(g.state).toBe('ITA');
    expect(g.source).toBe('pop');
  });

  it('gives no pin for a foreign country it cannot place, rather than a US one', () => {
    const g = geocode('', null, { city: 'Washington', state: 'DC' }, null, 'ZZZ');
    expect(g.coord).toBeNull();
    expect(g.source).toBeNull();
  });
});
