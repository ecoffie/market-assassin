/**
 * The ONE ordering of the /api/forecasts/unplaced list: estimated value (desc, nulls last) → id.
 *
 * `estimated_value_max` alone is NOT unique. Agencies publish value BANDS, so thousands of forecasts share
 * a value — measured 2026-09-23: USDA's 3,258 unplaced forecasts carry only 12 distinct values (639 at
 * $4.9M, 542 at $9.9M, …). Offset paging over a non-unique order lets each page break ties differently,
 * so the list returned 509 of them twice and never returned 509 others while `total` stayed correct.
 * `id` (the primary key) is the deterministic tiebreaker: it only orders rows the value already tied.
 */
export const UNPLACED_ORDER = [
  { col: 'estimated_value_max', opts: { ascending: false, nullsFirst: false } },
  { col: 'id', opts: { ascending: true } },
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyUnplacedOrder(query: any): any {
  let q = query;
  for (const o of UNPLACED_ORDER) q = q.order(o.col, o.opts);
  return q;
}
