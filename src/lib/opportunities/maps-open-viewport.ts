/**
 * Maps Open — derive the VIEWPORT from the headline-count walk (#1696).
 *
 * WHY. Every Open request with market counts ran the canonical filter twice: once to walk the
 * whole filtered set for the distinct-listing headline count, and once more for the viewport pins
 * (filtered set ∩ bbox, ORDER BY response_deadline, LIMIT 1000). The viewport is a SUBSET of what
 * the walk already fetched. When the filter is a regex over TOASTed text (~1.1 s of DB CPU per
 * pass, 2-core DB), the duplicate pass doubled the load. On a cold page load the client aborts
 * its first Open round and re-fires with a settled bbox — the aborted request's statements keep
 * running on Postgres (a client abort never cancels them), so four regex passes plus the
 * Recompete and Forecast horizons land at once and Open crosses PostgREST's 8 s
 * `authenticator` statement_timeout → HTTP 500 "canceling statement due to statement timeout".
 *
 * This module reproduces the viewport query's semantics EXACTLY over the walk's rows:
 *  - bbox containment is `gte/lte` on both axes, inclusive — the same comparisons the SQL made on
 *    the same double-precision values (JSON round-trips a float8 losslessly);
 *  - order is `response_deadline ASC NULLS LAST` (Postgres' default for ASC), compared at the
 *    microsecond precision timestamptz carries; equal deadlines — arbitrary order in Postgres —
 *    fall back to notice_id so the cap boundary is at least deterministic;
 *  - `totalInView` is the RAW in-bbox row count, what `count: 'exact'` returned (feeds `capped`).
 * Pin columns are then fetched by primary key for the ≤ MAX_PINS chosen ids.
 */
export interface WalkRow {
  solicitation_number: string | null;
  notice_id: string | null;
  map_lat: number | null;
  map_lng: number | null;
  response_deadline: string | null;
}

export interface Bbox { west: number; south: number; east: number; north: number }

/** timestamptz text → [epoch ms, sub-millisecond µs] so ordering keeps Postgres' µs precision. */
export function deadlineSortKey(ts: string): [number, number] {
  const ms = Date.parse(ts);
  const frac = /\.(\d+)/.exec(ts)?.[1] ?? '';
  const micro = Number((frac + '000000').slice(3, 6));
  return [ms, micro];
}

function compareRows(a: WalkRow, b: WalkRow): number {
  const ad = a.response_deadline, bd = b.response_deadline;
  if (ad == null || bd == null) {
    if (ad == null && bd != null) return 1;   // NULLS LAST
    if (bd == null && ad != null) return -1;
  } else {
    const [am, au] = deadlineSortKey(ad);
    const [bm, bu] = deadlineSortKey(bd);
    if (am !== bm) return am - bm;
    if (au !== bu) return au - bu;
  }
  const an = a.notice_id ?? '', bn = b.notice_id ?? '';
  return an < bn ? -1 : an > bn ? 1 : 0;
}

export function selectViewportFromWalk(rows: readonly WalkRow[], bbox: Bbox, maxPins: number): {
  ids: string[];
  totalInView: number;
} {
  const inView = rows.filter((r) =>
    r.map_lat != null && r.map_lng != null &&
    r.map_lat >= bbox.south && r.map_lat <= bbox.north &&
    r.map_lng >= bbox.west && r.map_lng <= bbox.east);
  const top = [...inView].sort(compareRows).slice(0, maxPins);
  return { ids: top.map((r) => String(r.notice_id)), totalInView: inView.length };
}
