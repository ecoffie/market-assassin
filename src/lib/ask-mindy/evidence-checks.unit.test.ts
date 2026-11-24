import { describe, it, expect } from 'vitest';
import { checkRecord, checkRecords, statesNamedInDescription, type CandidateRecord } from './evidence-checks';
import type { CompetitionFacts } from '@/lib/opportunities/competition-facts';
import fixture from './__fixtures__/fl-janitorial-recompetes-2026-11-24.json';

const competition = new Map(Object.entries(fixture.competition as Record<string, CompetitionFacts>));
const byIncumbent = (name: RegExp) => {
  const rec = (fixture.records as CandidateRecord[]).find((r) => name.test(String(r.incumbent_name)) && true)!;
  return checkRecord(rec, fixture.scope, undefined, competition.get(rec.contract_id));
};

describe('Florida janitorial recompetes (live evidence, 2026-11-24)', () => {
  const results = checkRecords(fixture.records as CandidateRecord[], fixture.scope, undefined, competition);

  it('keeps 3 of 7 as pursuable and excludes 4, every exclusion with a reason', () => {
    expect(results.filter((r) => r.verdict === 'pursue')).toHaveLength(3);
    expect(results.filter((r) => r.verdict !== 'pursue')).toHaveLength(4);
    for (const r of results.filter((x) => x.verdict !== 'pursue')) expect(r.exclusions.length).toBeGreaterThan(0);
  });

  it('a record saying FL whose description names Gulfport, MS is a location conflict, not Florida work', () => {
    const rec = (fixture.records as CandidateRecord[]).find((r) => /GULFPORT/.test(String(r.description)))!;
    const c = checkRecord(rec, fixture.scope, undefined, competition.get(rec.contract_id));
    expect(c.verdict).toBe('out_of_scope');
    expect(c.exclusions.map((e) => e.code)).toContain('location_conflict');
  });

  it('"Washington DC campus" is DC, not Florida', () => {
    const rec = (fixture.records as CandidateRecord[]).find((r) => /WASHINGTON DC/.test(String(r.description)))!;
    expect(checkRecord(rec, fixture.scope, undefined, competition.get(rec.contract_id)).exclusions.map((e) => e.code)).toContain('location_conflict');
  });

  it('not-competed AbilityOne awards are a mandatory source', () => {
    const dc = (fixture.records as CandidateRecord[]).find((r) => /WASHINGTON DC/.test(String(r.description)))!;
    expect(checkRecord(dc, fixture.scope, undefined, competition.get(dc.contract_id)).exclusions.map((e) => e.code)).toContain('mandatory_source_abilityone');
  });

  it('an AbilityOne holder that WON A COMPETITION is a barrier, not a block', () => {
    const c = byIncumbent(/CARC/);
    expect(c.verdict).toBe('pursue');
    expect(c.barriers.map((b) => b.code)).toContain('incumbent_abilityone_competed');
  });

  it('base operations (Z1AA) and video monitoring (R699) are not janitorial work (S201)', () => {
    expect(byIncumbent(/J&J/).exclusions.map((e) => e.code)).toContain('work_mismatch');
    expect(byIncumbent(/CHENEGA/).exclusions.map((e) => e.code)).toContain('work_mismatch');
  });

  it('the FAA West Palm Beach small-business set-aside is pursuable, with eligibility to confirm and a time-critical move', () => {
    const c = byIncumbent(/DAMMEL/);
    expect(c.verdict).toBe('pursue');
    expect(c.barriers.map((b) => b.code)).toContain('set_aside_small_business_unconfirmed');
    expect(c.actions.map((a) => a.code)).toContain('capture_window_passed');
  });

  it('no positive evidence, no flag: a terse description with no named state passes location', () => {
    const c = byIncumbent(/FORTAZO/);
    expect(c.exclusions.map((e) => e.code)).not.toContain('location_conflict');
  });
});

