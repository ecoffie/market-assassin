/** liveWithLastGood: live-first, dated fallback only when the SOURCE errors (Data Core 2026-11-17). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows = new Map<string, { response_data: unknown; fetched_at: string; expires_at: string }>();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      let key = '';
      const api = {
        select: () => api,
        eq: (_c: string, v: string) => { key = v; return api; },
        maybeSingle: async () => ({ data: rows.get(key) ?? null, error: null }),
        upsert: async (row: { cache_key: string; response_data: unknown; fetched_at: string; expires_at: string }) => { rows.set(row.cache_key, row); return { error: null }; },
      };
      return api;
    },
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
const { liveWithLastGood, generateCacheKey, LAST_GOOD_MAX_AGE_SECONDS } = await import('./external-cache');

beforeEach(() => rows.clear());

describe('liveWithLastGood', () => {
  it('serves live and snapshots a non-empty success', async () => {
    const r = await liveWithLastGood('t', { a: 1 }, async () => ({ value: [1, 2], failed: false }));
    expect(r).toEqual({ value: [1, 2], source: 'live' });
    expect(rows.size).toBe(1);
  });

  it('on a source error serves the snapshot with the time it was taken', async () => {
    await liveWithLastGood('t', { a: 1 }, async () => ({ value: [1, 2], failed: false }));
    const r = await liveWithLastGood('t', { a: 1 }, async () => ({ value: [], failed: true }));
    expect(r.source).toBe('last_good');
    if (r.source === 'last_good') { expect(r.value).toEqual([1, 2]); expect(Date.parse(r.fetchedAt)).toBeGreaterThan(0); }
  });

  it('a thrown fetch is treated as a source error', async () => {
    await liveWithLastGood('t', { a: 2 }, async () => ({ value: ['x'], failed: false }));
    const r = await liveWithLastGood('t', { a: 2 }, async () => { throw new Error('boom'); });
    expect(r.source).toBe('last_good');
  });

  it('an error with no snapshot stays an error (unknown, never an invented answer)', async () => {
    const r = await liveWithLastGood('t', { a: 3 }, async () => ({ value: [], failed: true }));
    expect(r.source).toBe('error');
  });

  it('an empty live success is returned but never snapshotted', async () => {
    const r = await liveWithLastGood('t', { a: 4 }, async () => ({ value: [], failed: false }));
    expect(r.source).toBe('live');
    expect(rows.size).toBe(0);
  });

  it('a snapshot older than the max age is not used', async () => {
    const old = new Date(Date.now() - (LAST_GOOD_MAX_AGE_SECONDS + 3600) * 1000).toISOString();
    rows.set(generateCacheKey('t', { a: 5 }), { response_data: ['stale'], fetched_at: old, expires_at: old });
    const r = await liveWithLastGood('t', { a: 5 }, async () => ({ value: [], failed: true }));
    expect(r.source).toBe('error');
  });
});
