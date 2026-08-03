/**
 * prettyRange — forecast VALUE display normalization (Eric 2026-08-02: "some of the numbers are not
 * comma delimited"). agency_forecasts.estimated_value_range is free text; some rows are bare digit
 * strings ("3000000000") that must render readable, while already-human ranges must pass through
 * UNCHANGED. This locks both so a bare number can't regress to an unformatted wall of digits.
 */
import { describe, it, expect } from 'vitest';
import { prettyRange } from './market-report-html';

describe('prettyRange — forecast value display', () => {
  it('bare digit strings abbreviate ($ + B/M/K)', () => {
    expect(prettyRange('3000000000', null, null)).toBe('$3.0B');
    expect(prettyRange('1500000000', null, null)).toBe('$1.5B');
    expect(prettyRange('600000000', null, null)).toBe('$600.0M');
    expect(prettyRange('560000000', null, null)).toBe('$560.0M');
  });

  it('already-human ranges pass through unchanged', () => {
    for (const t of ['$3B - $3.9B', '> $250M - < $1B', '$1,000,000,000 to $1,250,000,000',
                     '$1,000,000,001 - $1,500,000,000', '$625M', 'Over $1,500,000,000']) {
      expect(prettyRange(t, null, null)).toBe(t);
    }
  });

  it('empty range falls back to the numeric value_max, abbreviated', () => {
    expect(prettyRange('', 500000000, null)).toBe('$500.0M');
    expect(prettyRange(null, 2400000000, null)).toBe('$2.4B');
    expect(prettyRange('', null, 780000)).toBe('$780K');
  });

  it('comma-formats a bare 7+ digit run left inside otherwise-human text', () => {
    // A hypothetical mixed row: keep the words, comma-format the raw number.
    expect(prettyRange('Ceiling 1500000000 total', null, null)).toBe('Ceiling 1,500,000,000 total');
  });
});
