/**
 * Ops Slack 2026-11-22: the DHS forecast sync failed on the decimal amount 2053499.2 —
 * agency_forecasts.estimated_value_min/max are BIGINT, so one fractional dollar makes Postgres reject the batch.
 * dhsParseDollarRange multiplied without rounding ("$1.9M" → 1899999.9999999998; "$2,053,499.20" → 2053499.2),
 * and six other publisher parsers had the same unrounded multiply. Every parser now returns whole dollars, and
 * normalizeForecastRow rounds any fractional value that still reaches it.
 */
import { describe, it, expect } from 'vitest';
import { dhsParseDollarRange, dhsEraRecordToParsed, dhsAllrecordsToDbRow } from './dhs-allrecords';
import { treasuryValueRange } from './treasury-forecast';
import { epaValueRange } from './epa-forecast';
import { gwValueRange } from './gateway-forecast';
import { nasaValueRange } from './nasa-forecast';
import { parseMoney } from './usace-district-parse';
import { normalizeForecastRow } from './normalize-row';

const whole = (n: number | null | undefined) => n == null || Number.isInteger(n);

describe('forecast dollar parsers return whole dollars (BIGINT columns)', () => {
  it('DHS: the exact production failure and float-noise ranges', () => {
    expect(dhsParseDollarRange('$2,053,499.20')).toEqual([2_053_499, null]);
    expect(dhsParseDollarRange('$1M - $1.9M')).toEqual([1_000_000, 1_900_000]);
    expect(dhsParseDollarRange('$2.0534992M - $5.7M')).toEqual([2_053_499, 5_700_000]);
    expect(dhsParseDollarRange('$500K - $999K')).toEqual([500_000, 999_000]);
  });

  it('DHS era JSON → db row carries integers only', () => {
    const parsed = dhsEraRecordToParsed({ apfsNumber: 'F2027076057', title: 'Singapore Pier', dollarRange: '$1M - $1.9M' })!;
    const row = dhsAllrecordsToDbRow(parsed) as { estimated_value_min: number | null; estimated_value_max: number | null };
    expect(row.estimated_value_min).toBe(1_000_000);
    expect(row.estimated_value_max).toBe(1_900_000);
  });

  it.each([
    ['treasury', treasuryValueRange],
    ['epa', epaValueRange],
    ['gateway', gwValueRange],
    ['nasa', nasaValueRange],
  ] as const)('%s: "$1.1M - $1.9M" and "$2,053,499.20" are whole', (_name, fn) => {
    const a = fn('$1.1M - $1.9M');
    expect(whole(a.min) && whole(a.max)).toBe(true);
    expect(a.max).toBe(1_900_000);
    const b = fn('$2,053,499.20');
    expect(whole(b.min) && whole(b.max)).toBe(true);
  });

  it('USACE district parseMoney', () => {
    expect(parseMoney('$1.9M')).toBe(1_900_000);
    expect(parseMoney('2053499.20')).toBe(2_053_499);
  });
});

describe('normalizeForecastRow backstop', () => {
  it('rounds a fractional value instead of letting the batch fail; never drops it', () => {
    expect(normalizeForecastRow({ estimated_value_min: 1899999.9999999998, estimated_value_max: 2053499.2 }))
      .toEqual({ estimated_value_min: 1_900_000, estimated_value_max: 2_053_499 });
  });
  it('integers are untouched (no-op patch)', () => {
    expect(normalizeForecastRow({ estimated_value_min: 1_000_000, estimated_value_max: 1_900_000 })).toEqual({});
  });
  it('still orders inverted bounds after rounding', () => {
    expect(normalizeForecastRow({ estimated_value_min: 5_000_000.4, estimated_value_max: 2_000_000.6 }))
      .toEqual({ estimated_value_min: 2_000_001, estimated_value_max: 5_000_000 });
  });
});
