/**
 * PAGED READS — the one shared answer to PostgREST's silent 1,000-row cap.
 *
 * The cap applies REGARDLESS of `.limit()`, sets no error and no flag; `data.length === 1000`
 * is the only tell. On a READ that becomes a wrong number. On a BACKFILL or a CRON it is worse:
 * the job processes the first 1,000 records, skips the rest, and prints a success summary.
 *
 * ⚠️ PAGINATION IS NOT ALWAYS THE RIGHT FIX. Fetching 150,000 rows so JavaScript can count
 * them defeats the cap and is still bad architecture. Ask what the code is trying to KNOW,
 * then use the cheapest operation that answers it truthfully:
 *
 *   | need                          | right tool                                   |
 *   |-------------------------------|----------------------------------------------|
 *   | how many?                     | `count: 'exact', head: true` — never fetch    |
 *   | an aggregate / group-by       | an RPC, so Postgres does the work             |
 *   | genuinely every row           | `fetchAllPaged` (this file)                   |
 *   | a resumable batch             | a bounded `.limit()` + a cursor column        |
 *   | provably bounded already      | `// truncation-ok: <why the cap can't apply>` |
 *
 * The query factory MUST carry a stable `.order()` so pages partition cleanly — without it
 * PostgREST may return overlapping or missing rows across pages, which reads as "some records
 * were skipped at random" and is far harder to diagnose than a clean truncation.
 *
 * Provenance: extracted from `cron/daily-alerts`, where an unpaginated eligibility query left
 * ~541 subscribers NEVER processed and pinned the daily send at ~1,000 regardless of signups.
 * That version is the one proven in production; this is it, promoted so other jobs stop
 * re-deriving it. See docs/engineering/postgrest-1000-row-cap.md.
 */

export const SUPABASE_PAGE_SIZE = 1000;

/**
 * Read EVERY row a query matches, one 1,000-row page at a time.
 * Throws on a page error so callers keep their existing error handling — a partial read must
 * never be silently returned as if it were the whole population.
 */
export async function fetchAllPaged<T = unknown>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  makeQuery: () => any,
  pageSize = SUPABASE_PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break; // short page = last page
  }
  return all;
}

/**
 * Chunk a list for `.in(...)` filters.
 *
 * A `.in()` lookup is bounded by the list you pass, so it does not scan the table — but a list
 * over ~1,000 still truncates the RESPONSE, and URL length limits bite well before that. Chunk
 * the keys and merge, rather than paging a table you were never scanning.
 */
export async function fetchAllByKeys<T = unknown>(
  keys: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  makeQuery: (chunk: string[]) => any,
  chunkSize = 500,
): Promise<{ data: T[]; error: string | null }> {
  const out: T[] = [];
  const unique = Array.from(new Set(keys));
  for (let i = 0; i < unique.length; i += chunkSize) {
    const { data, error } = await makeQuery(unique.slice(i, i + chunkSize));
    if (error) return { data: out, error: error.message };
    if (data?.length) out.push(...(data as T[]));
  }
  return { data: out, error: null };
}
