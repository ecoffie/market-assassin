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
