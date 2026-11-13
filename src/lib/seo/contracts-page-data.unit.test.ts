/**
 * /contractors/<x>/contracts data path through the REAL cache layer (bigquery/cache.ts).
 * Only the edges are mocked: KV, BigQuery, the durable serving table, and the budget.
 *
 * The July 2026 failure this guards: a cold awards cache rendered "1–0 of 0" under a
 * "$399M" title on thousands of pages, which Google filed as Soft 404s (2,859 today).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  kvStore: new Map<string, unknown>(),
  kvDown: false,
  bq: vi.fn(),
  served: vi.fn(),
  budget: vi.fn(),
  warmMiss: vi.fn(),
}));

vi.mock('@vercel/kv', () => ({
  kv: {
    get: vi.fn(async (k: string) => {
      if (m.kvDown) throw new Error('KV down');
      return m.kvStore.has(k) ? m.kvStore.get(k) : null;
    }),
    set: vi.fn(async (k: string, v: unknown) => {
      if (!m.kvDown) m.kvStore.set(k, v);
    }),
  },
}));
vi.mock('@/lib/bigquery/client', () => ({
  bqQuery: m.bq,
  BQ_TABLES: new Proxy({}, { get: (_t, p) => `\`t.${String(p)}\`` }),
}));
vi.mock('@/lib/bigquery/guard', () => ({ isLiveBigQueryBlocked: () => false }));
vi.mock('@/lib/awards-serving', async (orig) => ({
  ...(await orig<typeof import('@/lib/awards-serving')>()),
  readServedPageState: m.served,
}));
vi.mock('@/lib/seo/seo-unavailable', async (orig) => ({
  ...(await orig<typeof import('@/lib/seo/seo-unavailable')>()),
  takeSeoColdBudget: m.budget,
}));
vi.mock('@/lib/seo/served-slugs', () => ({ recordWarmMiss: m.warmMiss }));

import { getPaginatedAwardsForRecipient, seoCacheKeys, type RollupProfile } from '@/lib/bigquery/recipients';
import { loadContractsPage } from './contractor-page-data';
import { DATA_VERSION } from '@/lib/bigquery/cache';

const R = {
  rollup_uei: 'UEI1', child_ueis: ['UEI1'], canonical_slug: 'power-engineers-inc',
} as RollupProfile;
const kvKey = (k: string) => `bq:${DATA_VERSION}:${k}`;
const ROW = { award_id: 'A1', piid: 'W1', obligation_amount: 100, action_date: '2026-05-01' };

function warm(page: number, rows: unknown[], total: number) {
  m.kvStore.set(kvKey(seoCacheKeys.awardsPage('UEI1', page, 50)), rows);
  m.kvStore.set(kvKey(seoCacheKeys.awardsTotal('UEI1')), [{ total }]);
}

// loadContractsPage re-uses a settled answer per key for 10s (dedupeInFlight). Each test is a
// separate "request", so move the clock past that window between tests.
let clock = 1_800_000_000_000;
beforeEach(() => {
  clock += 60_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  m.kvStore.clear();
  m.kvDown = false;
  m.bq.mockReset();
  m.served.mockReset().mockResolvedValue({ status: 'absent' });
  m.budget.mockReset().mockResolvedValue(true);
  m.warmMiss.mockReset();
});

describe('getPaginatedAwardsForRecipient states', () => {
  it('warm cache → ok, no BigQuery', async () => {
    warm(1, [ROW], 112);
    const r = await getPaginatedAwardsForRecipient(R.child_ueis, 'UEI1', 1, 50);
    expect(r).toMatchObject({ state: 'ok', available: true, total: 112 });
    expect(m.bq).not.toHaveBeenCalled();
  });

  it('cache evicted, durable table has the page → ok, no BigQuery', async () => {
    m.served.mockResolvedValue({ status: 'hit', page: { rows: [ROW], counts: { displayedActions: 112 } } });
    const r = await getPaginatedAwardsForRecipient(R.child_ueis, 'UEI1', 1, 50);
    expect(r).toMatchObject({ state: 'ok', total: 112 });
    expect(m.bq).not.toHaveBeenCalled();
  });

  it('cache evicted, table has no row → unavailable (unknown), never a zero', async () => {
    const r = await getPaginatedAwardsForRecipient(R.child_ueis, 'UEI1', 1, 50);
    expect(r).toMatchObject({ state: 'unavailable', available: false });
    expect(m.bq).not.toHaveBeenCalled();
  });

  it('Supabase error on the table → failed, not unavailable and not empty', async () => {
    m.served.mockResolvedValue({ status: 'error', reason: 'postgrest: timeout' });
    expect((await getPaginatedAwardsForRecipient(R.child_ueis, 'UEI1', 1, 50)).state).toBe('failed');
  });

  it('KV outage reads as cold, never as "no awards"', async () => {
    m.kvDown = true;
    const r = await getPaginatedAwardsForRecipient(R.child_ueis, 'UEI1', 1, 50);
    expect(r.available).toBe(false);
    expect(r.state).not.toBe('ok');
  });
});

describe('loadContractsPage (the page decision)', () => {
  it('cold everywhere + budget → one live read, renders, and writes KV for next time', async () => {
    m.bq.mockImplementation(async (o: { query: string }) =>
      o.query.includes('COUNT(*)') ? [{ total: 112 }] : [ROW],
    );
    const r = await loadContractsPage(R, 1, 50);
    expect(r).toEqual({ kind: 'ok', rows: [ROW], total: 112 });
    expect(m.budget).toHaveBeenCalledWith('contracts', expect.any(Date), 'power-engineers-inc/1');
    expect(m.kvStore.get(kvKey(seoCacheKeys.awardsTotal('UEI1')))).toEqual([{ total: 112 }]);
  });

  it('BigQuery quota exhausted on the live read → unavailable + queued (5xx, not empty)', async () => {
    m.bq.mockRejectedValue(new Error('Custom quota exceeded: QueryUsagePerDay'));
    const r = await loadContractsPage(R, 1, 50);
    expect(r).toEqual({ kind: 'unavailable', reason: 'bigquery-failed' });
    expect(m.warmMiss).toHaveBeenCalledWith('power-engineers-inc');
  });

  it('budget spent → unavailable + queued, and BigQuery is never called', async () => {
    m.budget.mockResolvedValue(false);
    const r = await loadContractsPage(R, 1, 50);
    expect(r).toEqual({ kind: 'unavailable', reason: 'cold-budget-exhausted' });
    expect(m.bq).not.toHaveBeenCalled();
    expect(m.warmMiss).toHaveBeenCalled();
  });

  it('a data-source ERROR does not spend budget retrying into the same wall', async () => {
    m.served.mockResolvedValue({ status: 'error', reason: 'no-service-client' });
    const r = await loadContractsPage(R, 1, 50);
    expect(r).toEqual({ kind: 'unavailable', reason: 'data-source-failed' });
    expect(m.budget).not.toHaveBeenCalled();
  });

  it('live BigQuery answers zero funded actions → confirmed empty (ok, total 0)', async () => {
    m.bq.mockImplementation(async (o: { query: string }) => (o.query.includes('COUNT(*)') ? [{ total: 0 }] : []));
    expect(await loadContractsPage(R, 1, 50)).toEqual({ kind: 'ok', rows: [], total: 0 });
  });

  it('a key that FAILED earlier in this instance does not short-circuit a later cold read', async () => {
    // Yesterday's quota exhaustion left the keys marked failed in this lambda instance.
    m.bq.mockRejectedValueOnce(new Error('quota')).mockRejectedValueOnce(new Error('quota'));
    await getPaginatedAwardsForRecipient(R.child_ueis, 'UEI1', 1, 50, true);
    // Today: a cache-only cold read must report UNKNOWN (eligible for recovery), not failed.
    m.bq.mockImplementation(async (o: { query: string }) => (o.query.includes('COUNT(*)') ? [{ total: 3 }] : [ROW]));
    expect(await loadContractsPage({ ...R }, 1, 50)).toEqual({ kind: 'ok', rows: [ROW], total: 3 });
    expect(m.budget).toHaveBeenCalled();
  });

  it('a page past the end of a real listing comes back ok-and-empty (the page 404s it)', async () => {
    warm(1, [ROW], 40);
    m.kvStore.set(kvKey(seoCacheKeys.awardsPage('UEI1', 2, 50)), []);
    expect(await loadContractsPage(R, 2, 50)).toEqual({ kind: 'ok', rows: [], total: 40 });
    expect(m.bq).not.toHaveBeenCalled();
  });
});
