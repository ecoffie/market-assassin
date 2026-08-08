/**
 * forecastRangeText() — the forecast value shown on the map hero + rail card + favorites.
 *
 * Bug (Eric screenshot 2026-08-08): some agency_forecasts rows store a BARE numeric string in
 * estimated_value_range ("99000000", "24,000,000") — 188 of 33,130 rows. Those were rendered as a
 * giant raw integer. Fix: format a bare number ("$99M"); pass a real published range/text
 * ("$500K - $999K", "Over $100M", "<$2M") through verbatim; empty → fall back to min/max.
 * Verified against live DB: bare-number rows match `^[0-9][0-9,.\s]*$`, real ranges all carry a
 * $, letter, or range separator.
 */
import { describe, it, expect } from 'vitest';
import { forecastRangeText } from './map-data';

describe('forecastRangeText — bare number formats, real range passes through', () => {
  it('formats a bare numeric estimated_value_range (the raw-integer bug)', () => {
    expect(forecastRangeText({ estimated_value_range: '99000000' })).toBe('$99M');
    expect(forecastRangeText({ estimated_value_range: '24000000' })).toBe('$24M');
    expect(forecastRangeText({ estimated_value_range: '500000000' })).toBe('$500M');
    expect(forecastRangeText({ estimated_value_range: '9900000' })).toBe('$9.9M');
  });

  it('formats a bare number with thousands separators', () => {
    expect(forecastRangeText({ estimated_value_range: '24,000,000' })).toBe('$24M');
  });

  it('passes a REAL published range/text through verbatim (never reformatted)', () => {
    for (const r of ['$500K - $999K', 'Over $100M', '<$2M', '$20M to $50M', '$2M - $4.9M', 'Below $150K', '> $2M - < $7.5M']) {
      expect(forecastRangeText({ estimated_value_range: r })).toBe(r);
    }
  });

  it('falls back to min/max when no range string is present', () => {
    expect(forecastRangeText({ estimated_value_min: 1_000_000, estimated_value_max: 5_000_000 })).toBe('$1M–$5M');
    expect(forecastRangeText({})).toBe('');
  });
});
