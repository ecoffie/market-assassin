/**
 * Block 6 done-test (§9 Procurement History) + the incumbent-consistency guard.
 *
 * The guard's motivating fixture is REAL: on the live DHA JOMIS notice,
 * get_solicitation_incumbent returns grounded_incumbent:true for an Army NVESD
 * award under NAICS 541712. Both that case and the synthetic VA→DoD mismatch
 * must render Degraded and must NOT be marked incumbent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => ({ impl: null as null | ((t: string, a: Record<string, unknown>) => unknown) }));

vi.mock('./mindy-client', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    callTool: vi.fn(async (tool: string, args: Record<string, unknown>) => {
      const result = calls.impl ? calls.impl(tool, args) : undefined;
      const evidence = { source: `Mindy MCP ${tool}`, retrievedAt: new Date().toISOString(), query: args };
      if (result instanceof Error) return { tool, args, evidence, error: result.message, ok: false };
      return { tool, args, evidence, result, ok: true };
    }),
  };
});

import {
  buildSection9, checkAgencyConsistency, checkNaicsConsistency, checkTitleSimilarity,
} from './section-9-history';
import { normalizeRequirement } from './normalizer';

const REQ = normalizeRequirement({
  title: 'JOMIS Joint Medical Planning, Modeling and Simulation Capabilities',
  agency: 'Defense Health Agency',
  sub_agency: 'Department of Defense',
  naics: '541512',
  psc: 'DA01',
  keyword: 'modeling and simulation',
  description: 'DHA seeks joint medical planning, modeling and simulation capabilities.',
  solicitation_number: 'DHA_JOMIS_JMP_20260813',
  notice_id: '213a2fe3a447465e8f30699c9f056ec4',
}).normalized;

const AWARDS_OK = {
  awards: [{
    awardId: 'W123', recipientName: 'ACME CORP', awardAmount: 1_000_000,
    startDate: '2022-01-01', endDate: '2025-01-01', agency: 'Department of Defense',
    subAgency: 'Defense Health Agency', naicsCode: '541512', pscCode: 'DA01',
    awardType: 'DELIVERY ORDER', usaSpendingUrl: 'https://www.usaspending.gov/award/X',
  }],
  _meta: { grounded: true, degraded: false, count: 1 },
};

/** The REAL live shape: grounded incumbent, but Army + wrong NAICS. */
const DHA_ARMY_INCUMBENT = {
  notice: { solicitation_number: 'DHA_JOMIS_JMP_20260813' },
  incumbent: {
    awardId: '0024', recipientName: 'POLARIS ALPHA ADVANCED SYSTEMS INC',
    description: 'SUPPORT TO THE NIGHT VISION AND ELECTRONIC SENSORS DIRECTORATE MODELING AND SIMULATION DIVISION',
    awardingAgency: 'Department of Defense', awardingSubAgency: 'Department of the Army',
    awardingOffice: 'W6QK ACC-APG CONT CT WASH OFC', naicsCode: '541712',
    matchConfidence: 'low', usaSpendingUrl: 'https://www.usaspending.gov/award/Y',
  },
  _meta: { grounded_notice: true, grounded_incumbent: true, degraded: false },
};

beforeEach(() => { calls.impl = null; });

describe('consistency check units', () => {
  it('REJECTS department-level agreement as evidence of a component predecessor', () => {
    const c = checkAgencyConsistency(
      { agency: 'Defense Health Agency', subAgency: 'Department of Defense' },
      { awardingAgency: 'Department of Defense', awardingSubAgency: 'Department of the Army' },
    );
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/shared department is not sufficient/);
  });

  it('accepts a genuine component match despite formatting differences', () => {
    const c = checkAgencyConsistency(
      { agency: 'Defense Health Agency' },
      { awardingAgency: 'Department of Defense', awardingSubAgency: 'DEFENSE HEALTH AGENCY (DHA)' },
    );
    expect(c.passed).toBe(true);
  });

  it('fails a DoD-requirement vs an Army award — the parent department alone is not enough', () => {
    const c = checkAgencyConsistency({ agency: 'Department of Defense' }, { awardingSubAgency: 'Department of the Army' });
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/shared department is not sufficient/);
  });

  it('does NOT blocklist a department that IS the awarding activity (VA vs VA)', () => {
    // A blocklist approach wrongly made a genuine VA requirement un-checkable.
    const c = checkAgencyConsistency(
      { agency: 'Department of Veterans Affairs' },
      { awardingAgency: 'Department of Veterans Affairs', awardingSubAgency: 'Department of Veterans Affairs' },
    );
    expect(c.passed).toBe(true);
  });

  it('NAICS: exact and same-industry-group pass; different industry fails', () => {
    expect(checkNaicsConsistency('541512', '541512').passed).toBe(true);
    expect(checkNaicsConsistency('541512', '541519').passed).toBe(true);
    expect(checkNaicsConsistency('541512', '541712').passed).toBe(false);
    expect(checkNaicsConsistency('541512', undefined).passed).toBe(false);
  });

  it('title similarity requires meaningful overlap', () => {
    expect(checkTitleSimilarity('Joint Medical Planning Modeling Simulation', 'grounds maintenance mowing').passed).toBe(false);
  });
});

