/**
 * A saved search whose set-aside was chosen in the map's Filters panel stores it as `setAsideMulti`.
 * The live map merges setAside + setAsideMulti into one `setAside=` param; every server path that
 * evaluates a saved search must do the same, or alerts go out UNFILTERED (2026-11-22).
 */
import { describe, it, expect } from 'vitest';
import { applyMapFilters, parseMapFilters, withMergedSetAside } from './map-filters';

function recorder() {
  const ors: string[] = [];
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'in', 'is', 'not', 'ilike', 'like', 'contains', 'overlaps', 'filter', 'order', 'limit', 'range', 'select', 'textSearch', 'match']) q[m] = chain;
  q.or = (s: string) => { ors.push(s); return q; };
  return { q, ors };
}
const evaluate = (stored: Record<string, unknown>) => {
  const { q, ors } = recorder();
  applyMapFilters(q, parseMapFilters(withMergedSetAside((k) => (stored[k] as string) ?? null)));
  return ors.join(' | ');
};

describe('withMergedSetAside', () => {
  it('merges setAside and setAsideMulti (strings or arrays), deduped', () => {
    const get = withMergedSetAside((k) => ({ setAside: 'SB', setAsideMulti: ['SDVOSB', 'SB'] } as Record<string, unknown>)[k]);
    expect(get('setAside')).toBe('SB,SDVOSB');
    expect(get('naics')).toBeUndefined();
  });
  it('null when neither is set; other keys pass through untouched', () => {
    const get = withMergedSetAside((k) => ({ naics: '236220' } as Record<string, unknown>)[k] ?? null);
    expect(get('setAside')).toBeNull();
    expect(get('naics')).toBe('236220');
  });
});

describe('a saved search with a Filters-panel set-aside is filtered like the map', () => {
  it('setAsideMulti=SDVOSB applies the SDVOSB code list (it used to apply nothing)', () => {
    expect(evaluate({ setAsideMulti: 'SDVOSB' })).toMatch(/set_aside_code\.in\.\(SDVOSBC,SDVOSBS/);
    // The bug, for contrast: reading only setAside applies no set-aside predicate at all.
    const { q, ors } = recorder();
    applyMapFilters(q, parseMapFilters((k) => ({ setAsideMulti: 'SDVOSB' } as Record<string, string>)[k] ?? null));
    expect(ors.join(' | ')).not.toMatch(/set_aside_code/);
  });
  it('a top-bar setAside alone is unchanged', () => {
    expect(evaluate({ setAside: 'SB' })).toMatch(/set_aside_code\.in\.\(SBA,SBP,SB\)/);
  });
});

describe('stored LOWERCASE tokens (plain-English search appends them) — Claude Local review of #2338', () => {
  it("a stored lowercase 'sdvosb' maps exactly like 'SDVOSB'", () => {
    expect(evaluate({ setAsideMulti: 'sdvosb' })).toBe(evaluate({ setAsideMulti: 'SDVOSB' }));
    expect(evaluate({ setAsideMulti: 'sdvosb' })).toMatch(/set_aside_code\.in\.\(SDVOSBC,SDVOSBS/);
  });
  it('lowercase intent keys with no group key use their official codes, never a literal that matches nothing', () => {
    const e = evaluate({ setAsideMulti: 'hubzone,vosb' });
    expect(e).toMatch(/HZC/);
    expect(e).toMatch(/VSA/);
    expect(e).not.toMatch(/\bhubzone\b|\bvosb\b/);
  });
  it('an uppercase group key and unknown tokens pass through unchanged', () => {
    const get = withMergedSetAside((k) => ({ setAside: 'SB', setAsideMulti: 'XYZ' } as Record<string, unknown>)[k]);
    expect(get('setAside')).toBe('SB,XYZ');
  });
});