describe('statesNamedInDescription (positive evidence only)', () => {
  it('reads a trailing city, state', () => {
    expect(statesNamedInDescription('CUSTODIAL SERVICES LOCATED IN GULFPORT, MS')).toEqual(['MS']);
    expect(statesNamedInDescription('Janitorial for the Tampa, FL office.')).toEqual(['FL']);
  });
  it('does not read English words as states', () => {
    expect(statesNamedInDescription('JANITORIAL SERVICES, IN ACCORDANCE WITH THE PWS')).toEqual([]);
    expect(statesNamedInDescription('CLEANING SERVICES, OR AS REQUIRED')).toEqual([]);
  });
  it('accepts a word-like code followed by a ZIP code', () => {
    expect(statesNamedInDescription('SERVICES AT FORT WAYNE, IN 46805')).toEqual(['IN']);
  });
  it('recognizes Washington DC', () => {
    expect(statesNamedInDescription('CUSTODIAL SERVICES FOR THE WASHINGTON DC CAMPUS')).toEqual(['DC']);
  });
  it('empty for nothing', () => {
    expect(statesNamedInDescription(null)).toEqual([]);
  });
});

describe('eligibility from the profile', () => {
  const rec: CandidateRecord = { contract_id: 'x', set_aside_type: '8(a)', psc_code: 'S201' };
  it('8(a) not held excludes', () => {
    expect(checkRecord(rec, {}, { certifications: ['WOSB'] }, undefined).exclusions.map((e) => e.code)).toEqual(['set_aside_8a_not_held']);
  });
  it('8(a) held passes', () => {
    const c = checkRecord(rec, {}, { certifications: ['8(a)'] }, undefined);
    expect(c.verdict).toBe('pursue');
    expect(c.barriers).toEqual([]);
  });
  it('8(a) unknown is a barrier, never an exclusion', () => {
    const c = checkRecord(rec, {}, undefined, undefined);
    expect(c.verdict).toBe('pursue');
    expect(c.barriers.map((b) => b.code)).toEqual(['set_aside_8a_unconfirmed']);
  });
  it('missing fields add no flags', () => {
    expect(checkRecord({ contract_id: 'y' }, { state: 'FL', pscShares: [{ code: 'S201', pct: 0.9 }] }, undefined, undefined)).toEqual({
      contract_id: 'y', verdict: 'pursue', exclusions: [], barriers: [], actions: [],
    });
  });
});

describe('work check by NAICS (forecasts carry no PSC)', () => {
  const scope = { naicsShares: [{ code: '561720', pct: 0.8 }, { code: '561210', pct: 0.14 }, { code: '812320', pct: 0.001 }] };
  it('a dry-cleaning forecast that says "janitorial" is not janitorial work', () => {
    expect(checkRecord({ contract_id: 'f', kind: 'forecast', naics_code: '812320' }, scope, undefined, undefined).exclusions.map((e) => e.code)).toEqual(['work_mismatch']);
  });
  it('a janitorial-NAICS forecast passes', () => {
    expect(checkRecord({ contract_id: 'f', kind: 'forecast', naics_code: '561720' }, scope, undefined, undefined).verdict).toBe('pursue');
  });
  it('PSC wins when both are present', () => {
    expect(checkRecord({ contract_id: 'r', psc_code: 'S201', naics_code: '812320' }, { ...scope, pscShares: [{ code: 'S201', pct: 0.9 }] }, undefined, undefined).verdict).toBe('pursue');
  });
});

describe('several requested states', () => {
  const scope = { states: ['VA', 'MD', 'DC'] };
  it('a record in any requested state is in scope', () => {
    expect(checkRecord({ contract_id: 'a', place_of_performance_state: 'MD' }, scope, undefined, undefined).verdict).toBe('pursue');
    expect(checkRecord({ contract_id: 'b', place_of_performance_state: 'DC', description: 'CUSTODIAL SERVICES FOR THE WASHINGTON DC CAMPUS' }, scope, undefined, undefined).verdict).toBe('pursue');
  });
  it('a record outside them is out of scope, and so is one whose description names another state', () => {
    expect(checkRecord({ contract_id: 'c', place_of_performance_state: 'NY' }, scope, undefined, undefined).exclusions.map((e) => e.code)).toEqual(['out_of_state']);
    expect(checkRecord({ contract_id: 'd', place_of_performance_state: 'VA', description: 'ROAD STUDY, LUSAKA ZAMBIA AND RALEIGH, NC' }, scope, undefined, undefined).exclusions.map((e) => e.code)).toEqual(['location_conflict']);
  });
});