describe('§9 award rows', () => {
  it('produces a sourced award-row table from a real requirement', async () => {
    calls.impl = (t) => (t === 'search_past_contracts' ? AWARDS_OK : DHA_ARMY_INCUMBENT);
    const s = await buildSection9(REQ, '541512');
    expect(s.awards).toHaveLength(1);
    expect(s.awards[0].contractNumber).toMatchObject({ state: 'value', value: 'W123' });
    expect(s.awards[0].recipient).toMatchObject({ state: 'value', value: 'ACME CORP' });
    expect(s.awards[0].usaSpendingUrl).toContain('usaspending.gov');
    expect(s.awardsFinding.state).toBe('value');
  });

  it('missing competition data is Unknown, NEVER 0 offerors', async () => {
    calls.impl = (t) => (t === 'search_past_contracts' ? AWARDS_OK : DHA_ARMY_INCUMBENT);
    const s = await buildSection9(REQ, '541512');
    expect(s.awards[0].offerors.state).toBe('unknown');
    expect(JSON.stringify(s.awards[0].offerors)).not.toContain('"value":0');
    expect(s.awards[0].procurementMethod.state).toBe('unknown');
  });

  it('a MEASURED zero offeror count is true_zero, distinct from missing', async () => {
    calls.impl = (t) => (t === 'search_past_contracts'
      ? { awards: [{ ...AWARDS_OK.awards[0], offerors: 0 }], _meta: { grounded: true, degraded: false } }
      : DHA_ARMY_INCUMBENT);
    const s = await buildSection9(REQ, '541512');
    expect(s.awards[0].offerors.state).toBe('true_zero');
  });

  it('an EMPTY grounded search is a finding; a FAILED search is Unknown — and they differ', async () => {
    calls.impl = (t) => (t === 'search_past_contracts'
      ? { awards: [], _meta: { grounded: true, degraded: false, count: 0 } }
      : DHA_ARMY_INCUMBENT);
    const empty = await buildSection9(REQ, '541512');
    expect(empty.awardsFinding.state).toBe('true_zero');
    expect((empty.awardsFinding as { label: string }).label).toMatch(/No matching award history found/);

    calls.impl = (t) => (t === 'search_past_contracts' ? new Error('ECONNRESET') : DHA_ARMY_INCUMBENT);
    const failed = await buildSection9(REQ, '541512');
    expect(failed.awardsFinding.state).toBe('unknown');
    expect(JSON.stringify(failed.awardsFinding)).toContain('ECONNRESET');
    expect(JSON.stringify(empty.awardsFinding)).not.toBe(JSON.stringify(failed.awardsFinding));
  });

  it('preserves the amount label exactly — obligated/current/ceiling are not interchanged', async () => {
    calls.impl = (t) => (t === 'search_past_contracts' ? AWARDS_OK : DHA_ARMY_INCUMBENT);
    const s = await buildSection9(REQ, '541512');
    expect(s.awards[0].amount).toMatchObject({ state: 'value' });
    const a = s.awards[0].amount as { value: { label: string } };
    expect(a.value.label).toMatch(/lifetime total/);
  });
});

