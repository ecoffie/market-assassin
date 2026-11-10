import { describe, it, expect } from 'vitest';
import {
  fetchRemainingOffsetPages,
  mapWithConcurrency,
  MAP_COUNT_PAGE_CONCURRENCY,
  MAP_COUNT_PAGE_SIZE,
} from './map-count-pages';
import { countDistinctListings } from './canonical-listing';

type KeyRow = { solicitation_number: string | null; notice_id: string | null };

/** Deterministic fake corpus: duplicate solicitations across page boundaries, some null sols. */
function fakeRow(i: number): KeyRow {
  return {
    solicitation_number: i % 7 === 0 ? null : `SOL-${Math.floor(i / 3)}`,
    notice_id: `n${String(i).padStart(6, '0')}`,
  };
}

function fakeFetcher(total: number, pageSize: number, opts: { delayMs?: (from: number) => number; failAt?: number } = {}) {
  const state = { inFlight: 0, maxInFlight: 0, calls: [] as number[] };
  const fetchPage = async (from: number): Promise<KeyRow[]> => {
    state.calls.push(from);
    state.inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    try {
      // Later offsets resolve FASTER, so an implementation that appends in completion order
      // would scramble the rows.
      await new Promise((r) => setTimeout(r, opts.delayMs ? opts.delayMs(from) : 1));
      if (opts.failAt === from) throw new Error(`page ${from} failed`);
      const rows: KeyRow[] = [];
      for (let i = from; i < Math.min(from + pageSize, total); i++) rows.push(fakeRow(i));
      return rows;
    } finally {
      state.inFlight--;
    }
  };
  return { state, fetchPage };
}

/** The pre-fix implementation, verbatim in shape: one Promise.all over every offset. */
async function unboundedReference(total: number, pageSize: number, fetchPage: (from: number) => Promise<KeyRow[]>) {
  const offsets: number[] = [];
  for (let from = pageSize; from < total; from += pageSize) offsets.push(from);
  const pages = await Promise.all(offsets.map((from) => fetchPage(from)));
  const rows: KeyRow[] = [];
  for (const p of pages) rows.push(...p);
  return rows;
}

describe('fetchRemainingOffsetPages — bounded map-count paging', () => {
  it('never has more than MAP_COUNT_PAGE_CONCURRENCY page queries in flight (50-page set)', async () => {
    const total = 50 * MAP_COUNT_PAGE_SIZE; // page 0 is the route's counted first page → 49 remaining
    const { state, fetchPage } = fakeFetcher(total, MAP_COUNT_PAGE_SIZE, { delayMs: () => 5 });
    await fetchRemainingOffsetPages(total, fetchPage);
    expect(state.calls.length).toBe(49);
    expect(state.maxInFlight).toBeGreaterThan(1); // still concurrent, not sequential
    expect(state.maxInFlight).toBeLessThanOrEqual(MAP_COUNT_PAGE_CONCURRENCY);
  });

  it('assembles byte-identical rows (same order) and the same distinct count as the unbounded version', async () => {
    const total = 23_457; // ragged last page
    const delay = (from: number) => Math.max(1, 30 - from / 1000); // later pages finish first
    const bounded = await fetchRemainingOffsetPages(total, fakeFetcher(total, MAP_COUNT_PAGE_SIZE, { delayMs: delay }).fetchPage);
    const reference = await unboundedReference(total, MAP_COUNT_PAGE_SIZE, fakeFetcher(total, MAP_COUNT_PAGE_SIZE, { delayMs: delay }).fetchPage);
    expect(bounded).toEqual(reference);
    expect(bounded.length).toBe(total - MAP_COUNT_PAGE_SIZE);
    expect(bounded[0].notice_id).toBe('n001000');
    expect(bounded[bounded.length - 1].notice_id).toBe('n023456');

    const first: KeyRow[] = [];
    for (let i = 0; i < MAP_COUNT_PAGE_SIZE; i++) first.push(fakeRow(i));
    expect(countDistinctListings([...first, ...bounded])).toBe(countDistinctListings([...first, ...reference]));
  });

  it('rejects the whole count when any page fails — no partial number', async () => {
    const total = 30 * MAP_COUNT_PAGE_SIZE;
    const { state, fetchPage } = fakeFetcher(total, MAP_COUNT_PAGE_SIZE, { failAt: 4 * MAP_COUNT_PAGE_SIZE });
    await expect(fetchRemainingOffsetPages(total, fetchPage)).rejects.toThrow('page 4000 failed');
    // Bounded: after the failure no further waves are launched.
    expect(state.calls.length).toBeLessThan(29);
  });

  it('fetches nothing when the first page already covers the set', async () => {
    const { state, fetchPage } = fakeFetcher(800, MAP_COUNT_PAGE_SIZE);
    expect(await fetchRemainingOffsetPages(800, fetchPage)).toEqual([]);
    expect(await fetchRemainingOffsetPages(MAP_COUNT_PAGE_SIZE, fetchPage)).toEqual([]);
    expect(state.calls).toEqual([]);
  });
});

describe('mapWithConcurrency', () => {
  it('returns results in input order regardless of completion order', async () => {
    const out = await mapWithConcurrency([30, 5, 20, 1, 10], 2, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `${i}:${ms}`;
    });
    expect(out).toEqual(['0:30', '1:5', '2:20', '3:1', '4:10']);
  });

  it('rejects non-positive concurrency', async () => {
    await expect(mapWithConcurrency([1], 0, async (x) => x)).rejects.toThrow('positive integer');
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 6, async (x) => x)).toEqual([]);
  });
});
