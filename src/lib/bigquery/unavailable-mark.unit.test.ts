import { describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('@vercel/kv', () => ({
  kv: {
    get: vi.fn(async (k: string) => (store.has(k) ? store.get(k) : null)),
    set: vi.fn(async (k: string, v: unknown) => { store.set(k, v); return 'OK'; }),
  },
}));
vi.mock('./client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  bqQuery: vi.fn(async () => []),
}));

import { bqUnavailable, queryCached } from './cache';

describe('cache-only miss mark', () => {
  it('is cleared by a later real answer, so "no such row" reads as empty, not unknown', async () => {
    const opts = { cacheKey: 'test:award:missing', query: 'SELECT 1', params: {} };
    // 1) Cold, cache-only: unknown.
    expect(await queryCached({ ...opts, cacheOnly: true })).toEqual([]);
    expect(bqUnavailable(opts.cacheKey, 0)).toBe(true);
    // 2) Live lookup answers "no rows" (and caches that answer): a real empty, not unknown.
    expect(await queryCached({ ...opts, cacheOnly: false })).toEqual([]);
    expect(bqUnavailable(opts.cacheKey, 0)).toBe(false);
    // 3) A later warm read of the cached empty stays a real empty.
    expect(await queryCached({ ...opts, cacheOnly: true })).toEqual([]);
    expect(bqUnavailable(opts.cacheKey, 0)).toBe(false);
  });
});
