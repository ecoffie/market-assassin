import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Paged PostgREST reads that PROVE exhaustion.
 *
 * THE HAZARD
 * ----------
 * PostgREST caps every response at `db-max-rows` (1,000 here). `.limit(50000)`
 * does not raise that ceiling — it returns 1,000 rows and no error. Receiving
 * exactly 1,000 rows is therefore ambiguous: it can mean "that is all there is"
 * or "there is more and you cannot see it". Code that treats the two the same
 * computes a confident answer from a fraction of the data.
 *
 * That ambiguity is the whole family of bugs behind the 2026-08-25 incident:
 *   - the awards cache returned [] on a miss, indistinguishable from "no rows"
 *   - validateGeneration() saw 1,000 of 23,492 pages and refused a good build
 *   - observatory.ts requests 200,000 rows from user_engagement (84,033 exist)
 *     and silently receives 1,000 — analytics on ~1.2% of the data
 *
 * THE CONTRACT
 * ------------
 * `exhausted` is true ONLY when a page came back shorter than the page size,
 * which is positive proof there is nothing after it. A caller that needs the
 * complete set MUST check it. Never infer completeness from a row count.
 */

export const PG_MAX_ROWS = 1000;

export interface PagedReadResult<T> {
  rows: T[];
  /** How many round trips were made. */
  pagesFetched: number;
  /**
   * True only if a short page proved there is nothing more.
   * False means we stopped at a cap — the set may be incomplete.
   */
  exhausted: boolean;
  /** Non-null if a page failed. `rows` is then partial and must not be trusted. */
  error: string | null;
}

/**
 * Read every row matching a query, one page at a time.
 *
 * Pass a BUILDER, not a query: a PostgREST builder cannot be re-ranged after it
 * has been awaited, so each page needs a fresh one. The builder's ordering must
 * be stable or pages can overlap or skip rows.
 *
 *   const res = await readAllPages(() =>
 *     supa.from('t').select('*').eq('x', 1).order('id'), { maxRows: 200_000 });
 *   if (!res.exhausted || res.error) return unavailable();  // never a partial answer
 */
export async function readAllPages<T>(
  build: () => {
    range: (from: number, to: number) => PromiseLike<{
      data: T[] | null;
      error: { message: string } | null;
    }>;
  },
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<PagedReadResult<T>> {
  const pageSize = Math.min(opts.pageSize ?? PG_MAX_ROWS, PG_MAX_ROWS);
  const maxRows = opts.maxRows ?? 500_000;

  const rows: T[] = [];
  let pagesFetched = 0;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    pagesFetched++;

    if (error) {
      // A failed page is NOT an empty result. Say so explicitly.
      return { rows, pagesFetched, exhausted: false, error: error.message };
    }

    const batch = data ?? [];
    rows.push(...batch);

    // The ONLY proof of exhaustion: a page shorter than we asked for.
    if (batch.length < pageSize) {
      return { rows, pagesFetched, exhausted: true, error: null };
    }

    if (rows.length >= maxRows) {
      // Stopped at a ceiling, so completeness is unproven. Say that too.
      return {
        rows,
        pagesFetched,
        exhausted: false,
        error: `stopped at maxRows=${maxRows}; set is larger`,
      };
    }
  }
}

/**
 * Convenience for the common Supabase shape.
 *
 * Deliberately no "just give me the rows" variant: the whole point is that the
 * caller must confront `exhausted`.
 */
export function pagedFrom<T>(
  supa: SupabaseClient,
  table: string,
  select: string,
  refine: (q: ReturnType<ReturnType<SupabaseClient['from']>['select']>) => unknown,
  opts?: { pageSize?: number; maxRows?: number },
): Promise<PagedReadResult<T>> {
  return readAllPages<T>(
    () => refine(supa.from(table).select(select)) as never,
    opts,
  );
}
