import { describe, it, expect } from 'vitest';
import { voteOfficeIdentity, OFFICE_IDENTITY_MIN_SHARE } from './office-identity';
import { buildDirectoryRecords } from './refresh-dodaac-directory';
import { buildOfficeNameQuery } from '@/mcp/tools/buying-offices';

// The reported shape: CBP's 70B01C with a stray transaction keyed to the FTC.
const CBP = { code: '70B01C', name: 'BORDER ENFORCEMENT CONTRACTING DIVISION', agency: 'Department of Homeland Security', sub_agency: 'U.S. Customs and Border Protection' };
const FTC = { code: '70B01C', name: 'FEDERAL TRADE COMMISSION', agency: 'Federal Trade Commission', sub_agency: 'Federal Trade Commission' };

describe('voteOfficeIdentity — a code belongs to the agency most of its rows name', () => {
  it('a stray FTC row never labels a CBP office', () => {
    const id = voteOfficeIdentity([{ ...FTC, n: 3 }, { ...CBP, n: 997 }]).get('70B01C')!;
    expect(id.agency).toBe('Department of Homeland Security');
    expect(id.sub_agency).toBe('U.S. Customs and Border Protection');
    expect(id.name).toBe(CBP.name);
    expect(id.identity_basis).toBe('majority');
    expect(id.rows).toBe(1000);
  });
  it('agency and sub-agency always come from the same pair (never mixed across rows)', () => {
    const id = voteOfficeIdentity([{ ...FTC, n: 1 }, { ...CBP, n: 99 }]).get('70B01C')!;
    expect([id.agency, id.sub_agency]).toEqual([CBP.agency, CBP.sub_agency]);
  });
  it('no clear majority → agency unknown, never the minority value', () => {
    const id = voteOfficeIdentity([{ ...FTC, n: 40 }, { ...CBP, n: 60 }]).get('70B01C')!;
    expect(id.identity_basis).toBe('conflicting');
    expect(id.agency).toBeNull();
    expect(id.sub_agency).toBeNull();
    expect(id.name).toBeNull();
    expect(id.agency_share).toBe(0.6);
  });
  it('the threshold is inclusive', () => {
    const n = OFFICE_IDENTITY_MIN_SHARE * 100;
    expect(voteOfficeIdentity([{ ...CBP, n }, { ...FTC, n: 100 - n }]).get('70B01C')!.identity_basis).toBe('majority');
  });
  it('names split within one agency still vote together', () => {
    const id = voteOfficeIdentity([{ ...CBP, name: 'BECD', n: 30 }, { ...CBP, n: 60 }, { ...FTC, n: 5 }]).get('70B01C')!;
    expect(id.identity_basis).toBe('majority');
    expect(id.name).toBe(CBP.name);
  });
});

describe('every surface uses the vote', () => {
  it('the buying-offices name query groups by the full identity, no ANY_VALUE', () => {
    const q = buildOfficeNameQuery();
    expect(q).not.toMatch(/ANY_VALUE/);
    expect(q).toMatch(/GROUP BY 1, 2, 3, 4/);
  });
  it('the dodaac directory writes the voted agency and sums counts over every row', () => {
    const recs = buildDirectoryRecords([
      { dodaac: '70B01C', office_name: CBP.name, agency: CBP.agency, sub_agency: CBP.sub_agency, award_count: 997, total_obligated: 1000 },
      { dodaac: '70B01C', office_name: FTC.name, agency: FTC.agency, sub_agency: FTC.sub_agency, award_count: 3, total_obligated: 5 },
    ], '2026-11-22T00:00:00.000Z');
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ dodaac: '70B01C', agency: CBP.agency, sub_agency: CBP.sub_agency, award_count: 1000, total_obligated: 1005 });
  });
  it('a conflicting code is written with an unknown agency', () => {
    const recs = buildDirectoryRecords([
      { dodaac: '70B01C', office_name: CBP.name, agency: CBP.agency, sub_agency: CBP.sub_agency, award_count: 5, total_obligated: 1 },
      { dodaac: '70B01C', office_name: FTC.name, agency: FTC.agency, sub_agency: FTC.sub_agency, award_count: 5, total_obligated: 1 },
    ], 'x');
    expect(recs[0].agency).toBeNull();
    expect(recs[0].office_name).toBeTruthy();
  });
});
