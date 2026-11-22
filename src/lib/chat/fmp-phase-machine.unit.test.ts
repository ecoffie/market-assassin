import { describe, expect, it } from 'vitest';
import {
  applyFmpToolResults,
  earliestIncompleteFmpPhase,
  filterToolsForFmpPhase,
  fmpForceTool,
  fmpPhaseHostNote,
  fmpReadyForAnswer,
  fmpToolAllowedInPhase,
  initialFmpPhaseState,
  markFmpBudgetExhausted,
  markFmpWriteupSkippedNoDocTool,
  unlockedFmpPhases,
} from './fmp-phase-machine';
import { RBA_FEDERAL_MARKET_PROFILE_PROMPT } from './__fixtures__/rba-federal-market-profile';

function def(name: string) {
  return { type: 'function' as const, function: { name, description: name, parameters: { type: 'object' } } };
}

describe('FMP phase machine', () => {
  it('starts locked on awards (identity open) with market target = 3 states', () => {
    const s = initialFmpPhaseState(RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    expect(s.marketReportTarget).toBe(3);
    expect(earliestIncompleteFmpPhase(s)).toBe('identity');
    expect(unlockedFmpPhases(s)).toEqual(['identity']);
    // Awards tools still allowed before identity completes (parallel gather).
    expect(fmpToolAllowedInPhase('get_contractor_award_history', s)).toBe(true);
    expect(fmpToolAllowedInPhase('generate_market_report', s)).toBe(false);
    expect(fmpToolAllowedInPhase('search_web', s)).toBe(false);
  });

  it('forces award history while awards incomplete', () => {
    const s = initialFmpPhaseState(RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    const offered = new Set(['get_contractor_award_history', 'find_opportunities', 'search_web']);
    expect(fmpForceTool(s, offered)).toBe('get_contractor_award_history');
  });

  it('unlocks pathways only after award history succeeds — not after profile alone', () => {
    let s = initialFmpPhaseState(RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    s = applyFmpToolResults(s, [{ tool: 'get_contractor_profile', status: 'success' }]);
    expect(s.completed.has('awards')).toBe(false);
    expect(fmpToolAllowedInPhase('find_opportunities', s)).toBe(false);

    s = applyFmpToolResults(s, [{ tool: 'get_contractor_award_history', status: 'success' }]);
    expect(s.completed.has('awards')).toBe(true);
    expect(s.completed.has('identity')).toBe(true);
    expect(earliestIncompleteFmpPhase(s)).toBe('pathways');
    expect(fmpToolAllowedInPhase('find_opportunities', s)).toBe(true);
    expect(fmpToolAllowedInPhase('generate_market_report', s)).toBe(false);
  });

  it('requires market_report target before contacts; keeps market_size unlocked mid-progress', () => {
    let s = initialFmpPhaseState(RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    s = applyFmpToolResults(s, [
      { tool: 'get_contractor_award_history', status: 'success' },
      { tool: 'find_opportunities', status: 'success' },
      { tool: 'search_past_contracts', status: 'success' },
    ]);
    expect(earliestIncompleteFmpPhase(s)).toBe('market_size');
    expect(fmpForceTool(s, new Set(['generate_market_report']))).toBe('generate_market_report');

    s = applyFmpToolResults(s, [{ tool: 'generate_market_report', status: 'success' }]);
    expect(s.marketReportCount).toBe(1);
    expect(s.completed.has('market_size')).toBe(false);
    expect(earliestIncompleteFmpPhase(s)).toBe('market_size');
    expect(unlockedFmpPhases(s)).toContain('market_size');
    expect(fmpToolAllowedInPhase('get_legislation_status', s)).toBe(false);

    s = applyFmpToolResults(s, [
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
    ]);
    expect(s.marketReportCount).toBe(3);
    expect(s.completed.has('market_size')).toBe(true);
    expect(earliestIncompleteFmpPhase(s)).toBe('contacts');
  });

  it('credits web attempt on available=false but does NOT complete writeup until create_document', () => {
    let s = initialFmpPhaseState(RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    s = applyFmpToolResults(s, [
      { tool: 'get_contractor_award_history', status: 'success' },
      { tool: 'find_opportunities', status: 'success' },
      { tool: 'search_past_contracts', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'get_legislation_status', status: 'success' },
    ]);
    expect(earliestIncompleteFmpPhase(s)).toBe('web');
    s = applyFmpToolResults(s, [{
      tool: 'search_web',
      status: 'success',
      content: JSON.stringify({ available: false, grounded: false, count: 0 }),
    }]);
    expect(s.webAttempted).toBe(true);
    expect(s.completed.has('web')).toBe(true);
    expect(s.completed.has('writeup')).toBe(false);
    expect(earliestIncompleteFmpPhase(s)).toBe('writeup');
    expect(fmpReadyForAnswer(s)).toBe(false);
    expect(fmpForceTool(s, new Set(['create_document', 'search_web']))).toBe('create_document');
  });

  it('completes writeup on create_document ok:true; rewrite once on fmp_writeup_invalid', () => {
    let s = initialFmpPhaseState(RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    s = applyFmpToolResults(s, [
      { tool: 'get_contractor_award_history', status: 'success' },
      { tool: 'find_opportunities', status: 'success' },
      { tool: 'search_past_contracts', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'get_legislation_status', status: 'success' },
      { tool: 'search_web', status: 'success', content: JSON.stringify({ available: false }) },
    ]);
    // Executor status is success even when payload ok:false — must read body.
    s = applyFmpToolResults(s, [{
      tool: 'create_document',
      status: 'success',
      content: JSON.stringify({ ok: false, error: 'fmp_writeup_invalid', issues: ['pathways_first'] }),
    }]);
    expect(s.writeupRewriteUsed).toBe(1);
    expect(s.completed.has('writeup')).toBe(false);
    expect(fmpReadyForAnswer(s)).toBe(false);

    s = applyFmpToolResults(s, [{
      tool: 'create_document',
      status: 'success',
      content: JSON.stringify({ ok: true, saved_to: 'vault' }),
    }]);
    expect(s.completed.has('writeup')).toBe(true);
    expect(fmpReadyForAnswer(s)).toBe(true);
  });

  it('vault-on default: rewrite exhaust does NOT unlock without ok:true; invalid_document does not burn rewrite', () => {
    let s = initialFmpPhaseState(RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    s = applyFmpToolResults(s, [
      { tool: 'get_contractor_award_history', status: 'success' },
      { tool: 'find_opportunities', status: 'success' },
      { tool: 'search_past_contracts', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'get_legislation_status', status: 'success' },
      { tool: 'search_web', status: 'success', content: JSON.stringify({ available: false }) },
    ]);
    s = applyFmpToolResults(s, [{
      tool: 'create_document',
      status: 'success',
      content: JSON.stringify({ ok: false, error: 'invalid_document' }),
    }]);
    expect(s.writeupRewriteUsed).toBe(0);
    expect(s.completed.has('writeup')).toBe(false);

    const bad = {
      tool: 'create_document',
      status: 'success' as const,
      content: JSON.stringify({ ok: false, error: 'fmp_writeup_invalid' }),
    };
    s = applyFmpToolResults(s, [bad]);
    s = applyFmpToolResults(s, [bad]);
    expect(s.writeupRewriteUsed).toBe(2);
    expect(s.completed.has('writeup')).toBe(false);
    expect(fmpReadyForAnswer(s)).toBe(false);
  });

  it('legacy requireWriteupOk:false still unlocks after rewrite exhaust', () => {
    let s = initialFmpPhaseState(RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    s = applyFmpToolResults(s, [
      { tool: 'get_contractor_award_history', status: 'success' },
      { tool: 'find_opportunities', status: 'success' },
      { tool: 'search_past_contracts', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'get_legislation_status', status: 'success' },
      { tool: 'search_web', status: 'success', content: JSON.stringify({ available: false }) },
    ]);
    const bad = {
      tool: 'create_document',
      status: 'success' as const,
      content: JSON.stringify({ ok: false, error: 'fmp_writeup_invalid' }),
    };
    s = applyFmpToolResults(s, [bad], { requireWriteupOk: false });
    s = applyFmpToolResults(s, [bad], { requireWriteupOk: false });
    expect(s.writeupRewriteUsed).toBe(2);
    expect(s.completed.has('writeup')).toBe(true);
    expect(fmpReadyForAnswer(s)).toBe(true);
  });

  it('skips writeup when create_document is not offered (vault generate off)', () => {
    let s = initialFmpPhaseState(RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    s = applyFmpToolResults(s, [
      { tool: 'get_contractor_award_history', status: 'success' },
      { tool: 'find_opportunities', status: 'success' },
      { tool: 'search_past_contracts', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'get_legislation_status', status: 'success' },
      { tool: 'search_web', status: 'success', content: JSON.stringify({ available: false }) },
    ]);
    s = markFmpWriteupSkippedNoDocTool(s);
    expect(fmpReadyForAnswer(s)).toBe(true);
  });

  it('filters offered defs to unlocked phases and strips locked tools', () => {
    const s = initialFmpPhaseState(RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    const defs = [
      'get_contractor_award_history',
      'find_opportunities',
      'generate_market_report',
      'search_web',
      'draft_proposal',
    ].map(def);
    const r = filterToolsForFmpPhase(defs, s);
    expect(r.defs.map((d) => d.function.name).sort()).toEqual([
      'get_contractor_award_history',
    ].sort());
    // identity unlocked only — but awards tools allowed in parallel
    expect(r.removed).toEqual(expect.arrayContaining([
      'find_opportunities',
      'generate_market_report',
      'search_web',
      'draft_proposal',
    ]));
    expect(r.forceTool).toBe('get_contractor_award_history');
  });

  it('budget exhaustion unlocks writeup so the customer still gets an answer', () => {
    let s = initialFmpPhaseState(RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    s = applyFmpToolResults(s, [{ tool: 'get_contractor_award_history', status: 'success' }]);
    s = markFmpBudgetExhausted(s);
    expect(fmpReadyForAnswer(s)).toBe(true);
    expect(fmpPhaseHostNote(s)).toMatch(/budget exhausted/i);
  });

  it('phase note names current required phase', () => {
    const s = initialFmpPhaseState(RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    expect(fmpPhaseHostNote(s)).toMatch(/Current required phase: identity/);
  });
});
