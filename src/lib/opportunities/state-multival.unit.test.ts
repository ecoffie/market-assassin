/**
 * Explicit Map state is multi-value the same way NAICS is (comma + multiVal).
 *
 * Before 2026-09-08, normalizeStateCode("NY,NJ") returned null and the filter
 * disappeared. Profile location_states[] already ORed; this makes the explicit
 * ?state= / Filters path match that loop.
 */
import { describe, it, expect } from 'vitest';
import { parseMapFilters, applyMapFilters, resolvedStateCodes, stateMatchConds } from './map-filters';

function stubQuery() {
  const calls: { method: string; arg: string }[] = [];
  const q: Record<string, (...a: unknown[]) => unknown> = {};
  const chain = (method: string) => (...a: unknown[]) => { calls.push({ method, arg: String(a[0] ?? '') }); return q; };
  for (const m of ['or', 'in', 'eq', 'gt', 'lt', 'lte', 'gte', 'not', 'neq', 'ilike', 'imatch', 'select', 'order', 'limit']) q[m] = chain(m);
  return { q, calls };
}

function get(params: Record<string, string>) {
  return (k: string) => params[k] ?? null;
}

describe('resolvedStateCodes', () => {
  it('keeps a single code and a single name', () => {
    expect(resolvedStateCodes('NJ')).toEqual(['NJ']);
    expect(resolvedStateCodes('New Jersey')).toEqual(['NJ']);
  });

  it('splits CSV instead of treating the whole string as one token', () => {
    expect(resolvedStateCodes('NY,NJ,PA,DE,CT')).toEqual(['NY', 'NJ', 'PA', 'DE', 'CT']);
  });

  it('drops junk tokens rather than guessing or matching everything', () => {
    expect(resolvedStateCodes('NY,XX,NJ')).toEqual(['NY', 'NJ']);
    expect(resolvedStateCodes('not-a-state')).toEqual([]);
  });
});

describe('explicit Map state filter', () => {
  it('a single state still emits pop OR office for that code', () => {
    const { q, calls } = stubQuery();
    applyMapFilters(q, parseMapFilters(get({ state: 'FL' })));
    const stateOr = calls.find((c) => c.method === 'or' && c.arg.includes('pop_state.eq.FL'));
    expect(stateOr).toBeTruthy();
    expect(stateOr!.arg).toBe('pop_state.eq.FL,office_address->>state.eq.FL');
  });

  it('NY,NJ is one OR of both codes — not a silent no-op', () => {
    const { q, calls } = stubQuery();
    applyMapFilters(q, parseMapFilters(get({ state: 'NY,NJ' })));
    const stateOr = calls.find((c) => c.method === 'or' && c.arg.includes('pop_state.eq.'));
    expect(stateOr, 'multi-state must emit a PostgREST .or()').toBeTruthy();
    expect(stateOr!.arg).toContain('pop_state.eq.NY');
    expect(stateOr!.arg).toContain('office_address->>state.eq.NY');
    expect(stateOr!.arg).toContain('pop_state.eq.NJ');
    expect(stateOr!.arg).toContain('office_address->>state.eq.NJ');
  });

  it('explicit multi-state replaces profileStates rather than OR-ing with them', () => {
    const { q, calls } = stubQuery();
    applyMapFilters(q, parseMapFilters(get({ state: 'NY,NJ' }), { profileStates: ['PA', 'DE', 'CT'] }));
    const stateOrs = calls.filter((c) => c.method === 'or' && c.arg.includes('pop_state.eq.'));
    expect(stateOrs).toHaveLength(1);
    expect(stateOrs[0].arg).not.toContain('pop_state.eq.PA');
    expect(stateOrs[0].arg).toContain('pop_state.eq.NY');
  });

  it('stateMatchConds matches the profileStates loop shape', () => {
    expect(stateMatchConds(['NY', 'NJ']).join(',')).toBe(
      'pop_state.eq.NY,office_address->>state.eq.NY,pop_state.eq.NJ,office_address->>state.eq.NJ',
    );
  });
});
