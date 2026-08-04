import { describe, it, expect } from 'vitest';
import { parseMapFilters, applyMapFilters, STRATEGY_STRAND_KEYS } from './map-filters';
import { genomeKeys, computeGenome } from './genome';

const NOW = Date.parse('2026-08-04T12:00:00Z');
const getter = (o: Record<string, string>) => (k: string) => o[k] ?? null;

describe('strategy filter — parse (allowlisted genome strand keys)', () => {
  it('parses comma-separated strand keys into an array', () => {
    const f = parseMapFilters(getter({ strategy: 'repeat_buyer,set_aside' }));
    expect(f.strategy).toEqual(['repeat_buyer', 'set_aside']);
  });

  it('drops unknown keys (no injection into the array predicate)', () => {
    const f = parseMapFilters(getter({ strategy: 'repeat_buyer,DROP TABLE,bogus_key,set_aside' }));
    expect(f.strategy).toEqual(['repeat_buyer', 'set_aside']);
  });

  it('empty / missing strategy → []', () => {
    expect(parseMapFilters(getter({})).strategy).toEqual([]);
    expect(parseMapFilters(getter({ strategy: '' })).strategy).toEqual([]);
    expect(parseMapFilters(getter({ strategy: 'nope' })).strategy).toEqual([]);
  });

  it('every allowlisted key is a real genome strand key (allowlist stays in sync with computeGenome)', () => {
    // Build a maximal genome and confirm each shipped key it can emit is in the allowlist.
    const g = computeGenome(
      { src: 'RECOMPETE', noticeType: 'Sources Sought', set: 'SDVOSB',
        close: new Date(NOW + 2 * 86400000).toISOString(), sbf: 1, repeatBuyer: 1, postsEarly: 1 },
      NOW,
    );
    for (const k of genomeKeys(g)) {
      expect(STRATEGY_STRAND_KEYS as readonly string[]).toContain(k);
    }
  });
});

describe('strategy filter — apply (JSONB-keys @> ALL predicate)', () => {
  // A tiny query-builder stub that records the predicate the filter applies.
  function stubQuery() {
    const calls: Array<{ fn: string; args: unknown[] }> = [];
    const q: Record<string, (...a: unknown[]) => unknown> = {};
    for (const fn of ['eq', 'gt', 'or', 'in', 'contains', 'neq', 'lt']) {
      q[fn] = (...args: unknown[]) => { calls.push({ fn, args }); return q; };
    }
    return { q, calls };
  }

  it('adds a .contains(opportunity_dna_keys, strands) — has-ALL / AND semantics', () => {
    const { q, calls } = stubQuery();
    const f = parseMapFilters(getter({ status: 'open', strategy: 'repeat_buyer,set_aside' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyMapFilters(q as any, f);
    const contains = calls.find((c) => c.fn === 'contains');
    expect(contains).toBeTruthy();
    expect(contains!.args[0]).toBe('opportunity_dna_keys');
    expect(contains!.args[1]).toEqual(['repeat_buyer', 'set_aside']);
  });

  it('applies NO strategy predicate when the list is empty (never filters everything out)', () => {
    const { q, calls } = stubQuery();
    const f = parseMapFilters(getter({ status: 'open' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyMapFilters(q as any, f);
    expect(calls.find((c) => c.fn === 'contains' && c.args[0] === 'opportunity_dna_keys')).toBeUndefined();
  });
});
