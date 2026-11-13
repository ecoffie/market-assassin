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

describe('grader holes found in independent re-review', () => {
  const base: Scenario = { id: 'X', prompt: 'x', qualifying_records: ['36C24927N0097'] };

  it.each([
    'I found 0 expiring contracts in Tennessee.',
    'The search returned nothing for that window.',
    'I did not see any qualifying contracts.',
    'None were found in the next 18 months.',
  ])('"%s" is a none-claim that contradicts the evidence', (answer) => {
    expect(grade(base, answer, expiringEvidence, TODAY).verdict).toBe('fail');
  });

  it('a none-claim against TRUNCATED evidence is unverifiable (partial), never a pass', () => {
    const ev: ToolEvidence[] = [{ tool: 'get_expiring_contracts', status: 'success', args: { state: 'TN' }, result_excerpt: '{"contracts":[],"vehicles":[', truncated: true }];
    const r = grade(base, 'There are no expiring contracts.', ev, TODAY);
    expect(r.verdict).toBe('partial');
    expect(r.partials).toContain('unverifiable_none_claim_evidence_truncated');
  });

  it('an unrequested state is not "disclosed" by a substring (VA in "available") or the agency acronym', () => {
    const ev: ToolEvidence[] = [{ tool: 'search_past_contracts', status: 'success', args: { state: 'VA' }, result_excerpt: '{}' }];
    const s: Scenario = { id: 'R10', prompt: 'x', unrequested_filters: ['state'] };
    expect(grade(s, 'No award data is available yet.', ev, TODAY).failures).toContain('unrequested_filter_not_disclosed:state=VA');
    expect(grade(s, 'I checked VA records.', ev, TODAY).failures).toContain('unrequested_filter_not_disclosed:state=VA');
    expect(grade(s, 'I limited the search to Virginia.', ev, TODAY).failures).toEqual([]);
  });

  it('a sentence that merely mentions the state with "only" is not a disclosure of a dropped filter', () => {
    const s: Scenario = { id: 'R1', prompt: 'x', expected_filters: { state: ['MS'] } };
    expect(grade(s, 'MS only has a few contracts.', expiringEvidence, TODAY).failures).toContain('silently_dropped_state:MS');
    expect(grade(s, 'I did not search Mississippi.', expiringEvidence, TODAY).failures).toEqual([]);
  });

  it('reads filters nested in filters/advanced (no false "dropped" failure)', () => {
    const ev: ToolEvidence[] = [{ tool: 'schedule_market_search', status: 'success', args: { filters: { state: ['TN'], naics: ['561320'] } }, result_excerpt: '{}' }];
    const s: Scenario = { id: 'A', prompt: 'x', expected_filters: { state: ['TN'], naics_prefix: ['5613'] } };
    expect(grade(s, 'Alert created.', ev, TODAY).failures).toEqual([]);
  });

  it('catches invented hyphenated, lowercase and UUID identifiers', () => {
    const r = grade({ id: 'B', prompt: 'x' }, 'See W912PL-24-C-0042, w912pl24c0099 and 123e4567-e89b-12d3-a456-426614174000.', expiringEvidence, TODAY);
    expect(r.failures).toEqual(expect.arrayContaining([
      'unsupported_identifier:W912PL-24-C-0042', 'unsupported_identifier:w912pl24c0099', 'unsupported_identifier:123e4567-e89b-12d3-a456-426614174000',
    ]));
    const ok = grade({ id: 'B', prompt: 'x' }, 'Order 36C24927N0097.', expiringEvidence, TODAY);
    expect(ok.failures).toEqual([]);
  });

  it('a whole-dollar amount is supported only by a money field, not by an unrelated number', () => {
    const limitOnly: ToolEvidence[] = [{ tool: 't', status: 'success', args: {}, result_excerpt: '{"limit":1000}' }];
    const money: ToolEvidence[] = [{ tool: 't', status: 'success', args: {}, result_excerpt: '{"awardAmount":1000}' }];
    expect(grade({ id: 'C', prompt: 'x' }, 'Worth $1,000.', limitOnly, TODAY).failures).toContain('unsupported_amount:$1000');
    expect(grade({ id: 'C', prompt: 'x' }, 'Worth $1,000.', money, TODAY).failures).toEqual([]);
  });
});

