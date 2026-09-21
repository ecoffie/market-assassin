/**
 * Guards the Gateway place-of-performance state normaliser.
 *
 * THE BUG (found 2026-08-02 by the map-coverage audit): the parser did a blind
 * `.trim().toUpperCase().slice(0, 2)` on this column, which assumes it holds
 * USPS codes. It often holds the full NAME, so the slice produced the first two
 * letters of a word and wrote ~670 rows of nonsense across DOI, GSA, DOT and
 * USDA. None of them geocode, so those rows silently lost their location.
 *
 * Every truncated fixture below is a VERBATIM pop_state value from the live
 * table, with its row count.
 */
import { describe, it, expect } from 'vitest';
import { normalizeGatewayState } from './gateway-forecast';

describe('normalizeGatewayState', () => {
  it('maps a full state NAME to its USPS code', () => {
    // These are the values that were being truncated. Row counts are live:
    //   "District of Columbia" → "DI" (344 rows across DOI/GSA/DOT)
    //   "Tennessee"            → "TE" (104)
    //   "North Carolina"       → "NO" (84)
    expect(normalizeGatewayState('District of Columbia')).toBe('DC');
    expect(normalizeGatewayState('Tennessee')).toBe('TN');
    expect(normalizeGatewayState('North Carolina')).toBe('NC');
    expect(normalizeGatewayState('South Carolina')).toBe('SC');
    expect(normalizeGatewayState('West Virginia')).toBe('WV');
    expect(normalizeGatewayState('Pennsylvania')).toBe('PA');
    expect(normalizeGatewayState('Kansas')).toBe('KS');
    expect(normalizeGatewayState('Georgia')).toBe('GA');
    expect(normalizeGatewayState('Louisiana')).toBe('LA');
  });

  it('distinguishes the pairs the truncation made AMBIGUOUS', () => {
    // This is why the damage could not be repaired in place and needed a
    // re-ingest: "NO" could be either of these, and "SO"/"WE"/"NE" the same.
    expect(normalizeGatewayState('North Carolina')).toBe('NC');
    expect(normalizeGatewayState('North Dakota')).toBe('ND');
    expect(normalizeGatewayState('South Carolina')).toBe('SC');
    expect(normalizeGatewayState('South Dakota')).toBe('SD');
    expect(normalizeGatewayState('New Mexico')).toBe('NM');
    expect(normalizeGatewayState('New York')).toBe('NY');
  });

  it('passes a real USPS code through untouched', () => {
    expect(normalizeGatewayState('VA')).toBe('VA');
    expect(normalizeGatewayState('ca')).toBe('CA');
    expect(normalizeGatewayState(' TX ')).toBe('TX');
  });

  it('handles territories', () => {
    expect(normalizeGatewayState('Puerto Rico')).toBe('PR');
    expect(normalizeGatewayState('Virgin Islands')).toBe('VI');
    expect(normalizeGatewayState('Guam')).toBe('GU');
  });

  it('reads a trailing or parenthesised code', () => {
    expect(normalizeGatewayState('Virginia (VA)')).toBe('VA');
    expect(normalizeGatewayState('Texas - TX')).toBe('TX');
  });

  it('returns undefined rather than a TRUNCATED GUESS', () => {
    // The whole point: an unrecognised value must not become its first two
    // letters. "DI" is not a state and never was.
    expect(normalizeGatewayState('Nationwide')).toBeUndefined();
    expect(normalizeGatewayState('Various')).toBeUndefined();
    expect(normalizeGatewayState('Cannot be disclosed')).toBeUndefined();
    expect(normalizeGatewayState('')).toBeUndefined();
    expect(normalizeGatewayState(undefined)).toBeUndefined();
  });

  it('rejects the truncation artifacts themselves', () => {
    // If a re-ingest ever re-reads already-damaged data, it must not launder
    // "DI" into a valid-looking state.
    for (const s of ['DI', 'TE', 'WE', 'NO', 'SO', 'KA', 'GE', 'PE', 'LO']) {
      expect(normalizeGatewayState(s), `"${s}" is a truncation, not a state`).toBeUndefined();
    }
  });

  it('does not mistake a two-letter non-state for a code', () => {
    expect(normalizeGatewayState('ZZ')).toBeUndefined();
    expect(normalizeGatewayState('XX')).toBeUndefined();
  });
});