describe('§9 predecessor guard', () => {
  it('the REAL DHA case renders Degraded and is NOT marked incumbent', async () => {
    calls.impl = (t) => (t === 'search_past_contracts' ? AWARDS_OK : DHA_ARMY_INCUMBENT);
    const s = await buildSection9(REQ, '541512');
    expect(s.predecessorStatus).toBe('degraded');
    expect(s.predecessor.state).toBe('degraded');
    expect((s.predecessor as { reason: string }).reason).toMatch(/no sufficiently consistent predecessor award established/);
    expect(JSON.stringify(s.predecessor)).not.toMatch(/Likely predecessor/);
  });

  it('the synthetic VA→DoD mismatch renders Degraded and is NOT marked incumbent', async () => {
    const VA_REQ = normalizeRequirement({
      title: 'Electronic Health Record Modernization Support',
      agency: 'Department of Veterans Affairs',
      naics: '541512', keyword: 'health record',
      description: 'VA requires EHR modernization support.',
      solicitation_number: 'VA-TEST-0001',
    }).normalized;
    calls.impl = (t) => (t === 'search_past_contracts' ? AWARDS_OK : {
      incumbent: {
        awardId: 'W911', recipientName: 'ARMY VENDOR LLC',
        description: 'Army tactical vehicle sustainment', awardingAgency: 'Department of Defense',
        awardingSubAgency: 'Department of the Army', naicsCode: '336992',
        matchConfidence: 'high', usaSpendingUrl: 'https://www.usaspending.gov/award/Z',
      },
      _meta: { grounded_incumbent: true, degraded: false },
    });
    const s = await buildSection9(VA_REQ, '541512');
    expect(s.predecessorStatus).toBe('degraded');
    expect((s.predecessor as { reason: string }).reason).toMatch(/does not correspond to requested/);
  });

  it('matchConfidence:"high" ALONE never authorizes the incumbent label', async () => {
    calls.impl = (t) => (t === 'search_past_contracts' ? AWARDS_OK : {
      incumbent: { ...DHA_ARMY_INCUMBENT.incumbent, matchConfidence: 'high' },
      _meta: { grounded_incumbent: true, degraded: false },
    });
    const s = await buildSection9(REQ, '541512');
    expect(s.predecessorStatus).toBe('degraded');
  });

  it('PRESERVES the rejected candidate and every check for the appendix', async () => {
    calls.impl = (t) => (t === 'search_past_contracts' ? AWARDS_OK : DHA_ARMY_INCUMBENT);
    const s = await buildSection9(REQ, '541512');
    expect(s.predecessorCandidate?.recipientName).toBe('POLARIS ALPHA ADVANCED SYSTEMS INC');
    expect(s.predecessorSource).toBe('get_solicitation_incumbent');
    const names = s.predecessorChecks.map((c) => c.name);
    expect(names).toContain('agency consistency');
    expect(names).toContain('NAICS consistency');
    expect(s.predecessorChecks.some((c) => !c.passed)).toBe(true);
  });

  it('establishes a predecessor only when EVERY consistency check passes', async () => {
    calls.impl = (t) => (t === 'search_past_contracts' ? AWARDS_OK : {
      incumbent: {
        awardId: 'DHA-0001', recipientName: 'GOOD MATCH INC',
        description: 'Joint medical planning modeling and simulation capabilities support',
        awardingAgency: 'Department of Defense', awardingSubAgency: 'Defense Health Agency',
        naicsCode: '541512', matchConfidence: 'medium',
        usaSpendingUrl: 'https://www.usaspending.gov/award/OK',
      },
      _meta: { grounded_incumbent: true, degraded: false },
    });
    const s = await buildSection9(REQ, '541512');
    expect(s.predecessorStatus).toBe('established');
    expect((s.predecessor as { value: string }).value).toMatch(/Likely predecessor/);
    // even when established it is labelled inferential, never certified
    expect((s.predecessor as { value: string }).value).toMatch(/not a certified contract lineage/);
  });

  it('applies the guard to find_predecessor_award too (no solicitation number)', async () => {
    const NO_SOL = normalizeRequirement({
      title: 'Grounds Maintenance', agency: 'Defense Health Agency', naics: '541512',
      keyword: 'grounds', description: 'Grounds maintenance services.',
    }).normalized;
    calls.impl = (t) => (t === 'search_past_contracts' ? AWARDS_OK : {
      incumbent: {
        awardId: 'A1', recipientName: 'ARMY CO', description: 'tank parts',
        awardingSubAgency: 'Department of the Army', naicsCode: '336992',
        matchConfidence: 'high', usaSpendingUrl: 'https://www.usaspending.gov/award/A1',
      },
      _meta: { grounded: true, degraded: false },
    });
    const s = await buildSection9(NO_SOL, '541512');
    expect(s.predecessorSource).toBe('find_predecessor_award');
    expect(s.predecessorStatus).toBe('degraded');
  });
});