describe('grader cases from the second re-review', () => {
  const base: Scenario = { id: 'X', prompt: 'x', qualifying_records: ['36C24927N0097'] };

  it('catches an invented 32-hex SAM notice id, bare or in a sam.gov link', () => {
    const r = grade({ id: 'N', prompt: 'x' }, 'See https://sam.gov/opp/0a1b2c3d4e5f60718293a4b5c6d7e8f9/view and 9f8e7d6c5b4a39281706f5e4d3c2b1a0.', expiringEvidence, TODAY);
    expect(r.failures).toEqual(expect.arrayContaining([
      'unsupported_identifier:0a1b2c3d4e5f60718293a4b5c6d7e8f9', 'unsupported_identifier:9f8e7d6c5b4a39281706f5e4d3c2b1a0',
    ]));
  });

  it.each(['Nothing qualifies in that window.', 'The search came back empty for that window.'])(
    '"%s" is a none-claim', (answer) => { expect(grade(base, answer, expiringEvidence, TODAY).verdict).toBe('fail'); });

  it.each([
    'I could not confirm whether any of these contracts will be recompeted. AllPro holds 36C24927N0097.',
    'There is no incumbent listed for these contracts. AllPro holds 36C24927N0097.',
    'No set-aside applies to these opportunities. AllPro holds 36C24927N0097.',
  ])('hedge is NOT a none-claim: "%s"', (answer) => {
    expect(grade(base, answer, expiringEvidence, TODAY).failures.filter((f) => f.startsWith('none_claim'))).toEqual([]);
  });

  it('ordinary prose is not treated as an identifier', () => {
    const prose = 'FY2026-FY2027 plans, ISO-9001-2015, CMMC-L2-2025, HUBZone-2024, 541512-coded work, NAICS-541512, Q3-2026-update, B2B-2025-pilot, call 571-555-0100 on 2027-03-31 or see https://sam.gov/search.';
    expect(grade({ id: 'P', prompt: 'x' }, prose, expiringEvidence, TODAY).failures).toEqual([]);
  });

  it('a "not … look at" sentence is not a disclosure of a dropped filter', () => {
    const s: Scenario = { id: 'D', prompt: 'x', expected_filters: { state: ['MS'] } };
    expect(grade(s, 'Mississippi buyers do not look at small firms often.', expiringEvidence, TODAY).failures).toContain('silently_dropped_state:MS');
  });

  it('any state can be disclosed by full name (not limited to a short list)', () => {
    const ev: ToolEvidence[] = [{ tool: 't', status: 'success', args: { state: 'WA' }, result_excerpt: '{}' }];
    expect(grade({ id: 'W', prompt: 'x', unrequested_filters: ['state'] }, 'I narrowed the search to Washington.', ev, TODAY).failures).toEqual([]);
  });

  it('rounded amounts, digit-bearing money keys and non-JSON excerpts are supported', () => {
    const ev = (excerpt: string): ToolEvidence[] => [{ tool: 't', status: 'success', args: {}, result_excerpt: excerpt }];
    expect(grade({ id: 'A', prompt: 'x' }, 'About $1,302,253.', ev('{"awardAmount":1302252.96}'), TODAY).failures).toEqual([]);
    expect(grade({ id: 'A', prompt: 'x' }, 'FY25 obligations were $2,500,000.', ev('{"fy2025_obligations":2500000}'), TODAY).failures).toEqual([]);
    expect(grade({ id: 'A', prompt: 'x' }, 'Obligated $1,302,252.', ev('Obligated: $1,302,252'), TODAY).failures).toEqual([]);
    expect(grade({ id: 'A', prompt: 'x' }, 'Worth $9,999,999.', ev('{"awardAmount":1302252.96}'), TODAY).failures).toContain('unsupported_amount:$9999999');
  });
});

