/**
 * Competition Depth grounding contract (the FPDS competition extract).
 *
 * The lib samples a buyer's recent awards and reads `number_of_offers_received` from the per-award
 * DETAIL endpoint. It must be HONEST: a failed search surfaces grounded:false (never a fake average);
 * too few awards carrying an offers count → grounded:false (below MIN_SAMPLE, don't fake it); and a
 * real spread of offers → a computed avg + single-bid rate that trace to the returned data.
 *
 * We stub globalThis.fetch (the ONLY external dependency) and disable the Supabase cache by clearing
 * env, so withCache degrades to a straight fetcher call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeCompetitionDepth } from './competition-depth';

const SEARCH = 'spending_by_award';

// Build a fetch stub: the SEARCH POST returns the given ids; each per-award GET returns its offers.
function stubFetch(opts: { searchOk?: boolean; ids?: string[]; offersById?: Record<string, number | null> }) {
  const { searchOk = true, ids = [], offersById = {} } = opts;
  return vi.fn(async (url: string) => {
    if (String(url).includes(SEARCH)) {
      if (!searchOk) return { ok: false, status: 500, json: async () => ({}) } as Response;
      return { ok: true, status: 200, json: async () => ({ results: ids.map((id) => ({ generated_internal_id: id })) }) } as Response;
    }
    // per-award detail: /api/v2/awards/<id>/
    const id = decodeURIComponent(String(url).split('/awards/')[1]?.replace(/\/$/, '') || '');
    const n = offersById[id];
    return {
      ok: true, status: 200,
      json: async () => ({ latest_transaction_contract_data: { number_of_offers_received: n === undefined ? null : n } }),
    } as Response;
  });
}

describe('competition-depth grounding contract', () => {
  const realFetch = globalThis.fetch;
  const realUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const realKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    // Disable the external cache so withCache calls the fetcher directly (no Supabase in unit).
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = realUrl;
    if (realKey) process.env.SUPABASE_SERVICE_ROLE_KEY = realKey;
    vi.restoreAllMocks();
  });

  it('surfaces a search failure as grounded:false (never a fabricated average)', async () => {
    globalThis.fetch = stubFetch({ searchOk: false }) as unknown as typeof fetch;
    const d = await computeCompetitionDepth('VETERANS AFFAIRS, DEPARTMENT OF');
    expect(d.grounded).toBe(false);
    expect(d.avgBidders).toBeNull();
    expect(d.note).toContain('500');
  });

  it('stays grounded:false when too few awards carry an offers count (below MIN_SAMPLE)', async () => {
    // 20 ids but only 5 carry a real offers count → below MIN_SAMPLE (12) → honest not-enough-data.
    const ids = Array.from({ length: 20 }, (_, i) => `id${i}`);
    const offersById: Record<string, number | null> = {};
    ids.forEach((id, i) => { offersById[id] = i < 5 ? 3 : null; });
    globalThis.fetch = stubFetch({ ids, offersById }) as unknown as typeof fetch;
    const d = await computeCompetitionDepth('VETERANS AFFAIRS, DEPARTMENT OF');
    expect(d.grounded).toBe(false);
    expect(d.avgBidders).toBeNull();
    expect(d.sampledWithData).toBe(5);
    expect(d.note).toContain('too few');
  });

  it('computes avg + single-bid rate from real offers (all figures trace to the data)', async () => {
    // 20 awards, all carrying offers: ten 1-bidder, ten 5-bidder → avg 3.0, single-bid 50%, median low.
    const ids = Array.from({ length: 20 }, (_, i) => `id${i}`);
    const offersById: Record<string, number | null> = {};
    ids.forEach((id, i) => { offersById[id] = i < 10 ? 1 : 5; });
    globalThis.fetch = stubFetch({ ids, offersById }) as unknown as typeof fetch;
    const d = await computeCompetitionDepth('VETERANS AFFAIRS, DEPARTMENT OF');
    expect(d.grounded).toBe(true);
    expect(d.sampled).toBe(20);
    expect(d.sampledWithData).toBe(20);
    expect(d.avgBidders).toBe(3); // (10*1 + 10*5)/20 = 3.0
    expect(d.singleBidCount).toBe(10); // offers <= 1
    expect(d.singleBidPct).toBe(50);
    // PROVE THE BUYER: the sample is stamped with the RESOLVED USASpending agency it queried.
    expect(d.resolvedAgency).toBe('Department of Veterans Affairs');
  });

  it('refuses to sample (grounded:false, no fetch) when the agency name can\'t be resolved', async () => {
    // An unmapped agency that doesn't match "X, DEPARTMENT OF" must NOT be sampled — a guessed
    // toptier name would silently pull a DIFFERENT buyer's awards. Assert we never even fetch.
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const d = await computeCompetitionDepth('SOME MADE-UP OFFICE');
    expect(d.grounded).toBe(false);
    expect(d.resolvedAgency).toBeNull();
    expect(d.avgBidders).toBeNull();
    expect(d.note.toLowerCase()).toContain("can't confidently map");
    expect(fetchSpy).not.toHaveBeenCalled(); // no wrong-buyer sample was attempted
  });

  it('excludes offer-less awards from the denominator (IDVs/SAP), never counts them as zero', async () => {
    // 15 with a real offers count of 4, plus 10 with NO offers field → denominator must be 15, avg 4.
    const ids = Array.from({ length: 25 }, (_, i) => `id${i}`);
    const offersById: Record<string, number | null> = {};
    ids.forEach((id, i) => { offersById[id] = i < 15 ? 4 : null; });
    globalThis.fetch = stubFetch({ ids, offersById }) as unknown as typeof fetch;
    const d = await computeCompetitionDepth('VETERANS AFFAIRS, DEPARTMENT OF');
    expect(d.grounded).toBe(true);
    expect(d.sampled).toBe(25);
    expect(d.sampledWithData).toBe(15); // the 10 offer-less awards are excluded, not zeroed
    expect(d.avgBidders).toBe(4);
    expect(d.singleBidCount).toBe(0);
  });
});
