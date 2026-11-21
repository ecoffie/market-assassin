/**
 * ROUTE-LEVEL regression for the headline-count fan-out (countUniqueListingsForFilters).
 *
 * The bug: after the first `count: 'exact'` page, the route fetched EVERY remaining OFFSET page with
 * an unbounded Promise.all — a status=all filter (~200 pages) fired ~200 concurrent PostgREST
 * queries from a single pan/zoom. The fix caps it at MAP_COUNT_PAGE_CONCURRENCY via
 * fetchRemainingOffsetPages.
 *
 * map-count-pages.unit.test.ts covers the helper alone, so it stays green if the route stops calling
 * it. This test drives the real GET handler with a fake Supabase client that tracks how many key-page
 * queries are in flight at once, so reverting the route to an unbounded fan-out fails here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { countDistinctListings } from '@/lib/opportunities/canonical-listing';
import { MAP_COUNT_PAGE_CONCURRENCY } from '@/lib/opportunities/map-count-pages';

type KeyRow = { solicitation_number: string | null; notice_id: string | null };

const PAGE = 1000;
const TOTAL_ROWS = 50 * PAGE; // 50 pages: 1 count page + 49 remaining

// Deterministic corpus with real duplicates (2 notices per solicitation) and solicitation-less rows,
// so the distinct-listing count differs from the raw row count.
const CORPUS: KeyRow[] = Array.from({ length: TOTAL_ROWS }, (_, i) => ({
  solicitation_number: i % 5 === 0 ? null : `SOL-${Math.floor(i / 2)}`,
  notice_id: `N-${String(i).padStart(6, '0')}`,
}));

const state = {
  inFlight: 0,
  maxInFlight: 0,
  pageOffsetsRequested: [] as number[],
  failOffset: null as number | null,
};

/** A chainable, thenable stand-in for a PostgREST builder. Filters are ignored (recorded only);
 *  what matters is which query shape this is and when it resolves. */
function makeBuilder() {
  const q: { select?: string; selectOpts?: { count?: string; head?: boolean }; range?: [number, number] } = {};
  const resolveQuery = async () => {
    const isKeyPage = q.select === 'solicitation_number, notice_id' && q.range;
    if (!isKeyPage) {
      // viewport pins / unmapped head count — not under test; return an empty, successful result.
      return { data: [], count: 0, error: null };
    }
    const [from, to] = q.range!;
    state.pageOffsetsRequested.push(from);
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    try {
      await new Promise((r) => setTimeout(r, 2));
      if (state.failOffset === from) return { data: null, count: null, error: { message: `page ${from} failed` } };
      return {
        data: CORPUS.slice(from, to + 1),
        count: q.selectOpts?.count === 'exact' ? CORPUS.length : null,
        error: null,
      };
    } finally {
      state.inFlight -= 1;
    }
  };
  const proxy: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => resolveQuery().then(onF, onR);
      }
      if (prop === 'select') {
        return (cols: string, opts?: { count?: string; head?: boolean }) => { q.select = cols; q.selectOpts = opts; return proxy; };
      }
      if (prop === 'range') {
        return (from: number, to: number) => { q.range = [from, to]; return proxy; };
      }
      return () => proxy; // not / order / or / eq / in / ilike / is / gte / lte / limit / ...
    },
  });
  return proxy;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => makeBuilder() }),
}));
vi.mock('@/lib/gov-contacts/dodaac-directory', async (orig) => {
  const real = await orig<typeof import('@/lib/gov-contacts/dodaac-directory')>();
  return { ...real, loadDodaacEarlySignal: async () => new Map() };
});
vi.mock('@/lib/opportunities/early-signal-pins', async (orig) => {
  const real = await orig<typeof import('@/lib/opportunities/early-signal-pins')>();
  return { ...real, decorateWithEarlySignal: async <T,>(pins: T[]) => pins };
});

async function callRoute() {
  const { GET } = await import('@/app/api/app/opportunity-map/route');
  const { NextRequest } = await import('next/server');
  const res = await GET(new NextRequest('https://getmindy.ai/api/app/opportunity-map?bbox=-125,24,-66,50&status=all'));
  return { status: res.status, body: await res.json() };
}

describe('opportunity-map route: headline count page concurrency', () => {
  beforeEach(() => {
    state.inFlight = 0;
    state.maxInFlight = 0;
    state.pageOffsetsRequested = [];
    state.failOffset = null;
  });

  it('never has more than MAP_COUNT_PAGE_CONCURRENCY key-page queries in flight', async () => {
    const { status, body } = await callRoute();
    expect(status).toBe(200);
    // every page was fetched exactly once
    expect([...state.pageOffsetsRequested].sort((a, b) => a - b))
      .toEqual(Array.from({ length: TOTAL_ROWS / PAGE }, (_, i) => i * PAGE));
    // the first (count) page is awaited alone, so the cap applies to all in-flight key pages
    expect(state.maxInFlight).toBeLessThanOrEqual(MAP_COUNT_PAGE_CONCURRENCY);
    expect(MAP_COUNT_PAGE_CONCURRENCY).toBe(6);
  });

  it('returns the same distinct-listing count the unbounded walk produced', async () => {
    const { body } = await callRoute();
    const expected = countDistinctListings(CORPUS);
    expect(expected).toBeLessThan(TOTAL_ROWS); // the corpus really has duplicates
    expect(body.totalForFilters).toBe(expected);
  });

  it('a single failed page fails the whole request (no partial count)', async () => {
    state.failOffset = 37 * PAGE;
    const { status, body } = await callRoute();
    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.totalForFilters).toBeUndefined();
  });
});
