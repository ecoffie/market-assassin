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
