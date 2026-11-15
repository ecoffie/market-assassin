import { describe, it, expect } from 'vitest';
import { classifyOpenEvidence } from './evidence-classifier';
import { interpretCapability } from './market-interpretation';
import { demoteDuplicateVersions } from './find-opportunities';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MCP_POLICY } from '@/lib/discovery/policy';

/** RC3 ranking changes from Agent 4's v7 blind scoring of RC2. Titles are real open notices from that review. */
const CTX = { today: '2026-11-14', fiscalYear: 2027 };
const v = (q: string, row: Record<string, unknown>) =>
  classifyOpenEvidence({ title: '', description: '', ...row }, buildDiscoveryPlan({ query: q }, MCP_POLICY, CTX), interpretCapability(q), q);

describe('versions of one solicitation do not fill the list', () => {
  it('later versions move behind every first-of-family row; nothing is dropped', () => {
    const rows = [
      { id: 1, row: { solicitation_number: 'W912DY-27-R-0001', title: 'MTC-T' } },
      { id: 2, row: { solicitation_number: 'W912DY27R0001', title: 'Amendment 0001 - MTC-T' } },
      { id: 3, row: { solicitation_number: 'SPE7L4-27-U-0170', title: 'ROD,SPLASH GUARD' } },
      { id: 4, row: { solicitation_number: '', title: 'Amendment 0002 - Food Services' } },
      { id: 5, row: { solicitation_number: '', title: 'Food Services' } },
    ];
    expect(demoteDuplicateVersions(rows, (x) => x.row).map((x) => x.id)).toEqual([1, 3, 4, 2, 5]);
  });
});

describe('nurse staffing: the trade, not the word', () => {
  const Q = 'We provide nurses and medical staffing.';
  it('Q401 / nurse-staffing titles are DIRECT; a nursing course and nurse-call construction are not', () => {
    expect(v(Q, { title: 'License Practical Nurse (LPN)', psc_code: 'Q401' }).cls).toBe('DIRECT_MATCH');
    expect(v(Q, { title: 'FY27 Nursing Practice Oversight Course (NPOC)', psc_code: 'W099' }).cls).not.toBe('DIRECT_MATCH');
    expect(v(Q, { title: 'Z1DA--FY27 NRM - VISN Base Modernize Nurse Call', psc_code: 'Z1DA' }).cls).not.toBe('DIRECT_MATCH');
    expect(interpretCapability(Q).direct.naics).not.toContain('561320'); // all temporary help: too broad to be "own"
  });
});

describe('steel buildings and roofing: the trade, not steel products', () => {
  const Q = 'We erect steel buildings and install metal roofing.';
  it('own codes and building / roofing titles are DIRECT; steel plate is not', () => {
    expect(v(Q, { title: 'Fenn Ranger Station roofing replacement', naics_code: '238160' }).cls).toBe('DIRECT_MATCH');
    expect(v(Q, { title: 'Prefabricated steel sheds', naics_code: '332311' }).cls).toBe('DIRECT_MATCH');
    expect(v(Q, { title: '95--STEEL PLATE', psc_code: '9515' }).cls).not.toBe('DIRECT_MATCH');
  });
});
