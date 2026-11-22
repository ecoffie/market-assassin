/**
 * A notice-type filter chosen in the map's Filters panel is stored as `noticeMulti` (the top-bar notice
 * select was removed 2026-07-27). The map merges noticeType + noticeMulti; saved-search evaluation must too.
 */
import { describe, it, expect } from 'vitest';
import { applyMapFilters, parseMapFilters, withMergedNoticeType, withMergedSetAside } from './map-filters';

function recorder() {
  const ins: Array<[string, unknown[]]> = [];
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'is', 'not', 'ilike', 'like', 'contains', 'overlaps', 'filter', 'order', 'limit', 'range', 'select', 'textSearch', 'match', 'or']) q[m] = chain;
  q.in = (col: string, vals: unknown[]) => { ins.push([col, vals]); return q; };
  return { q, ins };
}

describe('withMergedNoticeType', () => {
  it('merges noticeType and noticeMulti, deduped', () => {
    const get = withMergedNoticeType((k) => ({ noticeType: 'Solicitation', noticeMulti: ['Combined Synopsis/Solicitation', 'Solicitation'] } as Record<string, unknown>)[k]);
    expect(get('noticeType')).toBe('Solicitation,Combined Synopsis/Solicitation');
  });
  it('a Filters-panel notice type now filters a saved search (it used to apply nothing)', () => {
    const stored = { noticeMulti: 'Sources Sought' } as Record<string, string>;
    const fixed = recorder();
    applyMapFilters(fixed.q, parseMapFilters(withMergedNoticeType(withMergedSetAside((k) => stored[k] ?? null))));
    expect(fixed.ins).toContainEqual(['notice_type', ['Sources Sought']]);
    const old = recorder();
    applyMapFilters(old.q, parseMapFilters((k) => stored[k] ?? null));
    expect(old.ins.some(([c]) => c === 'notice_type')).toBe(false);
  });
  it('composes with the set-aside merge without touching other keys', () => {
    const get = withMergedNoticeType(withMergedSetAside((k) => ({ setAsideMulti: 'SDVOSB', naics: '236220' } as Record<string, unknown>)[k] ?? null));
    expect(get('setAside')).toBe('SDVOSB');
    expect(get('noticeType')).toBeNull();
    expect(get('naics')).toBe('236220');
  });
});

describe('semantics match the live map exactly (Claude Local review of #2339)', () => {
  function full() {
    const calls: Array<[string, unknown[]]> = [];
    const q: Record<string, unknown> = {};
    for (const m of ['eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'is', 'not', 'ilike', 'like', 'contains', 'overlaps', 'filter', 'order', 'limit', 'range', 'select', 'textSearch', 'match', 'or', 'in']) {
      q[m] = (...args: unknown[]) => { calls.push([m, args]); return q; };
    }
    return { q, calls };
  }
  // The map's own merge (opportunity-map/route.ts _merge): [noticeType, noticeMulti].filter(Boolean).join(',')
  const mapMerge = (a?: string, b?: string) => [a, b].filter(Boolean).join(',');

  it('OR within notice types (one .in), AND with every other filter (separate chained predicates), identical to the map', () => {
    const stored = { noticeType: 'Presolicitation', noticeMulti: 'Solicitation,Sources Sought', naics: '236220', state: 'FL' } as Record<string, string>;
    const saved = full();
    applyMapFilters(saved.q, parseMapFilters(withMergedNoticeType(withMergedSetAside((k) => stored[k] ?? null))));
    const live = full();
    const url = { noticeType: mapMerge(stored.noticeType, stored.noticeMulti), naics: stored.naics, state: stored.state } as Record<string, string>;
    applyMapFilters(live.q, parseMapFilters((k) => url[k] ?? null));
    expect(saved.calls).toEqual(live.calls);
    const notice = saved.calls.filter(([m, a]) => m === 'in' && a[0] === 'notice_type');
    expect(notice).toEqual([['in', ['notice_type', ['Presolicitation', 'Solicitation', 'Sources Sought']]]]);
    expect(saved.calls.some(([m, a]) => m === 'or' && String(a[0]).includes('naics_code'))).toBe(true);
  });
});
