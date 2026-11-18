import { describe, it, expect } from 'vitest';
import { buildContractorSummary, tidyAgency, federalFiscalYear, latestReportedFiscalYear, type SummaryInput } from './contractor-summary';

const base: SummaryInput = {
  name: 'Betah Associates Inc.',
  city: 'BETHESDA', state: 'MD',
  totalObligated: 129_000_000, awardCount: 412, agencyCount: 9,
  yearly: [
    { fiscal_year: 2024, total_obligated: 10_000_000 },
    { fiscal_year: 2025, total_obligated: 13_000_000 },
    { fiscal_year: 2026, total_obligated: 99_000_000 }, // ended 30 Sep 2026: still inside the reporting lag on 18 Nov
    { fiscal_year: 2027, total_obligated: 1_000_000 },  // current, partial — must be ignored
  ],
  topAgencies: [
    { awarding_agency: 'DEPARTMENT OF HEALTH AND HUMAN SERVICES', total_amount: 90e6, pct_of_total: 0.7 },
    { awarding_agency: 'DEPARTMENT OF DEFENSE', total_amount: 20e6, pct_of_total: 0.155 },
    { awarding_agency: 'DEPARTMENT OF THE TREASURY', total_amount: 5e6, pct_of_total: 0.04 },
  ],
  topNaics: [{ naics_code: '541611', naics_description: 'ADMINISTRATIVE MANAGEMENT CONSULTING', total_amount: 60e6, award_count: 120 }],
  expiring: [{ end: '2027-03-31', agency: 'DEPARTMENT OF HEALTH AND HUMAN SERVICES' }, { end: '2027-06-30', agency: null }],
  expiringLimit: 10,
  now: new Date('2026-11-18T12:00:00Z'),
};

describe('buildContractorSummary', () => {
  it('writes one sentence per available fact, all from the inputs', () => {
    const s = buildContractorSummary(base);
    expect(s[0]).toBe('Betah Associates Inc., based in Bethesda, MD, has received $129M in federal contract obligations across 412 awards from 9 agencies.');
    expect(s[1]).toBe('Its largest customer is the Department of Health and Human Services, at 70% of obligations, followed by Department of Defense (16%) and Department of the Treasury (4%).');
    expect(s[2]).toContain('NAICS 541611 (administrative management consulting): $60M across 120 awards');
    expect(s[3]).toBe('In FY2025 it received $13M, up 30% from FY2024.');
    expect(s[4]).toBe('2 of its contracts are scheduled to end soon; the next with the Department of Health and Human Services ends in March 2027.');
  });
  it('ignores fiscal years still inside the reporting lag', () => {
    expect(federalFiscalYear(new Date('2026-11-18T00:00:00Z'))).toBe(2027);
    expect(latestReportedFiscalYear(new Date('2026-11-18T00:00:00Z'))).toBe(2025);
    expect(latestReportedFiscalYear(new Date('2027-02-15T00:00:00Z'))).toBe(2026);
    const text = buildContractorSummary(base).join(' ');
    expect(text).not.toContain('FY2027');
    expect(text).not.toContain('FY2026');
  });
  it('a full expiring list reads "at least", never an exact count', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ end: `2027-0${(i % 9) + 1}-01`, agency: null }));
    expect(buildContractorSummary({ ...base, expiring: ten }).at(-1)).toMatch(/^At least 10 of its contracts/);
  });
  it('omits sentences whose data is missing or non-positive — never a 0', () => {
    const s = buildContractorSummary({
      ...base, totalObligated: null, topAgencies: [], topNaics: [], expiring: null,
      yearly: [{ fiscal_year: 2025, total_obligated: -5e6 }, { fiscal_year: 2026, total_obligated: 3e6 }],
    });
    expect(s).toEqual([]);
  });
  it('a single-agency contractor says so plainly', () => {
    const s = buildContractorSummary({ ...base, topAgencies: [{ awarding_agency: 'DEPARTMENT OF ENERGY', total_amount: 5e6, pct_of_total: 1 }] });
    expect(s[1]).toBe('All of its federal obligations come from the Department of Energy.');
  });
  it('tidyAgency leaves mixed case alone', () => {
    expect(tidyAgency('Department of the Navy')).toBe('Department of the Navy');
    expect(tidyAgency('DEPARTMENT OF THE NAVY')).toBe('Department of the Navy');
  });
});
