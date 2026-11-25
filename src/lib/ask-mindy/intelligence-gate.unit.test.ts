import { describe, it, expect, vi } from 'vitest';
import { runIntelligenceGate, intelligenceGateEnabledFor, renderDecisionAnswer } from './intelligence-gate';
import type { AnalystDecision } from './analyst';
import fixture from './__fixtures__/fl-janitorial-recompetes-2026-11-24.json';

const pass = (c: string) => ({ criterion: c, pass: true, reason: 'ok' });
const fail = (c: string) => ({ criterion: c, pass: false, reason: `${c} failed` });
const evidence = (state: 'publish' | 'measurement_failure' = 'publish') => ({
  subject: 'janitorial services', generated_for: null,
  summary: { total_market: 426e6, total_market_basis: { window: 'FY2026', state_scoped: false, requested_state: 'FL' } },
  basis: null, reconciliation: null,
  sections: {
    market_size: { topPscList: fixture.scope.pscShares }, top_agencies: [], top_agencies_total: 0,
    competition: { contractors: [], count: 0 }, recompetes: { contracts: fixture.records, count: fixture.records.length },
    forecasts: { forecasts: [], count: 0 }, contacts: null, agency_detail: null, set_aside_gap: null,
  },
  deliverable: { html: '', url: null, report_id: null },
  _meta: { grounded: true, degraded: false, sections_grounded: 4, sections_total: 7, saved: false, publication_state: state, section_status: [{ name: 'forecasts', status: 'empty', required: false }] },
}) as never;
const lookup = async (id: string) => (fixture.competition as Record<string, unknown>)[id] ? { extent_competed: (fixture.competition as any)[id].class === 'not_competed' ? 'B' : 'A', business_categories: (fixture.competition as any)[id].abilityone_holder ? ['AbilityOne Program Participant'] : [] } : null;
const passingId = 'CONT_AWD_697DCK22C00334_6920_-NONE-_-NONE-';
const decision: AnalystDecision = { headline: 'Go after West Palm Beach', ruled_out: '4 excluded', gaps: ['small-business status'], next_question: 'Are you small?',
  pursuits: [{ contract_id: passingId, title: 'FAA West Palm Beach', why: ['FL', 'SB set-aside'], barrier: 'small-business status not on file', next_move: 'Check SAM.gov now' }] };
const analyst = vi.fn(async () => ({ decision, dropped: [], usage: { input: 1, output: 1 }, model: 'm' }));
const base = { question: 'janitorial FL', reportInput: { keyword: 'janitorial services', state: 'FL' } as never, profile: null, competitionLookup: lookup };