describe('work codes come from the customer\'s words (share only as fallback)', () => {
  // Live market lists for "bridge and highway heavy civil construction" (VA, 2026-11-24): commercial building dominates.
  const psc = [
    { code: 'Y1NZ', name: 'CONSTRUCTION OF OTHER UTILITIES', pct: 0.414 },
    { code: 'Y1LB', name: 'CONSTRUCTION OF HIGHWAYS, ROADS, STREETS, BRIDGES, AND RAILWAYS', pct: 0.093 },
    { code: 'Z2AA', name: 'REPAIR OR ALTERATION OF OFFICE BUILDINGS', pct: 0.027 },
  ];
  const naics = [
    { code: '236220', name: 'COMMERCIAL AND INSTITUTIONAL BUILDING CONSTRUCTION', pct: 0.665 },
    { code: '237310', name: 'HIGHWAY, STREET, AND BRIDGE CONSTRUCTION', pct: 0.106 },
  ];
  it('distinctive words drop generic ones', async () => {
    const { distinctiveWords } = await import('./evidence-checks');
    expect(distinctiveWords('bridge and highway heavy civil construction')).toEqual(['bridge', 'highway']);
  });
  it('bridge and highway resolves to Y1LB and 237310 by name, not the 66% building code', async () => {
    const { resolveWorkCodes } = await import('./evidence-checks');
    expect(resolveWorkCodes('bridge and highway heavy civil construction', psc, naics)).toEqual({ psc: ['Y1LB'], naics: ['237310'], basis: 'name' });
  });
  it('no name match falls back to share', async () => {
    const { resolveWorkCodes } = await import('./evidence-checks');
    expect(resolveWorkCodes('quantum widgets', psc, naics)).toEqual({ psc: ['Y1NZ'], naics: ['236220', '237310'], basis: 'share' });
  });
  it('either code establishes the work: Access Road Repair is PSC Z2LB but NAICS 237310', () => {
    const scope = { workPsc: ['Y1LB'], workNaics: ['237310'] };
    expect(checkRecord({ contract_id: 'n', psc_code: 'Z2LB', naics_code: '237310' }, scope, undefined, undefined).verdict).toBe('pursue');
    expect(checkRecord({ contract_id: 'r', psc_code: 'Z2AA', naics_code: '236220' }, scope, undefined, undefined).exclusions.map((e) => e.code)).toEqual(['work_mismatch']);
  });
  it('a ship RFI the keyword search called a direct match is not bridge work', () => {
    expect(checkRecord({ contract_id: 's', kind: 'open', evidence_class: 'DIRECT_MATCH', psc_code: 'J999', naics_code: '336611' }, { workPsc: ['Y1LB'], workNaics: ['237310'] }, undefined, undefined).exclusions.map((e) => e.code)).toEqual(['work_mismatch']);
  });
});

