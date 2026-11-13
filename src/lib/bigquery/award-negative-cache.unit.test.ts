/**
 * Award negative caching (2026-11-13).
 *
 * award_detail_lookup stopped at 2026-04-23 while the warehouse ran to 2026-11-04, and "not found"
 * was cached for 90 days — so real awards 404'd for months after the data existed. A negative must
 * now expire in 7 days, die with a table rebuild, and never be written for a failure.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  kv: new Map<string, { v: unknown; ex?: number }>(),
  table: new Map<string, unknown>(), // award_detail_lookup contents as BigQuery would answer
  bqFails: false,
  build: '2026-06-02T09:21:41.000Z' as string | null,
  budget: true,
  liveQueries: 0,
  unavailable: new Set<string>(),
}));

vi.mock('@vercel/kv', () => ({
  kv: {
    get: vi.fn(async (k: string) => (m.kv.has(k) ? m.kv.get(k)!.v : null)),
    set: vi.fn(async (k: string, v: unknown, o?: { ex?: number }) => { m.kv.set(k, { v, ex: o?.ex }); return 'OK'; }),
    del: vi.fn(async (k: string) => m.kv.delete(k)),
  },
}));
vi.mock('@/lib/bigquery/cache', () => ({
  DATA_VERSION: 'v4-test',
  // Minimal queryCached: cache-only reads KV; live reads hit the fake table, honoring
  // forceRefresh + cacheEmpty exactly as the real implementation does.
  queryCached: vi.fn(async (o: { cacheKey: string; cacheOnly: boolean; forceRefresh?: boolean; cacheEmpty?: boolean; params: { id: string } }) => {
    const key = `bq:v4-test:${o.cacheKey}`;
    m.unavailable.delete(key);
    if (!o.forceRefresh && m.kv.has(key)) return m.kv.get(key)!.v;
    if (o.cacheOnly) { m.unavailable.add(key); return []; }
    m.liveQueries++;
    if (m.bqFails) { m.unavailable.add(key); return []; }
    const row = m.table.get(o.params.id);
    const rows = row ? [row] : [];
    if (rows.length || o.cacheEmpty !== false) m.kv.set(key, { v: rows, ex: 90 * 86400 });
    return rows;
  }),
  bqUnavailable: (cacheKey: string, n: number) => n === 0 && m.unavailable.has(`bq:v4-test:${cacheKey}`),
}));
vi.mock('./client', () => ({
  BQ_TABLES: new Proxy({}, { get: (_t, p) => String(p) }),
  getTableLastModified: vi.fn(async () => m.build),
}));
vi.mock('@/lib/seo/live-bq', () => ({ seoLiveBqEnabled: () => false }));
vi.mock('@/lib/seo/award-cold-budget', () => ({ allowAwardColdLookup: vi.fn(async () => m.budget) }));

import { getAwardLookup, resetAwardLookupBuildMemo, AWARD_NEGATIVE_TTL_SECONDS } from './awards';

const ID = 'CONT_AWD_05GA0A26F0062_0559_NNG15SC49B_8000';
const AWARD = { award_id: ID, piid: '05GA0A26F0062', recipient_name: 'Acme' };
const negKey = `bq:v4-test:awards:detail-missing:v1:${ID}`;
let clock = 1_900_000_000_000;

beforeEach(() => {
  // getAwardLookup re-uses a settled answer for 10s per id (dedupeInFlight); each test step is a
  // separate request, so move the clock past that window between lookups.
  clock += 60_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  m.kv.clear(); m.table.clear();
  m.bqFails = false; m.budget = true; m.liveQueries = 0;
  m.build = '2026-06-02T09:21:41.000Z';
  resetAwardLookupBuildMemo();
});
const nextRequest = () => { clock += 11 * 60_000; resetAwardLookupBuildMemo(); };

describe('an award that becomes available after an earlier negative lookup', () => {
  it('is served once the lookup table is rebuilt — not 404 for the rest of a 90-day TTL', async () => {
    // Day 0: the award exists in the warehouse but not yet in the (stale) lookup table.
    expect(await getAwardLookup(ID)).toEqual({ state: 'missing', award: null });
    expect(m.kv.get(negKey)?.ex).toBe(AWARD_NEGATIVE_TTL_SECONDS); // 7 days, not 90

    // Same table build: the negative is trusted — no BigQuery, no budget.
    nextRequest();
    m.liveQueries = 0;
    expect((await getAwardLookup(ID)).state).toBe('missing');
    expect(m.liveQueries).toBe(0);

    // The table is rebuilt and now contains the award.
    m.build = '2026-11-13T12:00:00.000Z';
    m.table.set(ID, AWARD);
    nextRequest();
    expect(await getAwardLookup(ID)).toEqual({ state: 'hit', award: AWARD });
    expect(m.liveQueries).toBe(1);
  });

  it('a legacy 90-day [] under the positive key is not trusted', async () => {
    m.kv.set(`bq:v4-test:awards:detail:${ID}`, { v: [], ex: 90 * 86400 }); // pre-change negative
    m.table.set(ID, AWARD);
    expect(await getAwardLookup(ID)).toEqual({ state: 'hit', award: AWARD });
  });

  it('writing a new negative retires the legacy [] entry', async () => {
    m.kv.set(`bq:v4-test:awards:detail:${ID}`, { v: [], ex: 90 * 86400 });
    await getAwardLookup(ID);
    expect(m.kv.has(`bq:v4-test:awards:detail:${ID}`)).toBe(false);
    expect(m.kv.has(negKey)).toBe(true);
  });
});

describe('confirmed absence vs failure', () => {
  it('a BigQuery failure is unavailable and writes no negative', async () => {
    m.bqFails = true;
    expect(await getAwardLookup(ID)).toEqual({ state: 'unavailable', award: null });
    expect(m.kv.has(negKey)).toBe(false);
  });
  it('a spent budget is unavailable and writes no negative', async () => {
    m.budget = false;
    expect((await getAwardLookup(ID)).state).toBe('unavailable');
    expect(m.kv.has(negKey)).toBe(false);
  });
  it('positives keep the shared long cache', async () => {
    m.table.set(ID, AWARD);
    await getAwardLookup(ID);
    expect(m.kv.get(`bq:v4-test:awards:detail:${ID}`)?.ex).toBe(90 * 86400);
  });
  it('if the table build cannot be read, the 7-day negative still holds (TTL fallback)', async () => {
    m.build = null;
    await getAwardLookup(ID);
    nextRequest(); m.liveQueries = 0;
    expect((await getAwardLookup(ID)).state).toBe('missing');
    expect(m.liveQueries).toBe(0);
  });
});
