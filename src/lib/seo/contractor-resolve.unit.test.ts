/**
 * Regression suite for the July 2026 indexing collapse (10,173 → 1,347 indexed).
 *
 * A valid contractor must never answer 404 or render empty because its cache entry is cold.
 * Covered here: valid records (warm and cold), cache eviction, BigQuery failure / quota
 * exhaustion, a spent budget, confirmed-nonexistent records, and aliases whose target is cold.
 */
import { describe, expect, it, vi } from 'vitest';
import type { BqResultState } from '@/lib/bigquery/cache';
import type { RollupProfile } from '@/lib/bigquery/recipients';
import {
  resolveContractor,
  coreSectionsUnavailable,
  type ContractorResolveDeps,
} from './contractor-resolve';

const LOCKHEED = { rollup_uei: 'ZFN2JJXBLZT3', canonical_slug: 'lockheed-martin-corp' } as RollupProfile;

type Key = 'rollup' | 'recipient' | 'canonical';
type World = {
  /** What each key holds in KV right now: a value, a cached empty answer, or cold. */
  cache: Partial<Record<Key, 'value' | 'empty' | 'cold'>>;
  /** What live BigQuery answers for each key; 'failed' = quota exhausted / query error. */
  live: Partial<Record<Key, 'value' | 'empty' | 'failed'>>;
  canonicalTarget?: string;
  targetServeable?: boolean;
  budget?: boolean;
};

function harness(w: World) {
  const states: Record<Key, BqResultState> = { rollup: 'empty', recipient: 'empty', canonical: 'empty' };
  const calls: string[] = [];
  const read = (key: Key, live: boolean): boolean => {
    calls.push(`${key}:${live ? 'live' : 'cache'}`);
    const c = w.cache[key] ?? 'cold';
    if (!live) {
      states[key] = c === 'value' ? 'hit' : c === 'empty' ? 'empty' : 'unavailable';
      return c === 'value';
    }
    const l = w.live[key] ?? 'empty';
    states[key] = l === 'value' ? 'hit' : l === 'empty' ? 'empty' : 'failed';
    return l === 'value';
  };
  const deps: ContractorResolveDeps = {
    rollupOrSingle: vi.fn(async (_s: string, live: boolean) => {
      if (read('rollup', live)) return LOCKHEED;
      return read('recipient', live) ? LOCKHEED : null;
    }),
    canonicalOf: vi.fn(async (_s: string, live: boolean) =>
      read('canonical', live) ? (w.canonicalTarget ?? 'parent-co') : null,
    ),
    serveable: vi.fn(async (c: string | null) => (c && w.targetServeable ? c : null)),
    state: (key) => states[key],
    takeBudget: vi.fn(async () => w.budget ?? true),
    recordWarmMiss: vi.fn(async () => {}),
  };
  return { deps, calls };
}

describe('valid record, cached data', () => {
  it('renders without touching BigQuery or the budget', async () => {
    const { deps, calls } = harness({ cache: { rollup: 'value' }, live: {} });
    expect(await resolveContractor('lockheed-martin-corp', deps)).toEqual({
      kind: 'found', recipient: LOCKHEED, liveBq: false,
    });
    expect(deps.takeBudget).not.toHaveBeenCalled();
    expect(calls.some((c) => c.endsWith(':live'))).toBe(false);
  });

  it('a cached single-UEI recipient also renders from cache', async () => {
    const { deps } = harness({ cache: { rollup: 'empty', recipient: 'value' }, live: {} });
    expect((await resolveContractor('small-co', deps)).kind).toBe('found');
    expect(deps.takeBudget).not.toHaveBeenCalled();
  });

  it('a cached serveable alias redirects without spending budget', async () => {
    const { deps } = harness({
      cache: { rollup: 'empty', recipient: 'empty', canonical: 'value' },
      live: {}, canonicalTarget: 'caci-international-inc', targetServeable: true,
    });
    expect(await resolveContractor('caci-inc-federal', deps)).toEqual({ kind: 'redirect', slug: 'caci-international-inc' });
    expect(deps.takeBudget).not.toHaveBeenCalled();
  });
});

