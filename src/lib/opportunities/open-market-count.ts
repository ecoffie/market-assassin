/**
 * The Map's Open market count — ONE function, used by the Map API headline AND by every surface that
 * prints a number the Map is supposed to show (the Today's Lens CTA in the daily alert and the
 * Today's Intel hero).
 *
 * UNIT: distinct canonical LISTINGS (canonical-listing.ts), never raw rows. One solicitation is posted
 * as many `sam_opportunities` rows (synopsis + each amendment), and the Map draws one pin per listing.
 *
 * SCOPE: the COMPLETE filtered market, with and without coordinates.
 *   - `mapped`   = listings with at least one row the Map can draw (they have a pin).
 *   - `market`   = every listing that matches, mapped or not.
 *   - `unmapped` = `market − mapped` = listings with NO drawable row. Same unit as `mapped`, so the
 *                  two add up to `market` by construction.
 *
 * Why this replaced two separate queries (2026-10-25, Joseph Boyd): the Map reported
 * `distinct(mapped) + rawRowCount(unmapped)`. Those are different units — a locationless listing with
 * three amendments counted three times, and a listing with one mapped and one unmapped amendment
 * counted twice. Meanwhile the lens counted raw rows, so "Explore 24 recommended" opened a Map that
 * said 20. One walk, one key function, one answer.
 *
 * ⚠️ Still PostgREST + the caller's filter adapter (applyMapsOpenFilters), NOT a SQL RPC — re-expressing
 * the predicates in SQL would fork the definition of "what matches" (see the Map route's comment).
 */
import { canonicalListingKey } from './canonical-listing';
import { mapsOpenRequest, applyMapsOpenFilters } from './maps-open-discovery';

export interface OpenMarketKeyRow {
  solicitation_number: string | null;
  notice_id: string | null;
  map_lat: number | null;
}

export interface OpenMarketCounts {
  mapped: number;
  market: number;
  unmapped: number;
}

/** Pure tally over the key rows of a filtered set. */
export function tallyOpenMarket(rows: OpenMarketKeyRow[]): OpenMarketCounts {
  const all = new Set<string>();
  const mapped = new Set<string>();
  for (const r of rows) {
    const key = canonicalListingKey({ solicitation_number: r.solicitation_number, notice_id: r.notice_id });
    if (!key) continue;
    all.add(key);
    if (r.map_lat != null) mapped.add(key);
  }
  return { mapped: mapped.size, market: all.size, unmapped: all.size - mapped.size };
}

const PAGE = 1000;

/**
 * Walk the filtered set's key columns (paged past the 1,000-row cap, pages fetched in parallel after
 * the first one sizes the walk) and tally it. THROWS on any query error — a failed count is unknown,
 * never 0 (Bug Prevention Rule #11).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function countOpenMarket(db: any, applyFilters: (q: any) => any): Promise<OpenMarketCounts> {
  const pageQuery = (from: number, withCount: boolean) => applyFilters(
    db.from('sam_opportunities')
      .select('solicitation_number, notice_id, map_lat', withCount ? { count: 'exact' } : undefined)
      .order('notice_id', { ascending: true })
      .range(from, from + PAGE - 1),
  );

  const { data: first, count, error: firstErr } = await pageQuery(0, true);
  if (firstErr) throw firstErr;
  const rows: OpenMarketKeyRow[] = [...((first ?? []) as OpenMarketKeyRow[])];

  // count sizes the walk only (raw rows, pre-dedupe). Null = unknown → page sequentially to the end
  // rather than trust whatever the first page held.
  if (count == null) {
    if (rows.length === PAGE) {
      for (let from = PAGE; ; from += PAGE) {
        const { data: page, error } = await pageQuery(from, false);
        if (error) throw error;
        if (!page || !page.length) break;
        rows.push(...(page as OpenMarketKeyRow[]));
        if (page.length < PAGE) break;
      }
    }
    return tallyOpenMarket(rows);
  }

  if (rows.length < count) {
    const offsets: number[] = [];
    for (let from = PAGE; from < count; from += PAGE) offsets.push(from);
    const pages = await Promise.all(offsets.map(async (from) => {
      const { data: page, error } = await pageQuery(from, false);
      if (error) throw error;
      return (page ?? []) as OpenMarketKeyRow[];
    }));
    for (const page of pages) rows.push(...page);
  }
  return tallyOpenMarket(rows);
}

/**
 * The Map's market count for a Map URL's query params, exactly as `/api/app/opportunity-map` computes
 * it for a signed-out / non-profile request (the lens link carries its own NAICS, so no profile scope).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function countOpenMarketForMapParams(db: any, params: URLSearchParams): Promise<OpenMarketCounts> {
  const req = mapsOpenRequest((k) => params.get(k));
  return countOpenMarket(db, (q) => applyMapsOpenFilters(q, req));
}