describe('identity by UEI only, and SAM size per NAICS', () => {
  const sb: CandidateRecord = { contract_id: 'x', set_aside_type: 'SBA', naics_code: '237310', incumbent_name: 'RBA ENGINEERING INTERNATIONAL, PLLC', incumbent_uei: 'C9K6EE9JVDK7' };
  it('a UEI match says the customer holds the contract', () => {
    expect(checkRecord(sb, {}, { uei: 'c9k6ee9jvdk7' }, undefined).actions.map((a) => a.code)).toContain('customer_is_incumbent');
  });
  it('a name alone never does', () => {
    expect(checkRecord(sb, {}, { uei: 'ZZZZZZZZZZZZ' }, undefined).actions.map((a) => a.code)).not.toContain('customer_is_incumbent');
    expect(checkRecord(sb, {}, undefined, undefined).actions.map((a) => a.code)).not.toContain('customer_is_incumbent');
  });
  it('SAM small under the NAICS clears the small-business barrier', () => {
    const c = checkRecord(sb, {}, { sizeByNaics: { '237310': 'Y' } }, undefined);
    expect(c.barriers).toEqual([]);
    expect(c.verdict).toBe('pursue');
  });
  it('SAM not small under the NAICS excludes a small-business set-aside', () => {
    expect(checkRecord(sb, {}, { sizeByNaics: { '237310': 'N' } }, undefined).exclusions.map((e) => e.code)).toEqual(['set_aside_not_small']);
  });
  it('no SAM size for that NAICS stays a barrier', () => {
    expect(checkRecord(sb, {}, { sizeByNaics: { '541330': 'Y' } }, undefined).barriers.map((b) => b.code)).toEqual(['set_aside_small_business_unconfirmed']);
  });
});

describe('setAsideKind covers every live code and SAM wording', () => {
  it.each([
    ['Full & Open', null], ['SB-Total', 'sb'], ['SB-Partial', 'sb'], ['SBA', 'sb'], ['Small Business Set Aside - Total', 'sb'],
    ['8(a)', '8a'], ['8(a) Set-Aside (FAR 19.8)', '8a'], ['SDVOSB', 'sdvosb'], ['Service-Disabled Veteran-Owned Small Business (SDVOSB) Set Aside', 'sdvosb'],
    ['VOSB', 'vosb'], ['WOSB', 'wosb'], ['EDWOSB', 'edwosb'], ['Women-Owned Small Business (WOSB) Program Set-Aside', 'wosb'],
    ['HUBZone', 'hubzone'], ['HUBZone Set-Aside (FAR 19.13)', 'hubzone'], ['Indian-SB', 'indian'],
  ])('%s -> %s', async (raw, kind) => {
    const { setAsideKind } = await import('./evidence-checks');
    expect(setAsideKind(raw)).toBe(kind);
  });
  it('an SDVOSB set-aside is a barrier when unknown and an exclusion when the profile lacks it', () => {
    const r: CandidateRecord = { contract_id: 'v', set_aside_type: 'SDVOSB' };
    expect(checkRecord(r, {}, undefined, undefined).barriers.map((b) => b.code)).toEqual(['set_aside_cert_unconfirmed']);
    expect(checkRecord(r, {}, { certifications: ['WOSB'] }, undefined).exclusions.map((e) => e.code)).toEqual(['set_aside_cert_not_held']);
    expect(checkRecord(r, {}, { certifications: ['SDVOSB'] }, undefined).verdict).toBe('pursue');
  });
});

describe('confirmed mismatch excludes; uncertainty is a barrier (Eric 2026-11-24)', () => {
  it('a related-market open notice with matching work codes stays pursuable with a barrier', () => {
    const c = checkRecord({ contract_id: 'n', kind: 'open', evidence_class: 'RELATED_MARKET_CANDIDATE', psc_code: 'S201' }, { workPsc: ['S201'] }, undefined, undefined);
    expect(c.verdict).toBe('pursue');
    expect(c.barriers.map((b) => b.code)).toContain('related_market_unconfirmed');
  });
  it('a related-market notice that is confirmed different work is still excluded, for the work', () => {
    const c = checkRecord({ contract_id: 'n', kind: 'open', evidence_class: 'RELATED_MARKET_CANDIDATE', psc_code: 'S216', naics_code: '561210' }, { workPsc: ['S201'], workNaics: ['561720'] }, undefined, undefined);
    expect(c.verdict).toBe('out_of_scope');
    expect(c.exclusions.map((e) => e.code)).toEqual(['work_mismatch']);
  });
});
