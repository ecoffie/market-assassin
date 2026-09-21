/**
 * Guards EPA place-of-performance → pop_state.
 *
 * THE BUG (2026-08-01): parseEpaForecast captured the "Place of Performance"
 * column into `raw` but never mapped it to a state field, so all 50 EPA rows
 * reached the map with no location and the source sat at 0% mapped — while 27
 * of them named a real state in plain text.
 *
 * Every input below is a VERBATIM value from the 50 live EPA rows, not an
 * invented example, so the fixtures match what the portal actually publishes.
 */
import { describe, it, expect } from 'vitest';
import { epaPopState, parseEpaForecast } from './epa-forecast';

describe('epaPopState', () => {
  it('reads a bare state code', () => {
    for (const s of ['TX', 'NE', 'MI', 'DC', 'AL', 'ID', 'KS', 'MN', 'MO', 'NJ', 'NM', 'OK', 'OR'])
      expect(epaPopState(s)).toBe(s);
  });

  it('takes the FIRST state when several are listed', () => {
    // A pin has one coordinate; a midpoint between CO and NJ is neither.
    expect(epaPopState('CO; NJ')).toBe('CO');
  });

  it('finds the state alongside non-geographic text', () => {
    expect(epaPopState('DC; Nation-wide')).toBe('DC');
    expect(epaPopState('DC; Region-wide')).toBe('DC');
  });

  it('returns undefined when no state is named', () => {
    // These stay unpinned on purpose — better an absent pin than a guessed one.
    for (const s of ["Contractor's Facility", 'Region-wide', 'Nation-wide', "Contractor's Facility; Nation-wide"])
      expect(epaPopState(s)).toBeUndefined();
    expect(epaPopState(undefined)).toBeUndefined();
    expect(epaPopState('')).toBeUndefined();
  });

  it('rejects two-letter tokens that are not states', () => {
    // Validated against the USPS code set rather than a denylist: a denylist has
    // to anticipate every two-letter word EPA might write, and the first miss
    // becomes a bogus pin on a real map.
    expect(epaPopState('US')).toBeUndefined();
    expect(epaPopState('TB')).toBeUndefined();
    expect(epaPopState('QA Support Services')).toBeUndefined();
  });

  it('does not mistake a lowercase word for a code', () => {
    expect(epaPopState('various sites')).toBeUndefined();
  });
});

describe('parseEpaForecast', () => {
  const header = ['Record Number', 'Description', 'Place of Performance'];

  it('populates popState on the parsed row', () => {
    const { rows } = parseEpaForecast(header, [
      ['EPA-1', 'Analytical laboratory services', 'TX'],
      ['EPA-2', 'Region-wide technical support', 'Region-wide'],
      ['EPA-3', 'Remediation oversight', 'CO; NJ'],
    ]);
    expect(rows.map(r => r.popState)).toEqual(['TX', undefined, 'CO']);
  });

  it('still keeps the original text for the record', () => {
    // popState is derived; the source string stays intact so a bad parse is
    // auditable rather than lost.
    const { rows } = parseEpaForecast(header, [['EPA-4', 'Support services', 'DC; Nation-wide']]);
    expect(rows[0].placeOfPerformance).toBe('DC; Nation-wide');
    expect(rows[0].popState).toBe('DC');
  });
});
