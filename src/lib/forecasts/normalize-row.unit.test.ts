/**
 * Guards the shared forecast-row normaliser.
 *
 * WHY IT IS SHARED: the repair ran once by hand, and the daily DHS sync put the
 * damage straight back — 146 rows regained the literal "NA" in pop_state within
 * a day and the oracle went red with mismatches nobody had introduced. A
 * one-time repair against a recurring source is a treadmill, so the INGEST now
 * applies the same rules the audit checks.
 *
 * Every fixture is a real value from agency_forecasts.
 */
import { describe, it, expect } from 'vitest';
import { normalizeForecastRow, normalizeFy, PLACEHOLDER } from './normalize-row';

describe('normalizeFy', () => {
  it('canonicalises the spellings the sources actually write', () => {
    // The query filter matches FY20xx, so a bare "2026" silently dropped those
    // rows out of every future-year search (107 of them).
    expect(normalizeFy('2026')).toBe('FY2026');
    expect(normalizeFy('FY26')).toBe('FY2026');
    expect(normalizeFy('FY2026')).toBe('FY2026');
  });

  it('returns null for a placeholder rather than a guess', () => {
    expect(normalizeFy('TBD')).toBeNull();
    expect(normalizeFy('')).toBeNull();
    expect(normalizeFy(null)).toBeNull();
  });

  it('rejects a year outside the plausible window', () => {
    expect(normalizeFy('1999')).toBeNull();
    expect(normalizeFy('FY2099')).toBeNull();
  });
});

describe('PLACEHOLDER', () => {
  it('matches the exact non-values sources write into location fields', () => {
    // DHS stores the literal "NA" in pop_state; others write "TBD"/"Multiple"
    // into pop_city. They render on a card as though they were data.
    for (const s of ['NA', 'N/A', 'TBD', 'Multiple', 'Various', 'Virtual', 'Remote', 'unknown']) {
      expect(PLACEHOLDER.test(s), `"${s}" is a placeholder`).toBe(true);
    }
  });

  it('does NOT swallow a real place that merely starts with one', () => {
    // Anchored on purpose — "Various Locations, TX" names a state we can use.
    expect(PLACEHOLDER.test('Various Locations, TX')).toBe(false);
    expect(PLACEHOLDER.test('Naples')).toBe(false);
  });
});

describe('normalizeForecastRow', () => {
  it('returns an EMPTY patch for a clean row — so callers can skip the write', () => {
    expect(normalizeForecastRow({
      naics_code: '236220', fiscal_year: 'FY2026',
      estimated_value_min: 1_000_000, estimated_value_max: 5_000_000,
      pop_state: 'VA', pop_city: 'Norfolk',
    })).toEqual({});
  });

  it('drops a NAICS that is not six digits', () => {
    // "TBD" on 509 Navy rows rendered as if it were a real classification.
    expect(normalizeForecastRow({ naics_code: 'TBD' }).naics_code).toBeNull();
    expect(normalizeForecastRow({ naics_code: '1082720' }).naics_code).toBeNull();
    expect(normalizeForecastRow({ naics_code: '54' }).naics_code).toBeNull();
  });

  it('drops an impossible value FLOOR but keeps the ceiling', () => {
    // A federal forecast floored under $1,000 is a malformed cell — usually a
    // shared-suffix range read wrong. 442 rows, one as low as $1.
    const p = normalizeForecastRow({ estimated_value_min: 1, estimated_value_max: 5_000_000 });
    expect(p.estimated_value_min).toBeNull();
    expect(p.estimated_value_max).toBeUndefined();   // untouched
  });

  it('orders an inverted range rather than storing floor > ceiling', () => {
    // No downstream filter catches an inverted range, so it would sit on a card.
    const p = normalizeForecastRow({ estimated_value_min: 250_000_000, estimated_value_max: 1_000_000 });
    expect(p.estimated_value_min).toBe(1_000_000);
    expect(p.estimated_value_max).toBe(250_000_000);
  });

  it('clears placeholder text from BOTH location fields', () => {
    // USDA writes "Cannot be disclosed" into pop_city with a null state; DHS
    // writes "NA" into pop_state. Checking one field missed the other.
    expect(normalizeForecastRow({ pop_state: 'NA' }).pop_state).toBeNull();
    expect(normalizeForecastRow({ pop_city: 'TBD' }).pop_city).toBeNull();
  });

  it('leaves a real location alone', () => {
    expect(normalizeForecastRow({ pop_state: 'GU', pop_city: 'Yigo' })).toEqual({});
  });
});
