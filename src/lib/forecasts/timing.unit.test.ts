import { describe, it, expect } from 'vitest';
import { fiscalYearNumber, currentFiscalYear, forecastTimingKey } from './query';

describe('fiscalYearNumber — every real format in prod', () => {
  const cases: Array<[string | null, number | null]> = [
    ['FY2026', 2026],   // 6,692 rows
    ['FY2027', 2027],   // 1,170
    ['2026', 2026],     // 90 — the one that string-sorts before "FY2026"
    ['FY28', 2028],     // 5
    ['FY26', 2026],
    ['2027', 2027],
    ['FY2040', 2040],
    ['TBD', null],      // 5 rows — must not become a year
    ['', null],
    [null, null],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => {
      expect(fiscalYearNumber(input)).toBe(expected);
    });
  }
});

describe('currentFiscalYear — federal FY starts Oct 1', () => {
  it('Sep 30 2026 is FY2026', () => {
    expect(currentFiscalYear(new Date('2026-09-30T00:00:00Z'))).toBe(2026);
  });
  it('Oct 1 2026 rolls to FY2027', () => {
    expect(currentFiscalYear(new Date('2026-10-01T00:00:00Z'))).toBe(2027);
  });
});

describe('forecastTimingKey — smaller = sooner', () => {
  const key = forecastTimingKey;

  it('FY2026 sorts before FY2027', () => {
    expect(key({ fiscal_year: 'FY2026' })).toBeLessThan(key({ fiscal_year: 'FY2027' }));
  });

  it('quarters order inside a fiscal year', () => {
    const q1 = key({ fiscal_year: 'FY2027', anticipated_quarter: 'Q1' });
    const q4 = key({ fiscal_year: 'FY2027', anticipated_quarter: 'Q4' });
    expect(q1).toBeLessThan(q4);
  });

  it('"2026" and "FY2026" land in the SAME place (the string-sort bug)', () => {
    expect(key({ fiscal_year: '2026' })).toBe(key({ fiscal_year: 'FY2026' }));
  });

  it('undated rows sort LAST, not first', () => {
    const undated = key({});
    expect(undated).toBeGreaterThan(key({ fiscal_year: 'FY2040' }));
    expect(undated).toBeGreaterThan(key({ solicitation_date: '2028-10-01' }));
  });

  it('an exact date beats a bare fiscal year for the same period', () => {
    const exact = key({ solicitation_date: '2027-01-15', fiscal_year: 'FY2027' });
    const bare = key({ fiscal_year: 'FY2027' });
    expect(exact).not.toBe(bare);
    expect(Number.isFinite(exact)).toBe(true);
  });

  it('real DHS rows order correctly against each other', () => {
    // Verbatim from agency_forecasts, source_agency='DHS'.
    const sitka = { fiscal_year: null, anticipated_quarter: 'Q1', solicitation_date: '2028-10-01' };
    const nsepc = { fiscal_year: null, anticipated_quarter: 'Q4', solicitation_date: '2027-08-01' };
    expect(key(nsepc)).toBeLessThan(key(sitka)); // 2027 before 2028
  });

  it('never returns NaN for any shape', () => {
    for (const r of [{}, { fiscal_year: 'TBD' }, { solicitation_date: 'not-a-date' }, { anticipated_quarter: 'Q9' }]) {
      expect(Number.isNaN(key(r))).toBe(false);
    }
  });
});
