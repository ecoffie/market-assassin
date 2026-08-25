import { describe, it, expect } from 'vitest';
import { readAllPages, PG_MAX_ROWS } from '../paged-read';

/**
 * The contract: `exhausted` is the ONLY signal that a read is complete.
 *
 * Receiving exactly 1,000 rows is ambiguous — PostgREST caps every response at
 * that number, so it can mean "all there is" or "there is more, invisibly
 * truncated". Treating those the same is what let validateGeneration() inspect
 * 1,000 of 23,492 pages and refuse a valid build.
 */

/** A fake PostgREST builder over a fixed dataset. */
function fakeTable(total: number, opts: { failAtPage?: number } = {}) {
  let calls = 0;
  return () => ({
    range: async (from: number, to: number) => {
      calls++;
      if (opts.failAtPage && calls === opts.failAtPage) {
        return { data: null, error: { message: 'simulated read failure' } };
      }
      const size = to - from + 1;
      const rows = Array.from(
        { length: Math.max(0, Math.min(size, total - from)) },
        (_, i) => ({ id: from + i }),
      );
      return { data: rows, error: null };
    },
  });
}

describe('readAllPages — exhaustion must be proven', () => {
  it('reads a small set in one page and proves exhaustion', async () => {
    const r = await readAllPages(fakeTable(42));
    expect(r.rows).toHaveLength(42);
    expect(r.pagesFetched).toBe(1);
    expect(r.exhausted).toBe(true);
    expect(r.error).toBeNull();
  });

  it('pages through a large set until a short page proves the end', async () => {
    const r = await readAllPages(fakeTable(23_492));
    expect(r.rows).toHaveLength(23_492);
    expect(r.pagesFetched).toBe(24); // 23 full + 1 short
    expect(r.exhausted).toBe(true);
  });

  it('EXACTLY 1000 rows is not assumed complete — it fetches again to prove it', async () => {
    // The crux. A single 1,000-row page could be the whole set or a truncation.
    // Only the empty second page settles it.
    const r = await readAllPages(fakeTable(PG_MAX_ROWS));
    expect(r.rows).toHaveLength(1000);
    expect(r.pagesFetched).toBe(2); // the second page is what proves exhaustion
    expect(r.exhausted).toBe(true);
  });

  it('an empty table is exhausted, not unknown', async () => {
    const r = await readAllPages(fakeTable(0));
    expect(r.rows).toHaveLength(0);
    expect(r.exhausted).toBe(true); // genuinely nothing — safe to render "none"
    expect(r.error).toBeNull();
  });

  it('a failed page reports NOT exhausted and surfaces the error', async () => {
    const r = await readAllPages(fakeTable(5_000, { failAtPage: 3 }));
    expect(r.error).toBe('simulated read failure');
    expect(r.exhausted).toBe(false); // partial rows must never look complete
    expect(r.rows.length).toBeLessThan(5_000);
  });

  it('hitting maxRows reports NOT exhausted', async () => {
    const r = await readAllPages(fakeTable(50_000), { maxRows: 2_000 });
    expect(r.rows.length).toBeGreaterThanOrEqual(2_000);
    expect(r.exhausted).toBe(false);
    expect(r.error).toContain('maxRows');
  });

  it('never requests more than the PostgREST cap per page', async () => {
    const seen: number[] = [];
    await readAllPages(
      () => ({
        range: async (from: number, to: number) => {
          seen.push(to - from + 1);
          return { data: [], error: null };
        },
      }),
      { pageSize: 50_000 }, // asking for more than the cap
    );
    // Silently clamped: requesting 50,000 would just return 1,000 anyway.
    expect(Math.max(...seen)).toBeLessThanOrEqual(PG_MAX_ROWS);
  });

  it('a validator using this cannot mistake truncation for a small dataset', async () => {
    // The exact 2026-08-25 failure: 23,492 pages, a 1,000-row read, and the
    // conclusion "only 876 recipients".
    const truncated = await readAllPages(fakeTable(23_492), { maxRows: 1_000 });
    expect(truncated.exhausted).toBe(false);

    const validatorWouldTrust = truncated.exhausted && !truncated.error;
    expect(validatorWouldTrust).toBe(false); // refuses to judge a partial set
  });
});
