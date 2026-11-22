/**
 * VOSB vs SDVOSB, as SAM.gov defines them (open.gsa.gov Get Opportunities API, "Set-Aside Values", verified
 * 2026-11-22): SDVOSBC/SDVOSBS = SDVOSB set-aside / sole source (FAR 19.14, government-wide);
 * VSA/VSS = Veteran-Owned Small Business set-aside / sole source "(specific to Department of Veterans Affairs)".
 * VOSB-only eligibility must never read as government-wide, and the two categories stay distinct.
 */
import { describe, it, expect } from 'vitest';
import { SET_GROUPS, setAsideFilterCodes, LEGACY_SDVOSB_FILTER_CODES } from './map-data';
import { SET_ASIDE_CHIP } from '@/lib/alerts/saved-search-email';
import { evaluateEligibility } from './company-eligibility';

describe('VOSB is labelled VA-only; SDVOSB stays distinct', () => {
  it('map group labels', () => {
    expect(SET_GROUPS.find((g) => g.key === 'VOSB')!.label).toBe('VOSB (VA only)');
    expect(SET_GROUPS.find((g) => g.key === 'SDVOSB_ONLY')!.label).toBe('SDVOSB');
    expect(setAsideFilterCodes('SDVOSB_ONLY')).toEqual(['SDVOSBC', 'SDVOSBS', 'SDVOSB']);
    expect(setAsideFilterCodes('VOSB')).toEqual(['VSA', 'VSS', 'VSB']);
  });
  it('legacy saved SDVOSB filter is unchanged (no data migration)', () => {
    expect([...LEGACY_SDVOSB_FILTER_CODES]).toEqual(['SDVOSBC', 'SDVOSBS', 'VSA', 'VSB', 'SDVOSB']);
  });
  it('alert chips: VSS no longer falls through to "Full & open"; VA codes say VA', () => {
    expect(SET_ASIDE_CHIP.VSS).toBe('VOSB (VA)');
    expect(SET_ASIDE_CHIP.VSA).toBe('VOSB (VA)');
    expect(SET_ASIDE_CHIP.SDVOSBC).toBe('SDVOSB');
  });
  it('eligibility wording for a VSA notice names the VA program', () => {
    const v = evaluateEligibility({ set_aside_code: 'VSA', set_aside_description: null, naics_code: null }, { uei: 'X', legal_name: 'Example Co' } as never);
    expect(v.reason).toMatch(/VA-only veteran-owned \(VOSB\) set-aside/);
  });
});
