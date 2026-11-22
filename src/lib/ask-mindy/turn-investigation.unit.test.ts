import { describe, expect, it } from 'vitest';
import type { CompanyProfile } from './company-profile';
import { turnAsDeepDiveRun, turnInvestigation, type TurnToolResult } from './turn-investigation';

// Synthetic fixtures only: no real company, person or customer document.
const NOW = Date.parse('2026-11-22T12:00:00Z');
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

const ok = (tool: string, value: unknown): TurnToolResult => ({ record: { tool, status: 'success', error_category: null }, content: JSON.stringify(value) });
const failed = (tool: string, category = 'timeout'): TurnToolResult => ({ record: { tool, status: 'failed', error_category: category }, content: '{"ok":false}' });

const notice = (over: Record<string, unknown> = {}) => ok('lookup_solicitation', {
  intent: 'KNOWN_ID', query: 'TEST26Q0001', next_prompt: null,
  items: [{
    title: 'Custodial services, federal building', identifiers: ['TEST26Q0001'], status: 'open', not_biddable: false,
    response_deadline: inDays(20), latest_amendment: null, deadline_conflict: false, buyer: 'General Services Administration',
    naics: '561720', psc: 'S201', contact: { name: 'Pat Example', email: 'pat.example@example.gov', phone: null }, notice_id: 'n-1', ...over,
  }],
});
const incumbent = ok('get_solicitation_incumbent', {
  incumbent: { recipientName: 'Example Incumbent Services LLC', awardId: 'TESTAWARD01', obligated: 2_400_000 },
  prior_awards: [{}], _meta: { incumbent_finding: 'identified' },
});
const documents = ok('get_solicitation_documents', { documents: [] });

const COMPANY: CompanyProfile = {
  companyName: 'Ridgeline Test Facilities LLC', naicsCodes: ['561720'], states: ['GA'], certifications: [],
  pastPerformance: { buyerAgencies: ['General Services Administration'] } as CompanyProfile['pastPerformance'],
  unknown: [],
};

describe('turnInvestigation', () => {
  it('a turn with no lookup_solicitation gets no investigation (the answer is written as today)', () => {
    expect(turnInvestigation({ results: [ok('find_opportunities', { horizons: {} })], profile: COMPANY, nowMs: NOW })).toBeNull();
    expect(turnInvestigation({ results: [], profile: COMPANY, nowMs: NOW })).toBeNull();
  });

  it('not found and ambiguous lookups get none: the lookup answer already says so', () => {
    expect(turnInvestigation({ results: [ok('lookup_solicitation', { items: [] })], profile: COMPANY, nowMs: NOW })).toBeNull();
    const two = ok('lookup_solicitation', { items: [{ identifiers: ['A1'] }, { identifiers: ['A2'] }] });
    expect(turnInvestigation({ results: [two], profile: COMPANY, nowMs: NOW })).toBeNull();
  });

  it('builds a sourced recommendation from what the turn already fetched', () => {
    const t = turnInvestigation({ results: [notice(), incumbent, documents], profile: COMPANY, extras: { setAside: 'Total Small Business' }, nowMs: NOW });
    expect(t?.investigation.verdict).toBe('PURSUE');
    expect(t?.note).toMatch(/^INVESTIGATION/);
    expect(t?.note).toContain('Example Incumbent Services LLC');
    expect(t?.note).toMatch(/only if the customer asked for a decision/);
    expect(t?.deepDive.not_checked).toEqual([]);
  });

  it('a tool not called this turn is "not called", never "not found"; the incumbent is never called absent', () => {
    const t = turnInvestigation({ results: [notice()], profile: COMPANY, nowMs: NOW })!;
    expect(t.deepDive.incumbent.finding).toBe('unavailable');
    expect(t.deepDive.not_checked).toEqual([{ step: 'documents', state: 'not_run', reason: 'not called this turn' }]);
    expect(t.investigation.missing_evidence).toContain('documents not checked (not_run: not called this turn)');
    expect(t.investigation.missing_evidence.filter((m) => /incumbent/.test(m))).toEqual([
      'incumbent: The incumbent lookup did not run, so whether there is an incumbent is unknown. Never say there is no incumbent.',
    ]);
    expect(t.investigation.risks.some((r) => r.source === 'get_solicitation_incumbent')).toBe(false);
    expect(t.investigation.confidence).not.toBe('high');
  });

  it('a failed tool is unavailable, never an empty result', () => {
    const t = turnInvestigation({ results: [notice(), failed('get_solicitation_incumbent')], profile: COMPANY, nowMs: NOW })!;
    expect(t.investigation.missing_evidence).toContain('incumbent not checked (unavailable: timeout)');
  });

  it('a failed lookup is UNDETERMINED and says it is not a "no"', () => {
    const t = turnInvestigation({ results: [failed('lookup_solicitation')], profile: COMPANY, nowMs: NOW })!;
    expect(t.investigation.verdict).toBe('UNDETERMINED');
    expect(t.note).toMatch(/not a "no"/);
  });

  it('value first: an unknown company still gets the facts, with the profile offered as the next action', () => {
    const t = turnInvestigation({ results: [notice(), incumbent, documents], profile: null, nowMs: NOW })!;
    expect(t.investigation.verdict).toBe('UNDETERMINED');
    expect(t.note).toContain('Example Incumbent Services LLC');
    expect(t.investigation.next_action).toMatch(/company profile/);
  });

  it('a retry replaces an earlier failure of the same tool', () => {
    const run = turnAsDeepDiveRun([failed('get_solicitation_incumbent'), notice(), incumbent]);
    expect(run.results.incumbent?.state).toBe('ok');
    expect(run.steps.map((s) => s.id).sort()).toEqual(['incumbent', 'notice']);
  });

  it('an ok:false body on a success status is unavailable', () => {
    const run = turnAsDeepDiveRun([ok('get_solicitation_incumbent', { ok: false, error_category: 'upstream_error' })]);
    expect(run.results.incumbent).toEqual({ state: 'unavailable', reason: 'upstream_error' });
  });
});
