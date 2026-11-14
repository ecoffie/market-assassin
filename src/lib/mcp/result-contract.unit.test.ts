import { describe, it, expect } from 'vitest';
import { annotateResultContract, deriveResultState, isVerifiedNone, schemaArgIssues } from './result-contract';

const params = {
  properties: {
    naics: { type: 'string' },
    state: { type: 'string' },
    months_window: { type: 'number' },
    likelihood: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
};

describe('schemaArgIssues', () => {
  it('reports unknown args, wrong types and enum misses; ignores null/undefined and confirm', () => {
    const issues = schemaArgIssues(
      { naics: ['561320', '561110'], city: 'Memphis', months_window: '18', likelihood: 'certain', state: null, confirm: true },
      params,
    );
    const by = Object.fromEntries(issues.map((i) => [i.arg, i.reason]));
    expect(by).toEqual({ naics: 'wrong_type', city: 'unknown_argument', months_window: 'wrong_type', likelihood: 'invalid_value' });
  });
  it('reports nothing when there is no schema (never guesses)', () => {
    expect(schemaArgIssues({ anything: 1 }, null)).toEqual([]);
  });
});

describe('deriveResultState', () => {
  it('an errored source is unavailable, never a zero', () => {
    expect(deriveResultState({ grounded: false, degraded: true, ignoredCount: 0 })).toBe('unavailable');
  });
  it('zero rows with a dropped argument is filter_not_applied, not none_found', () => {
    expect(deriveResultState({ grounded: false, degraded: false, ignoredCount: 1 })).toBe('filter_not_applied');
    expect(deriveResultState({ grounded: false, degraded: false, ignoredCount: 0 })).toBe('none_found');
  });
  it('rows with a dropped argument or an incomplete flag are partial', () => {
    expect(deriveResultState({ grounded: true, ignoredCount: 1 })).toBe('partial');
    expect(deriveResultState({ grounded: true, ignoredCount: 0, incomplete: true })).toBe('partial');
    expect(deriveResultState({ grounded: true, ignoredCount: 0 })).toBe('results');
  });
  it('does not infer anything when the tool reports neither signal', () => {
    expect(deriveResultState({ ignoredCount: 0 })).toBe('not_reported');
  });
});

describe('annotateResultContract', () => {
  it('turns the old silent zero into filter_not_applied with the dropped argument named', () => {
    // The R1 failure shape: NAICS array dropped by a typeof-string guard, query ran national/empty.
    const r = annotateResultContract({ contracts: [], _meta: { grounded: false, degraded: false, count: 0 } }, { naics: ['5613', '5611'] }, params);
    expect(r._meta).toMatchObject({ result_state: 'filter_not_applied', ignored_args: [{ arg: 'naics', reason: 'wrong_type' }] });
    expect(isVerifiedNone(r._meta)).toBe(false);
  });
  it('a verified zero stays none_found and isVerifiedNone is true', () => {
    const r = annotateResultContract({ _meta: { grounded: false, degraded: false } }, { naics: '561320' }, params);
    expect(r._meta).toMatchObject({ result_state: 'none_found', ignored_args: [] });
    expect(isVerifiedNone(r._meta)).toBe(true);
  });
  it('trusts a tool that reports it applied a coerced argument (array accepted for a string field)', () => {
    const r = annotateResultContract(
      { _meta: { grounded: true, applied_filters: { naics: ['5613', '5611'] } } },
      { naics: ['5613', '5611'] },
      params,
    );
    expect(r._meta).toMatchObject({ result_state: 'results', ignored_args: [] });
  });
  it('recognizes the pre-existing top-level applied_filters [{filter,value}] shape', () => {
    const r = annotateResultContract({ applied_filters: [{ filter: 'naics', value: '5613,5611' }], _meta: { grounded: true } }, { naics: ['5613', '5611'] }, params);
    expect(r._meta).toMatchObject({ result_state: 'results', ignored_args: [] });
  });
  it('merges tool-reported ignored args with schema findings without duplicates', () => {
    const r = annotateResultContract(
      { _meta: { grounded: true, ignored_args: [{ arg: 'state', value: 'Narnia', reason: 'invalid_value' }] } },
      { state: 'Narnia', city: 'Memphis' },
      params,
    );
    expect((r._meta as { ignored_args: Array<{ arg: string }> }).ignored_args.map((i) => i.arg)).toEqual(['state', 'city']);
    expect((r._meta as { result_state: string }).result_state).toBe('partial');
  });
  it('a tool cannot claim a verified zero while an argument was dropped', () => {
    const r = annotateResultContract({ _meta: { result_state: 'none_found', grounded: false } }, { city: 'Memphis' }, params);
    expect((r._meta as { result_state: string }).result_state).toBe('filter_not_applied');
  });
  it('keeps every existing _meta field (additive only) and leaves non-object results alone', () => {
    const r = annotateResultContract({ _meta: { grounded: true, count: 7, total: 9 } }, {}, params);
    expect(r._meta).toMatchObject({ grounded: true, count: 7, total: 9, result_state: 'results' });
    expect(annotateResultContract('text', {}, params)).toBe('text');
    expect(annotateResultContract([1, 2], {}, params)).toEqual([1, 2]);
  });
  it('adds _meta to a result that had none, marked not_reported', () => {
    const r = annotateResultContract({ balance: 5 } as Record<string, unknown>, {}, params);
    expect(r._meta).toEqual({ result_state: 'not_reported', ignored_args: [] });
  });
});
