/**
 * The gate's deadline (GATE_DEADLINE_MS, inside the route's 300 s): a slow model call never leaves the customer with
 * nothing. Past the deadline the retry is skipped and what exists is disclosed; with no decision at all the customer
 * gets the plain out-of-time answer. Never a fallback to the old path past the deadline. Fake timers drive the clock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runIntelligenceGate, GATE_DEADLINE_MS, GATE_OUT_OF_TIME_ANSWER, GATE_PROGRESS } from './intelligence-gate';
import type { AnalystDecision } from './analyst';
import fixture from './__fixtures__/fl-janitorial-recompetes-2026-11-24.json';

const evidence = () => ({
  subject: 'janitorial services', generated_for: null,
  summary: { total_market: 426e6, total_market_basis: { window: 'FY2026', state_scoped: false, requested_state: 'FL' } },
  basis: null, reconciliation: null,
  sections: {
    market_size: { topPscList: fixture.scope.pscShares }, top_agencies: [], top_agencies_total: 0,
    competition: { contractors: [], count: 0 }, recompetes: { contracts: fixture.records, count: fixture.records.length },
    forecasts: { forecasts: [], count: 0 }, contacts: null, agency_detail: null, set_aside_gap: null,
  },
  deliverable: { html: '', url: null, report_id: null },
  _meta: { grounded: true, degraded: false, sections_grounded: 4, sections_total: 7, saved: false, publication_state: 'publish', section_status: [] },
}) as never;
const passingId = 'CONT_AWD_697DCK22C00334_6920_-NONE-_-NONE-';
const decision: AnalystDecision = { headline: 'Go after West Palm Beach', ruled_out: '4 excluded', gaps: [], also_consider: [], next_question: 'Are you small?',
  pursuits: [{ contract_id: passingId, title: 'FAA West Palm Beach', why: ['FL'], barrier: null, next_move: 'Check SAM.gov now' }] };
const quickAnalyst = async () => ({ decision, dropped: [], usage: { input: 1, output: 1 }, model: 'm' });
const never = () => new Promise<never>(() => {});
const evalResult = (pass: boolean) => ({ pass, results: [{ criterion: 'reasoned', pass, reason: pass ? 'ok' : 'The answer gives no reason for the ranking.' }] as never, fix: pass ? [] : ['say why'], usage: { input: 1, output: 1 }, model: 'e' });
const base = { question: 'janitorial FL', reportInput: { keyword: 'janitorial services', state: 'FL' } as never, profile: null, competitionLookup: async () => null };
const quietDeps = { findOpen: async () => null, findNationalForecasts: async () => null, findTargeted: async () => null, gather: async () => evidence() };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-25T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

async function run(p: Promise<Awaited<ReturnType<typeof runIntelligenceGate>>>) {
  const started = Date.now();
  let out: Awaited<ReturnType<typeof runIntelligenceGate>> | undefined;
  void p.then((r) => { out = r; });
  for (let i = 0; i < 400 && !out; i++) await vi.advanceTimersByTimeAsync(1_000);
  return { out: out!, elapsed: Date.now() - started };
}

describe('gate deadline', () => {
  it('an analyst that never answers: the plain out-of-time answer inside the deadline, nothing published', async () => {
    const publish = vi.fn();
    const { out, elapsed } = await run(runIntelligenceGate({ ...base, deps: { ...quietDeps, publish, analyst: never as never, evaluate: vi.fn() as never } }));
    expect(out).toBeDefined();
    expect(elapsed).toBeLessThanOrEqual(GATE_DEADLINE_MS);
    expect(out.status).toBe('out_of_time');
    expect(out.deadlineHit).toBe(true);
    expect(out.answer).toBe(GATE_OUT_OF_TIME_ANSWER);
    expect(out.answer).not.toMatch(/small market|market is small/i);
    expect(publish).not.toHaveBeenCalled();
  });

  it('a first decision that failed review and a retry that never answers: the first decision is disclosed, inside the deadline', async () => {
    let n = 0;
    const analyst = vi.fn(() => (++n === 1 ? quickAnalyst() : never()));
    const publish = vi.fn();
    const { out, elapsed } = await run(runIntelligenceGate({ ...base, deps: { ...quietDeps, publish, analyst: analyst as never, evaluate: async () => evalResult(false) } }));
    expect(elapsed).toBeLessThanOrEqual(GATE_DEADLINE_MS);
    expect(out.status).toBe('disclosed');
    expect(out.deadlineHit).toBe(true);
    expect(out.attempts).toBe(1);
    expect(out.answer).toContain('Go after West Palm Beach');
    expect(out.answer).toContain('I could not fully verify this answer');
    expect(publish).not.toHaveBeenCalled();
  });

  it('a review that never answers: the decision is disclosed as not double-checked, never as verified', async () => {
    const publish = vi.fn();
    const { out, elapsed } = await run(runIntelligenceGate({ ...base, deps: { ...quietDeps, publish, analyst: quickAnalyst as never, evaluate: never as never } }));
    expect(elapsed).toBeLessThanOrEqual(GATE_DEADLINE_MS);
    expect(out.status).toBe('disclosed');
    expect(out.answer).toContain('I ran out of time before double-checking this recommendation.');
    expect(publish).not.toHaveBeenCalled();
  });

  it('a slow first round leaves too little time for a retry: the retry is skipped, not started', async () => {
    let n = 0;
    const analyst = vi.fn(async () => { n++; await new Promise((r) => setTimeout(r, 100_000)); return quickAnalyst(); });
    const { out, elapsed } = await run(runIntelligenceGate({ ...base, deps: { ...quietDeps, publish: vi.fn(), analyst: analyst as never, evaluate: async () => { await new Promise((r) => setTimeout(r, 50_000)); return evalResult(false); } } }));
    expect(n).toBe(1);
    expect(elapsed).toBeLessThanOrEqual(GATE_DEADLINE_MS);
    expect(out.status).toBe('disclosed');
    expect(out.deadlineHit).toBe(true);
  });

  it('a real (non-timeout) error with time left still throws, so the route can use the existing path', async () => {
    const p = runIntelligenceGate({ ...base, deps: { ...quietDeps, publish: vi.fn(), analyst: (async () => { throw new Error('400 invalid request'); }) as never, evaluate: vi.fn() as never } });
    const caught = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(String(await caught)).toContain('400 invalid request');
  });
});

describe('progress and timings', () => {
  it('sends plain progress lines in order and records per-step timings (ms and counts only)', async () => {
    const lines: string[] = [];
    const { out } = await run(runIntelligenceGate({ ...base, onProgress: (m) => lines.push(m), deps: { ...quietDeps, publish: async (x: any) => x, analyst: quickAnalyst as never, evaluate: async () => evalResult(true) } }));
    expect(out.status).toBe('complete');
    expect(lines).toEqual([GATE_PROGRESS.gather, GATE_PROGRESS.check, GATE_PROGRESS.analyst, GATE_PROGRESS.review]);
    for (const l of lines) expect(l).not.toMatch(/\b(NAICS|PSC|UEI|SAM|recompete|evaluator|analyst|gate)\b/i);
    expect(Object.keys(out.timings)).toEqual(expect.arrayContaining(['gather', 'competition', 'forecasts', 'analyst_1', 'evaluator_1', 'publish', 'total', 'records']));
    for (const v of Object.values(out.timings)) expect(typeof v).toBe('number');
    expect(out.deadlineHit).toBe(false);
  });

  it('a failing progress callback never breaks the answer', async () => {
    const { out } = await run(runIntelligenceGate({ ...base, onProgress: () => { throw new Error('stream closed'); }, deps: { ...quietDeps, publish: async (x: any) => x, analyst: quickAnalyst as never, evaluate: async () => evalResult(true) } }));
    expect(out.status).toBe('complete');
  });
});

describe('each model call carries an explicit timeout', () => {
  const fakeClient = (text: string, seen: unknown[]) => ({ messages: { create: async (_body: unknown, opts: unknown) => { seen.push(opts); return { stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } }; } } }) as never;
  it('analyst: the time the gate gives it, and no SDK retries', async () => {
    const { runAnalyst } = await import('./analyst');
    const seen: unknown[] = [];
    await runAnalyst({ question: 'q', profile: null, market: { subject: 's', sizeLine: null, topAgencies: [], topCompetitors: [], forecastsLine: 'f' }, records: [], checks: [] }, { client: fakeClient(JSON.stringify({ ...decision, pursuits: [] }), seen), timeoutMs: 42_000 });
    expect(seen[0]).toEqual({ timeout: 42_000, maxRetries: 0 });
  });
  it('evaluator: the time the gate gives it, and no SDK retries', async () => {
    const { evaluateDecision } = await import('./evaluator');
    const seen: unknown[] = [];
    const ok = { pass: true, reason: 'ok' };
    await evaluateDecision({ question: 'q', evidence: 'e', decision: { ...decision, pursuits: [] }, checks: [] }, { client: fakeClient(JSON.stringify({ reasoned: ok, actionable: ok, clear: ok, fix: [] }), seen), timeoutMs: 17_000 });
    expect(seen[0]).toEqual({ timeout: 17_000, maxRetries: 0 });
  });
});