describe('runIntelligenceGate', () => {
  it('publishes only after the evaluator passes, and the report carries the decision', async () => {
    const publish = vi.fn(async (r: any) => ({ ...r, deliverable: { html: '<x>', url: 'https://getmindy.ai/reports/abc', report_id: 'abc' } }));
    const r = await runIntelligenceGate({ ...base, deps: { findOpen: async () => null, findNationalForecasts: async () => null, findTargeted: async () => null, gather: async () => evidence(), publish, analyst, evaluate: async () => ({ pass: true, results: ['relevant', 'pursuable', 'reasoned', 'actionable', 'clear'].map(pass) as never, fix: [], usage: { input: 1, output: 1 }, model: 'e' }) } });
    expect(r.status).toBe('complete');
    expect(r.attempts).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect((publish.mock.calls[0][0] as any).decision.pursuits[0].contract_id).toBe(passingId);
    expect(r.answer).toContain('https://getmindy.ai/reports/abc');
  });

  it('retries once with the evaluator feedback, then discloses and does NOT publish', async () => {
    const publish = vi.fn();
    const a = vi.fn(async () => ({ decision, dropped: [], usage: { input: 1, output: 1 }, model: 'm' }));
    const r = await runIntelligenceGate({ ...base, deps: { findOpen: async () => null, findNationalForecasts: async () => null, findTargeted: async () => null, gather: async () => evidence(), publish, analyst: a, evaluate: async () => ({ pass: false, results: [fail('reasoned')] as never, fix: ['make the move concrete'], usage: { input: 1, output: 1 }, model: 'e' }) } });
    expect(r.status).toBe('disclosed');
    expect(r.attempts).toBe(2);
    expect(a).toHaveBeenCalledTimes(2);
    expect((a.mock.calls[1] as any)[0].question).toContain('make the move concrete');
    expect(publish).not.toHaveBeenCalled();
    expect(r.answer).toContain('I could not fully verify this answer');
  });

  it('a clarity-only failure is advisory: the evaluator still passes, so the grounded report publishes', async () => {
    const { evaluateDecision } = await import('./evaluator');
    expect(typeof evaluateDecision).toBe('function');
    const publish = vi.fn(async (x: any) => x);
    const r = await runIntelligenceGate({ ...base, deps: { findOpen: async () => null, findNationalForecasts: async () => null, findTargeted: async () => null, gather: async () => evidence(), publish, analyst, evaluate: async () => ({ pass: true, results: [pass('relevant'), pass('pursuable'), pass('reasoned'), pass('actionable'), fail('clear')] as never, fix: [], usage: { input: 1, output: 1 }, model: 'e' }) } });
    expect(r.status).toBe('complete');
    expect(r.attempts).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(r.answer).not.toContain('I could not fully verify');
  });

  it('a retry that passes publishes', async () => {
    const publish = vi.fn(async (x: any) => x);
    let n = 0;
    const r = await runIntelligenceGate({ ...base, deps: { findOpen: async () => null, findNationalForecasts: async () => null, findTargeted: async () => null, gather: async () => evidence(), publish, analyst, evaluate: async () => (++n === 1 ? { pass: false, results: [fail('clear')] as never, fix: ['lead with the decision'], usage: { input: 1, output: 1 }, model: 'e' } : { pass: true, results: [pass('clear')] as never, fix: [], usage: { input: 1, output: 1 }, model: 'e' }) } });
    expect(r.status).toBe('complete');
    expect(r.attempts).toBe(2);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('a failed market measurement says unknown, never small, and runs no model', async () => {
    const a = vi.fn();
    const r = await runIntelligenceGate({ ...base, deps: { findOpen: async () => null, findNationalForecasts: async () => null, findTargeted: async () => null, gather: async () => evidence('measurement_failure'), analyst: a as never } });
    expect(r.status).toBe('measurement_failure');
    expect(a).not.toHaveBeenCalled();
    expect(r.answer).toMatch(/not a sign the market is small/);
  });

  it('passes the pursuits software removed to the evaluator', async () => {
    const a = vi.fn(async () => ({ decision, dropped: ['notice:gone'], usage: { input: 1, output: 1 }, model: 'm' }));
    const evaluate = vi.fn(async () => ({ pass: true, results: [] as never, fix: [], usage: { input: 0, output: 0 }, model: 'e' }));
    await runIntelligenceGate({ ...base, deps: { findOpen: async () => null, findNationalForecasts: async () => null, findTargeted: async () => null, gather: async () => evidence(), publish: async (x: any) => x, analyst: a, evaluate } });
    expect((evaluate.mock.calls[0] as any)[0].dropped).toEqual(['notice:gone']);
  });

  it('record checks run on the real fixture: 3 pass', async () => {
    const r = await runIntelligenceGate({ ...base, deps: { findOpen: async () => null, findNationalForecasts: async () => null, findTargeted: async () => null, gather: async () => evidence(), publish: async (x: any) => x, analyst, evaluate: async () => ({ pass: true, results: [] as never, fix: [], usage: { input: 0, output: 0 }, model: 'e' }) } });
    expect(r.checks.filter((c) => c.verdict === 'pursue')).toHaveLength(3);
  });
});

describe('flag and rendering', () => {
  it('is off by default', () => {
    expect(intelligenceGateEnabledFor('a@b.com', {})).toBe(false);
    expect(intelligenceGateEnabledFor('a@b.com', { ASK_MINDY_INTELLIGENCE_GATE: 'true', ASK_MINDY_INTELLIGENCE_GATE_ALLOWLIST: 'a@b.com' })).toBe(true);
  });
  it('renders the decision without adding facts', () => {
    const t = renderDecisionAnswer(decision);
    expect(t.startsWith('Go after West Palm Beach')).toBe(true);
    expect(t).toContain('Next move: Check SAM.gov now');
    expect(t.trim().endsWith('Are you small?')).toBe(true);
  });
});

describe('openNoticesAsRecords', () => {
  it('collapses repeat postings of one solicitation and prefixes ids', async () => {
    const { openNoticesAsRecords } = await import('./intelligence-gate');
    const recs = openNoticesAsRecords([
      { notice_id: 'a', solicitation_number: 'FA805127R0001', title: 'AFCAP VI' },
      { notice_id: 'b', solicitation_number: 'FA805127R0001', title: 'AFCAP VI' },
      { notice_id: 'c', title: 'Cylinder rental' },
    ]);
    expect(recs.map((r) => r.contract_id)).toEqual(['notice:a', 'notice:c']);
    expect(recs.every((r) => r.kind === 'open')).toBe(true);
  });
});

describe('openNoticesAsRecords: a shared title is not a shared solicitation', () => {
  it('keeps distinct bids that share a generic title but no solicitation number', async () => {
    const { openNoticesAsRecords } = await import('./intelligence-gate');
    const recs = openNoticesAsRecords([
      { notice_id: 'a', solicitation_number: null, title: 'Janitorial Services', sub_agency: 'Dept of the Air Force', location_label: 'Eglin AFB, FL', response_deadline: '2026-12-04' },
      { notice_id: 'b', solicitation_number: null, title: 'Janitorial Services', sub_agency: 'Dept of the Navy', location_label: 'NAS Jacksonville, FL', response_deadline: '2026-12-10' },
    ]);
    expect(recs.map((r) => r.contract_id)).toEqual(['notice:a', 'notice:b']);
  });
  it('still collapses a repost whose every field agrees', async () => {
    const { openNoticesAsRecords } = await import('./intelligence-gate');
    const row = { solicitation_number: null, title: 'Janitorial Services', sub_agency: 'Dept of the Navy', location_label: 'NAS Jacksonville, FL', response_deadline: '2026-12-10', notice_type: 'Solicitation' };
    expect(openNoticesAsRecords([{ notice_id: 'a', ...row }, { notice_id: 'b', ...row }]).map((r) => r.contract_id)).toEqual(['notice:a']);
  });
  it('a title with nothing else to compare is its own solicitation', async () => {
    const { openNoticesAsRecords } = await import('./intelligence-gate');
    expect(openNoticesAsRecords([{ notice_id: 'a', title: 'Janitorial Services' }, { notice_id: 'b', title: 'Janitorial Services' }])).toHaveLength(2);
  });
});

describe('open-bid count line', () => {
  const evalPass = async () => ({ pass: true, results: [] as never, fix: [], usage: { input: 0, output: 0 }, model: 'e' });
  const item = (id: string, sol: string) => ({ notice_id: id, solicitation_number: sol, title: `Cleaning ${sol}`, sub_agency: 'Navy', location_label: 'FL' });
  it('counts repeat postings within the open search only, and reports the industry-code additions apart', async () => {
    const a = vi.fn(async () => ({ decision, dropped: [], usage: { input: 1, output: 1 }, model: 'm' }));
    const findOpen = async () => ({ horizons: { open_now: { status: 'grounded', matched_count: 3, items: [item('1', 'S1'), item('2', 'S1'), item('3', 'S2')] } } }) as never;
    const findTargeted = async () => ({ horizons: { open_now: { status: 'grounded', items: [item('4', 'S3'), item('5', 'S4')] }, coming_back: { items: [] } } }) as never;
    // A gather whose market-size names the work so the targeted industry-code search runs.
    const gather = async () => { const e = evidence() as any; e.sections.market_size = { topPscList: [], allNaics: [{ code: '561720', name: 'Janitorial Services', pct: 90 }] }; return e; };
    await runIntelligenceGate({ ...base, deps: { findOpen, findTargeted, findNationalForecasts: async () => null, gather, publish: async (x: any) => x, analyst: a, evaluate: evalPass } });
    const line = (a.mock.calls[0] as any)[0].market.openNowLine as string;
    expect(line).toContain('1 were repeat postings of the same solicitation, leaving 2 distinct bid(s)');
    expect(line).toContain('added 2 more distinct bid(s)');
  });
});

describe('open-bid count line: 5 reposts + 5 targeted additions', () => {
  it('reports the 5 repeats and the 5 additions; the old subtraction reported neither', async () => {
    const a = vi.fn(async () => ({ decision, dropped: [], usage: { input: 1, output: 1 }, model: 'm' }));
    const it6 = (id: string, sol: string) => ({ notice_id: id, solicitation_number: sol, title: `Cleaning ${sol}`, sub_agency: 'Navy', location_label: 'FL' });
    const openItems = [...[1, 2, 3, 4, 5, 6].map((n) => it6(`r${n}`, 'S1')), ...[2, 3, 4, 5].map((n) => it6(`d${n}`, `S${n}`))]; // 10 returned, 5 reposts of S1
    const findOpen = async () => ({ horizons: { open_now: { status: 'grounded', matched_count: 10, items: openItems } } }) as never;
    const findTargeted = async () => ({ horizons: { open_now: { status: 'grounded', items: [6, 7, 8, 9, 10].map((n) => it6(`t${n}`, `S${n}`)) }, coming_back: { items: [] } } }) as never;
    const gather = async () => { const e = evidence() as any; e.sections.market_size = { topPscList: [], allNaics: [{ code: '561720', name: 'Janitorial Services', pct: 90 }] }; return e; };
    await runIntelligenceGate({ ...base, deps: { findOpen, findTargeted, findNationalForecasts: async () => null, gather, publish: async (x: any) => x, analyst: a, evaluate: async () => ({ pass: true, results: [] as never, fix: [], usage: { input: 0, output: 0 }, model: 'e' }) } });
    const line = (a.mock.calls[0] as any)[0].market.openNowLine as string;
    expect(line).toContain('5 were repeat postings of the same solicitation, leaving 5 distinct bid(s)');
    expect(line).toContain('added 5 more distinct bid(s)');
  });
});

describe('a headline written for a removed pursuit is never complete', () => {
  it('fails relevance on both attempts, so the answer is disclosed and nothing is published', async () => {
    const { softwareChecks } = await import('./evaluator');
    const headlineFor2: AnalystDecision = { ...decision, headline: 'Go after West Palm Beach and the Miami contract' };
    const a = vi.fn(async () => ({ decision: headlineFor2, dropped: ['notice:miami'], usage: { input: 1, output: 1 }, model: 'm' }));
    // The real software checks; the model criteria all pass, so only the removed pursuit can fail it.
    const evaluate = async (x: any) => {
      const results = [...softwareChecks(x.decision, x.checks, x.dropped), ...['reasoned', 'actionable', 'clear'].map(pass)] as never as Array<{ criterion: string; pass: boolean; reason: string }>;
      const ok = results.every((r) => r.pass);
      return { pass: ok, results: results as never, fix: ok ? [] : results.filter((r) => !r.pass).map((r) => `${r.criterion}: ${r.reason}`), usage: { input: 0, output: 0 }, model: 'e' };
    };
    const publish = vi.fn();
    const r = await runIntelligenceGate({ ...base, deps: { findOpen: async () => null, findNationalForecasts: async () => null, findTargeted: async () => null, gather: async () => evidence(), publish, analyst: a, evaluate } });
    expect(r.status).toBe('disclosed');
    expect(r.attempts).toBe(2);
    expect((a.mock.calls[1] as any)[0].question).toMatch(/could not be verified and were removed/);
    expect(publish).not.toHaveBeenCalled();
    expect(r.answer).toContain('I could not fully verify this answer');
  });
});

describe('forecastsLine (none is never confused with not covered)', () => {
  it('unavailable coverage is unknown, not zero', async () => {
    const { forecastsLine } = await import('./intelligence-gate');
    expect(await forecastsLine({ horizon: { status: 'unavailable' }, shown: 0, state: 'FL', query: 'q', national: async () => null })).toMatch(/UNKNOWN, not zero/);
  });
  it('empty in the state widens once to a nationwide count', async () => {
    const { forecastsLine } = await import('./intelligence-gate');
    const national = vi.fn(async () => ({ horizons: { coming_soon: { status: 'grounded', matched_count: 66 } } }) as never);
    const line = await forecastsLine({ horizon: { status: 'empty' }, shown: 0, state: 'FL', query: 'janitorial services', national });
    expect(national).toHaveBeenCalledTimes(1);
    expect(line).toMatch(/none in FL; the same search nationwide finds 66/);
  });
  it('empty nationwide too says so', async () => {
    const { forecastsLine } = await import('./intelligence-gate');
    expect(await forecastsLine({ horizon: { status: 'empty' }, shown: 0, state: 'FL', query: 'q', national: async () => ({ horizons: { coming_soon: { status: 'empty' } } }) as never })).toMatch(/none nationwide either/);
  });
  it('grounded reports the count checked', async () => {
    const { forecastsLine } = await import('./intelligence-gate');
    expect(await forecastsLine({ horizon: { status: 'grounded', matched_count: 7 }, shown: 7, state: 'VA', query: 'q', national: async () => null })).toMatch(/7 agency forecast\(s\) matched in VA/);
  });
});

describe('disclosure first', () => {
  const evalWith = (failing: string[]) => async () => ({ pass: false, results: ['relevant', 'pursuable', 'reasoned', 'actionable', 'clear'].map((c) => failing.includes(c) ? { criterion: c, pass: false, reason: `${c} is not supported by the evidence.` } : pass(c)) as never, fix: ['fix it'], usage: { input: 1, output: 1 }, model: 'e' });
  const runWith = (failing: string[]) => runIntelligenceGate({ ...base, deps: { findOpen: async () => null, findNationalForecasts: async () => null, findTargeted: async () => null, gather: async () => evidence(), publish: vi.fn(), analyst, evaluate: evalWith(failing) as never } });

  it('a disclosed answer opens with the plain lead line and the unverified points, BEFORE the headline', async () => {
    const r = await runWith(['reasoned']);
    expect(r.status).toBe('disclosed');
    const lines = r.answer.split('\n');
    expect(lines[0]).toBe('I could not fully verify this answer, so treat it as a starting point, not a final recommendation:');
    expect(lines[1]).toBe('- reasoned is not supported by the evidence.');
    expect(r.answer.indexOf('Go after West Palm Beach')).toBeGreaterThan(r.answer.indexOf('- reasoned is not supported'));
  });

  it('an actionable-only failure is disclosed too, saying the next steps are not specific enough yet', async () => {
    const r = await runWith(['actionable']);
    expect(r.status).toBe('disclosed');
    const lines = r.answer.split('\n');
    expect(lines[0]).toMatch(/^I could not fully verify this answer/);
    expect(lines[1]).toBe('- The next steps below are not specific enough yet.');
    expect(r.answer).not.toContain('actionable is not supported');
  });

  it('a complete answer has no disclosure at all and still leads with the headline', async () => {
    const r = await runIntelligenceGate({ ...base, deps: { findOpen: async () => null, findNationalForecasts: async () => null, findTargeted: async () => null, gather: async () => evidence(), publish: async (x: any) => x, analyst, evaluate: async () => ({ pass: true, results: [] as never, fix: [], usage: { input: 1, output: 1 }, model: 'e' }) } });
    expect(r.status).toBe('complete');
    expect(r.answer.startsWith('Go after West Palm Beach')).toBe(true);
    expect(r.answer).not.toContain('could not fully verify');
  });

  it('rendering adds no facts: only the given points and the fixed lead line', () => {
    const t = renderDecisionAnswer(decision, { disclosed: ['A point.'] });
    expect(t.split('\n').slice(0, 3)).toEqual(['I could not fully verify this answer, so treat it as a starting point, not a final recommendation:', '- A point.', '']);
  });
});
