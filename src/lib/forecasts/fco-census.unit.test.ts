/**
 * Live Gateway pagination, measured 2026-11-19:
 * page=0 is the first slice, page=2 repeats page=1's nids, page=3 continues.
 * A pool of 3 then received HTTP 503. A repeated index is not the end of the
 * source. A 503 is a resume point, degraded, not complete, and not "zero pages".
 */
import { describe, expect, it } from 'vitest';
import { runFcoCensus } from './fco-census';

function page(nids: string[], total = 6) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      listing: {
        total: String(total),
        data: nids.map((nid) => ({
          nid,
          render: {
            nid,
            title: `Row ${nid}`,
            field_result_id: 'Department of the Interior',
            field_source_listing_id: `ID_${nid}`,
          },
        })),
      },
    }),
  };
}

describe('runFcoCensus resume and duplicate pages', () => {
  it('does not stop when page 2 repeats page 1', async () => {
    const seen: string[] = [];
    const census = await runFcoCensus({
      concurrency: 1,
      retryBaseMs: 0,
      budgetMs: 30_000,
      fetchImpl: async (url) => {
        const pageNo = Number(new URL(url).searchParams.get('page'));
        seen.push(String(pageNo));
        if (pageNo === 0) return page(['1', '2']);
        if (pageNo === 1 || pageNo === 2) return page(['3', '4']);
        if (pageNo === 3) return page(['5', '6']);
        return page([]);
      },
    });
    expect(census.complete).toBe(true);
    expect(census.degraded).toBe(false);
    expect(census.uniqueRows).toBe(6);
    expect(census.resumePage).toBeNull();
    expect(seen).toContain('3');
  });

  it('a 503 after a successful page is degraded and resumable, not complete', async () => {
    const census = await runFcoCensus({
      concurrency: 1,
      retryBaseMs: 0,
      budgetMs: 30_000,
      fetchImpl: async (url) => {
        const pageNo = Number(new URL(url).searchParams.get('page'));
        if (pageNo === 0) return page(['1'], 100);
        return { ok: false, status: 503, json: async () => ({}) };
      },
    });
    expect(census.pagesFetched).toBe(1);
    expect(census.complete).toBe(false);
    expect(census.degraded).toBe(true);
    expect(census.resumePage).toBe(1);
    expect(census.reportedTotal).toBe(100);
  });

  it('resumes at startPage', async () => {
    const seen: number[] = [];
    await runFcoCensus({
      startPage: 4,
      concurrency: 1,
      retryBaseMs: 0,
      budgetMs: 30_000,
      fetchImpl: async (url) => {
        const pageNo = Number(new URL(url).searchParams.get('page'));
        seen.push(pageNo);
        return page([], 10);
      },
    });
    expect(seen[0]).toBe(4);
  });
});
