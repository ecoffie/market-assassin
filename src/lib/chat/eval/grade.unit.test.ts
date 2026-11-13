import { describe, it, expect } from 'vitest';
import { grade, extractDates, extractIds, extractAmounts, type Scenario, type ToolEvidence } from './grade';

const TODAY = new Date('2026-11-14T00:00:00Z');
const expiringEvidence: ToolEvidence[] = [{
  tool: 'get_expiring_contracts', status: 'success', args: { state: 'TN', naics: '561320', months_window: 18 },
  result_excerpt: '{"contracts":[],"vehicles":[{"orders":[{"piid":"36C24927N0097","recipient":"ALLPRO STAFFNET","end":"2027-03-31"},{"piid":"15JA4522F00000022","end":"2027-09-07"}]}]}',
}];
const R1: Scenario = {
  id: 'R1', prompt: 'expiring TN MS AR staffing', require_tool: true,
  expected_filters: { state: ['TN', 'MS', 'AR'], naics_prefix: ['5613'] },
  qualifying_records: ['36C24927N0097', '15JA4522F00000022', 'AllPro'], window_months: 18,
  required_groups: [['36C24927N0097', 'AllPro']],
};

describe('evidence-based grader', () => {
  it('fails "no contracts" while the answer lists qualifying contracts (required rule)', () => {
    const answer = 'There are no expiring contracts in Tennessee. AllPro StaffNet holds 36C24927N0097 ending March 31, 2027, which extends beyond the next 18 months.';
    const r = grade({ ...R1, expected_filters: { state: ['TN'] } }, answer, expiringEvidence, TODAY);
    expect(r.verdict).toBe('fail');
    expect(r.failures.some((f) => f.startsWith('none_claim_contradicts_records'))).toBe(true);
    expect(r.failures.some((f) => f.startsWith('none_claim_but_lists_dates_in_window'))).toBe(true);
    expect(r.failures.some((f) => f.startsWith('date_called_outside_window_but_inside'))).toBe(true);
  });

  it('fails a "none" claim when the EVIDENCE holds qualifying records even if the answer lists none', () => {
    const r = grade({ ...R1, expected_filters: undefined, required_groups: undefined }, "I couldn't find any expiring contracts.", expiringEvidence, TODAY);
    expect(r.verdict).toBe('fail');
  });

  it('fails when requested states are silently omitted (required rule)', () => {
    const answer = 'AllPro StaffNet holds 36C24927N0097 (Memphis VAMC), ending March 31, 2027.';
    const r = grade(R1, answer, expiringEvidence, TODAY);
    expect(r.failures).toEqual(expect.arrayContaining(['silently_dropped_state:MS', 'silently_dropped_state:AR']));
    expect(r.verdict).toBe('fail');
  });

  it('accepts an omission that the answer discloses', () => {
    const answer = 'AllPro StaffNet holds 36C24927N0097, ending March 31, 2027. I only searched Tennessee; Mississippi and Arkansas were not searched yet.';
    const r = grade(R1, answer, expiringEvidence, TODAY);
    expect(r.failures.filter((f) => f.startsWith('silently_dropped_state'))).toEqual([]);
    expect(r.verdict).toBe('pass');
  });

  it('fails when a requested NAICS family was not searched and not disclosed', () => {
    const r = grade({ ...R1, expected_filters: { naics_prefix: ['5613', '4931'] } }, 'AllPro holds 36C24927N0097.', expiringEvidence, TODAY);
    expect(r.failures).toContain('silently_dropped_naics:4931');
  });

  it('fails an identifier or exact amount that is not in the tool evidence (no invented records)', () => {
    const answer = 'AllPro holds 36C24927N0097 worth $1,302,252.96, and W912EQ99P9999 is next.';
    const r = grade({ ...R1, expected_filters: undefined }, answer, expiringEvidence, TODAY);
    expect(r.failures).toEqual(expect.arrayContaining(['unsupported_identifier:W912EQ99P9999', 'unsupported_amount:$1302252.96']));
  });

  it('fails an unrequested filter applied without disclosure (R10 shape)', () => {
    const ev: ToolEvidence[] = [{ tool: 'search_past_contracts', status: 'success', args: { state: 'VA', naics: '541611', limit: 1 }, result_excerpt: '{"awards":[]}' }];
    const s: Scenario = { id: 'R10', prompt: 'navy bmss', unrequested_filters: ['state'], required_groups: [['current through', 'Booz Allen']] };
    const r = grade(s, 'No award was found.', ev, TODAY);
    expect(r.failures).toContain('unrequested_filter_not_disclosed:state=VA');
  });

  it('a partial is never a pass, and partial-only gaps grade partial not fail', () => {
    const ev: ToolEvidence[] = [{ tool: 'get_sblo_contact', status: 'success', args: {}, result_excerpt: '{"uei":"NZ7CS4E6R7K6"}' }];
    const s: Scenario = { id: 'R8', prompt: 'sblo', required_groups: [['Geoff Haas', 'point of contact', 'website']], partial_if_only: [] };
    expect(grade(s, 'Check their website.', ev, TODAY).verdict).toBe('pass');
    const strict: Scenario = { id: 'R8', prompt: 'sblo', required_groups: [['Geoff Haas', 'Daniel Reed']], partial_if_only: [['Geoff Haas', 'Daniel Reed']] };
    expect(grade(strict, 'Check their website.', ev, TODAY).verdict).toBe('partial');
  });

  it('price ordering: violation fails, missing points are partial', () => {
    const ev: ToolEvidence[] = [{ tool: 'get_pricing_intel', status: 'success', args: {}, result_excerpt: '35.34 44.08 38.39 52.53' }];
    const s: Scenario = { id: 'R7', prompt: 'rates', price_order: true };
    expect(grade(s, 'Aggressive: $35.34. Competitive: $44.08. Median: $38.39.', ev, TODAY).verdict).toBe('fail');
    expect(grade(s, 'Aggressive: $35.34. Competitive: $38.00. Median: $44.08. Premium: $52.53.', ev, TODAY).verdict).toBe('pass');
    expect(grade(s, 'The competitive rate is around $44.08.', ev, TODAY).verdict).toBe('partial');
  });

  it('no tool result fails a scenario that requires evidence', () => {
    expect(grade({ id: 'R9', prompt: 'x', require_tool: true }, 'Some numbers: 40%.', [], TODAY).failures).toContain('no_tool_result');
  });

  it('extractors', () => {
    expect(extractDates('ends March 31, 2027 and 2027-09-07').map((d) => d.toISOString().slice(0, 10))).toEqual(['2027-09-07', '2027-03-31']);
    expect(extractIds('W912EQ24P0035 and 36C24927N0097 and SAM and 541611')).toEqual(['W912EQ24P0035', '36C24927N0097']);
    expect(extractAmounts('$1,302,252.96 and $1.3M and $40.29')).toEqual(['1302252.96']);
  });

  it('truncated evidence makes a missing value unverifiable (partial), never a pass or a false fail', () => {
    const ev: ToolEvidence[] = [{ tool: 'search_past_contracts', status: 'success', args: {}, result_excerpt: '{"awards":[{"awardId":"W912EQ24P0035"}', truncated: true }];
    const s: Scenario = { id: 'R3', prompt: 'x', required_groups: [['W912EQ']] };
    const r = grade(s, 'W912EQ24P0035 and W912EQ19F0026 ($116,911.79).', ev, TODAY);
    expect(r.verdict).toBe('partial');
    expect(r.partials).toEqual(expect.arrayContaining(['unverifiable_evidence_truncated:identifier:W912EQ19F0026']));
    const full = grade(s, 'W912EQ24P0035 and W912EQ19F0026 ($116,911.79).', [{ ...ev[0], truncated: false }], TODAY);
    expect(full.verdict).toBe('fail');
  });
});

