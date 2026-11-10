/**
 * Paging for the Opportunity Map headline count (`countUniqueListingsForFilters` in
 * `src/app/api/app/opportunity-map/route.ts`).
 *
 * That count is viewport-independent, so it walks the WHOLE filtered corpus in 1,000-row
 * OFFSET pages. The first page (fetched by the route with `count: 'exact'`) sizes the walk;
 * this module fetches the remaining pages.
 */

/** Size of one OFFSET page — PostgREST's response cap. */
export const MAP_COUNT_PAGE_SIZE = 1000;

/**
 * Max OFFSET page queries in flight for ONE map count.
 *
 * Previously unbounded: an `status=all`/`closed` filter (~201k rows) fired ~200 concurrent
 * OFFSET queries from a single pan/zoom, averaging ~4 s and peaking ~7.9 s against the 8 s
 * PostgREST statement_timeout (measured pg_stat_statements, 2026-11-10). The default
 * active+mapped set (~8.6k rows, 9 pages) costs about one extra page round-trip at 6.
 */
export const MAP_COUNT_PAGE_CONCURRENCY = 6;

/**
 * Run `worker` over `items` with at most `concurrency` calls in flight. Results come back in
 * INPUT order. The first rejection rejects the whole call and no new item is started after it —
 * there is no partial result (for a count, a partial result would be a fabricated number).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`mapWithConcurrency: concurrency must be a positive integer, got ${concurrency}`);
  }
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  });
  await Promise.all(lanes);
  return results;
}

/**
 * Fetch every OFFSET page after the first (offsets pageSize, 2*pageSize, … < total) with
 * bounded concurrency and return their rows concatenated in OFFSET order — exactly what the
 * old `Promise.all` over every offset produced. Any page error rejects the whole call.
 */
export async function fetchRemainingOffsetPages<Row>(
  total: number,
  fetchPage: (from: number) => Promise<Row[]>,
  opts: { pageSize?: number; concurrency?: number } = {},
): Promise<Row[]> {
  const pageSize = opts.pageSize ?? MAP_COUNT_PAGE_SIZE;
  const concurrency = opts.concurrency ?? MAP_COUNT_PAGE_CONCURRENCY;
  const offsets: number[] = [];
  for (let from = pageSize; from < total; from += pageSize) offsets.push(from);
  const pages = await mapWithConcurrency(offsets, concurrency, (from) => fetchPage(from));
  const rows: Row[] = [];
  for (const page of pages) rows.push(...page);
  return rows;
}
