import { describe, it, expect } from 'vitest';
import { shortAgencyName } from './agency-short-name';

describe('shortAgencyName — forecast codes match Open/Recompete convention', () => {
  it('expands DOJ / DHS (the reported hover bug) to Justice / Homeland Security', () => {
    expect(shortAgencyName('DOJ')).toBe('Justice');
    expect(shortAgencyName('DHS')).toBe('Homeland Security');
    expect(shortAgencyName('doj')).toBe('Justice');
    expect(shortAgencyName('Dhs')).toBe('Homeland Security');
  });

  it('Open/Recompete full names still strip DEPARTMENT OF to the same short label', () => {
    expect(shortAgencyName('DEPARTMENT OF JUSTICE')).toBe('Justice');
    expect(shortAgencyName('DEPARTMENT OF HOMELAND SECURITY')).toBe('Homeland Security');
    expect(shortAgencyName('DEPARTMENT OF THE NAVY')).toBe('Navy');
    expect(shortAgencyName('JUSTICE, DEPARTMENT OF')).toBe('Justice');
  });

  it('keeps well-known acronyms ALL-CAPS (NASA not Nasa)', () => {
    expect(shortAgencyName('NASA')).toBe('NASA');
    expect(shortAgencyName('GSA')).toBe('GSA');
  });

  it('still preserves dotted U.S. acronyms', () => {
    expect(shortAgencyName('U.S. NATIONAL SCIENCE FOUNDATION')).toBe('U.S. National Science Foundation');
  });
});