describe('valid record, missing cache (eviction / DATA_VERSION bump / never warmed)', () => {
  it('does a bounded live lookup and renders — never a 404', async () => {
    const { deps } = harness({ cache: {}, live: { rollup: 'value' } });
    expect(await resolveContractor('power-engineers-inc', deps)).toEqual({
      kind: 'found', recipient: LOCKHEED, liveBq: true,
    });
    expect(deps.takeBudget).toHaveBeenCalledTimes(1);
  });

  it('finds a cold alias live and redirects to its serveable parent', async () => {
    const { deps } = harness({
      cache: {}, live: { canonical: 'value' }, canonicalTarget: 'parent-co', targetServeable: true,
    });
    expect(await resolveContractor('child-co', deps)).toEqual({ kind: 'redirect', slug: 'parent-co' });
  });

  it('an alias whose parent page is cold is UNKNOWN, not absent (the caci-inc-federal bug)', async () => {
    const { deps } = harness({
      cache: { rollup: 'empty', recipient: 'empty', canonical: 'value' },
      live: {}, canonicalTarget: 'parent-co', targetServeable: false,
    });
    const r = await resolveContractor('child-co', deps);
    expect(r).toEqual({ kind: 'unavailable', reason: 'alias-target-cold' });
    // The TARGET is what gets warmed — it is the page that will serve.
    expect(deps.recordWarmMiss).toHaveBeenCalledWith('parent-co');
  });
});

describe('temporary failures → 5xx, never 404, always queued for the warm cron', () => {
  it('BigQuery quota exhausted on the live lookup', async () => {
    const { deps } = harness({ cache: {}, live: { rollup: 'failed', recipient: 'failed', canonical: 'failed' } });
    expect(await resolveContractor('power-engineers-inc', deps)).toEqual({ kind: 'unavailable', reason: 'bigquery-failed' });
    expect(deps.recordWarmMiss).toHaveBeenCalledWith('power-engineers-inc');
  });

  it('one failed arm is enough to refuse a 404', async () => {
    const { deps } = harness({ cache: {}, live: { rollup: 'empty', recipient: 'empty', canonical: 'failed' } });
    expect((await resolveContractor('x', deps)).kind).toBe('unavailable');
  });

  it('daily budget spent: no live query at all, 5xx + queued', async () => {
    const { deps, calls } = harness({ cache: {}, live: { rollup: 'value' }, budget: false });
    expect(await resolveContractor('power-engineers-inc', deps)).toEqual({ kind: 'unavailable', reason: 'cold-budget-exhausted' });
    expect(calls.some((c) => c.endsWith(':live'))).toBe(false);
    expect(deps.recordWarmMiss).toHaveBeenCalledWith('power-engineers-inc');
  });
});

describe('confirmed nonexistent → real 404', () => {
  it('every arm holds a cached empty answer: 404 with no BigQuery and no budget', async () => {
    const { deps } = harness({ cache: { rollup: 'empty', recipient: 'empty', canonical: 'empty' }, live: {} });
    expect(await resolveContractor('not-a-company', deps)).toEqual({ kind: 'not_found' });
    expect(deps.takeBudget).not.toHaveBeenCalled();
    expect(deps.recordWarmMiss).not.toHaveBeenCalled();
  });

  it('cold cache, BigQuery answers empty on every arm: 404, not queued', async () => {
    const { deps } = harness({ cache: {}, live: { rollup: 'empty', recipient: 'empty', canonical: 'empty' } });
    expect(await resolveContractor('not-a-company', deps)).toEqual({ kind: 'not_found' });
    expect(deps.recordWarmMiss).not.toHaveBeenCalled();
  });

  it('only cold arms are re-asked live; a cached canonical answer is reused', async () => {
    const { deps, calls } = harness({ cache: { canonical: 'empty' }, live: {} });
    await resolveContractor('not-a-company', deps);
    expect(calls).not.toContain('canonical:live');
  });
});

describe('core sections', () => {
  it('both core sections cold or failed means the page would be a Soft 404', () => {
    expect(coreSectionsUnavailable('unavailable', 'unavailable')).toBe(true);
    expect(coreSectionsUnavailable('failed', 'unavailable')).toBe(true);
  });
  it('a real answer in either section (even a genuine zero) is renderable', () => {
    expect(coreSectionsUnavailable('hit', 'unavailable')).toBe(false);
    expect(coreSectionsUnavailable('empty', 'failed')).toBe(false);
    expect(coreSectionsUnavailable('empty', 'empty')).toBe(false);
  });
});
