/**
 * Maps viewport requests: MARKET TRUTH vs VIEWPORT PINS (Maps P0, 2026-09-24).
 *
 * Every Maps horizon endpoint (opportunity-map, recompete-map, forecast-map) answers two different
 * questions in one response:
 *   - market truth — totalForFilters / unmappedForFilters (/ unplaced list rows): a function of the
 *     canonical discovery plan + surface filters ONLY. The bbox never enters it.
 *   - viewport pins — pins / totalInView / capped: a function of the plan AND the bbox.
 *
 * Measured on prod 2026-09-24: a 3-block pan cost ~1.0 s on Open alone because the whole-corpus
 * distinct-listing count ran on every pan, and keyword Recompete re-evaluated its regex filter for
 * the market total + unmapped count on every pan (EXPLAIN: ~0.4–0.9 s per read).
 *
 * `?counts=0` is sent by the Maps client ONLY when it already holds this exact intent's market truth
 * (same request minus bbox, fresh). The route then skips every bbox-independent count and returns
 * `countsSkipped: true` with the count fields ABSENT — never 0, never null. Null already means
 * "unknown" (Bug Prevention Rule #11); an omitted count means "you already have it".
 *
 * Any other value, or no param, keeps the full response (every other caller is unchanged).
 */
export function wantsMarketCounts(params: { get(k: string): string | null }): boolean {
  return params.get('counts') !== '0';
}
