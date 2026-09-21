import { describe, it, expect } from 'vitest';
import {
  isPlausibleAwardDate,
  displayAwardDate,
  filterSaneAwardDates,
  awardDateSaneOrFilter,
  AWARD_DATE_SANE_SQL,
  MIN_PLAUSIBLE_AWARD_DATE,
} from './award-date';

// Fixed "now" so these never go stale as the real clock moves.
const NOW = new Date('2026-08-07T00:00:00Z');

// The actual bad rows found in sam_opportunities on 2026-08-07. If the bounds
// are ever loosened, these are the rows that come back and poison every
// "most recent awards" list.
const REAL_BAD_ROWS = [
  { award_date: '2260-07-01', who: 'Soniat& Willow Inc', posted: '2026-07-15' },
  { award_date: '2260-05-06', who: 'EXECUTIVE LEADERSHIP GROUP, INC.', posted: '2026-05-08' },
  { award_date: '2260-04-29', who: 'Sierra7, Inc.', posted: '2026-04-29' },
  { award_date: '2029-05-29', who: 'US MARITIME SOLUTIONS INC', posted: '2026-06-01' },
  { award_date: '2005-12-23', who: 'BIOSENSE WEBSTER, INC.', posted: '2026-06-26' },
];

describe('isPlausibleAwardDate', () => {
  it.each(REAL_BAD_ROWS)('rejects $award_date ($who)', ({ award_date }) => {
    expect(isPlausibleAwardDate(award_date, NOW)).toBe(false);
  });

  it('accepts ordinary recent awards', () => {
    for (const d of ['2026-05-18', '2026-01-02', '2024-11-30', '2020-06-15']) {
      expect(isPlausibleAwardDate(d, NOW)).toBe(true);
    }
  });

  it('treats a MISSING date as fine, not as bad', () => {
    // ~1 in 6 award notices has no date. Conflating absent with wrong would
    // silently shrink every result set that applies this guard.
    expect(isPlausibleAwardDate(null, NOW)).toBe(true);
    expect(isPlausibleAwardDate(undefined, NOW)).toBe(true);
    expect(isPlausibleAwardDate('', NOW)).toBe(true);
  });

  it('rejects an unparseable string', () => {
    expect(isPlausibleAwardDate('not-a-date', NOW)).toBe(false);
  });

  it('allows up to one year ahead — real awards do get future-dated', () => {
    expect(isPlausibleAwardDate('2027-06-01', NOW)).toBe(true);   // ~10mo out
    expect(isPlausibleAwardDate('2027-08-06', NOW)).toBe(true);   // just inside
    expect(isPlausibleAwardDate('2027-08-08', NOW)).toBe(false);  // just outside
  });

  it('holds the lower bound exactly', () => {
    expect(isPlausibleAwardDate(MIN_PLAUSIBLE_AWARD_DATE, NOW)).toBe(true);
    expect(isPlausibleAwardDate('2014-12-31', NOW)).toBe(false);
  });

  it('accepts a Date object as well as a string', () => {
    expect(isPlausibleAwardDate(new Date('2026-05-18T00:00:00Z'), NOW)).toBe(true);
    expect(isPlausibleAwardDate(new Date('2260-07-01T00:00:00Z'), NOW)).toBe(false);
  });
});

describe('displayAwardDate', () => {
  it('blanks the field instead of hiding the whole award', () => {
    // The award still has a real winner and a real amount -- losing one field
    // beats losing the row.
    expect(displayAwardDate('2260-07-01', NOW)).toBeNull();
    expect(displayAwardDate('2026-05-18', NOW)).toBe('2026-05-18');
  });

  it('returns null for a missing date', () => {
    expect(displayAwardDate(null, NOW)).toBeNull();
    expect(displayAwardDate('', NOW)).toBeNull();
  });
});

describe('filterSaneAwardDates', () => {
  it('removes the 2260 rows that would top every "most recent" list', () => {
    const rows = [
      { award_date: '2260-07-01' },
      { award_date: '2026-05-18' },
      { award_date: '2005-12-23' },
      { award_date: null },
      { award_date: '2024-02-02' },
    ];
    const kept = filterSaneAwardDates(rows, NOW).map((r) => r.award_date);
    expect(kept).toEqual(['2026-05-18', null, '2024-02-02']);
  });

  it('keeps null-dated rows so result sets do not silently shrink', () => {
    const rows = [{ award_date: null }, { award_date: undefined }];
    expect(filterSaneAwardDates(rows, NOW)).toHaveLength(2);
  });
});

describe('awardDateSaneOrFilter', () => {
  it('emits a PostgREST or() clause that keeps nulls', () => {
    const f = awardDateSaneOrFilter(NOW);
    expect(f).toContain('award_date.is.null');
    expect(f).toContain(`award_date.gte.${MIN_PLAUSIBLE_AWARD_DATE}`);
    expect(f).toContain('award_date.lte.2027-08-07');
  });

  it('recomputes the ceiling from "now" rather than baking it in', () => {
    // A long-lived serverless instance would otherwise carry a stale ceiling
    // for days.
    const a = awardDateSaneOrFilter(new Date('2026-08-07T00:00:00Z'));
    const b = awardDateSaneOrFilter(new Date('2027-01-01T00:00:00Z'));
    expect(a).not.toBe(b);
    expect(b).toContain('award_date.lte.2028-01-01');
  });
});

describe('AWARD_DATE_SANE_SQL', () => {
  it('is null-safe and bounded on both ends', () => {
    expect(AWARD_DATE_SANE_SQL).toContain('award_date IS NULL');
    expect(AWARD_DATE_SANE_SQL).toContain(`DATE '${MIN_PLAUSIBLE_AWARD_DATE}'`);
    expect(AWARD_DATE_SANE_SQL).toContain("CURRENT_DATE + INTERVAL '1 year'");
  });
});
