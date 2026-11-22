/**
 * The official set-aside code meanings, pinned. Sources, verified 2026-11-22:
 *  - SAM.gov Get Opportunities Public API, "Set-Aside Values": https://open.gsa.gov/api/get-opportunities-public-api/
 *    SDVOSBC/SDVOSBS = SDVOSB Set-Aside / Sole Source (FAR 19.14), government-wide;
 *    VSA/VSS = "Veteran-Owned Small Business Set-Aside / Sole source (specific to Department of Veterans Affairs)".
 *  - USASpending award detail `type_set_aside_description` (read by Agent 4 on live awards):
 *    VSB = "VERY SMALL BUSINESS" (e.g. State, Interior) — NOT veteran; VSA = "VETERAN SET ASIDE";
 *    VSS = "VETERAN SOLE SOURCE"; SDVOSBC = "SERVICE DISABLED VETERAN OWNED SMALL BUSINESS SET-ASIDE";
 *    SDVOSBS = "SDVOSB SOLE SOURCE".
 * Every call site below must agree with this table: VOSB is VA-only and never includes VSB.
 */
import { describe, it, expect } from 'vitest';
import { SET_GROUPS, setAsideFilterCodes, LEGACY_SDVOSB_FILTER_CODES, setGroupKey } from './map-data';
import { SET_ASIDE_CHIP } from '@/lib/alerts/saved-search-email';
import { readFileSync } from 'fs';
import { join } from 'path';

const OFFICIAL = {
  SDVOSBC: 'SDVOSB set-aside (government-wide)', SDVOSBS: 'SDVOSB sole source (government-wide)',
  VSA: 'VOSB set-aside (VA only)', VSS: 'VOSB sole source (VA only)', VSB: 'Very Small Business (not veteran)',
} as const;

describe('official code table → every call site', () => {
  it('the map groups', () => {
    expect(setAsideFilterCodes('VOSB')).toEqual(['VSA', 'VSS']);
    expect(setAsideFilterCodes('VSB')).toEqual(['VSB']);
    expect(setAsideFilterCodes('SDVOSB_ONLY')).toEqual(['SDVOSBC', 'SDVOSBS', 'SDVOSB']);
    expect(SET_GROUPS.find((g) => g.key === 'VSB')!.label).toBe('Very Small Business');
    expect(setGroupKey('VSB')).toBe('VSB');
    expect(setGroupKey('VSA')).toBe('VOSB');
    expect(setGroupKey('SDVOSBC')).toBe('SDVOSB');
    for (const g of SET_GROUPS) if (g.key !== 'VSB') expect(g.codes).not.toContain('VSB');
  });
  it('the frozen legacy SDVOSB filter keeps its historical (mis)classification — saved filters unchanged', () => {
    expect([...LEGACY_SDVOSB_FILTER_CODES]).toEqual(['SDVOSBC', 'SDVOSBS', 'VSA', 'VSB', 'SDVOSB']);
  });
  it('alert chips: VSB never reads VOSB', () => {
    expect(SET_ASIDE_CHIP.VSB).toBe('Very Small Business');
    expect(SET_ASIDE_CHIP.VSA).toBe('VOSB (VA)');
    expect(SET_ASIDE_CHIP.VSS).toBe('VOSB (VA)');
  });
  it('eligibility pools, search intent and briefings use VSA/VSS for VOSB, never VSB', () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
    expect(read('src/lib/market/set-aside-eligibility.ts')).not.toMatch(/vosb: \['VSB'\]|'VOSB': \['VSB'\]|veteranowned: \['VSB'\]/);
    expect(read('src/lib/search/query-intent.ts')).toMatch(/vosb: \['VSA', 'VSS'\]/);
    expect(read('src/lib/briefings/pipelines/sam-gov.ts')).toMatch(/'VOSB': 'VSA'/);
  });
  it('documents the table it pins', () => {
    expect(Object.keys(OFFICIAL)).toEqual(['SDVOSBC', 'SDVOSBS', 'VSA', 'VSS', 'VSB']);
  });
});

describe('eligibility pools (behaviour)', () => {
  it('a VOSB-certified firm gets the VA VOSB pools, never Very Small Business; an SDVOSB also gets VSA/VSS (Vets First)', async () => {
    const { eligibleSetAsides } = await import('@/lib/market/set-aside-eligibility');
    const vosb = eligibleSetAsides('VOSB');
    expect(vosb).toEqual(expect.arrayContaining(['VSA', 'VSS']));
    expect(vosb).not.toContain('VSB');
    const sdvosb = eligibleSetAsides('SDVOSB');
    expect(sdvosb).toEqual(expect.arrayContaining(['SDVOSBC', 'VSA', 'VSS']));
    expect(sdvosb).not.toContain('VSB');
  });
});
