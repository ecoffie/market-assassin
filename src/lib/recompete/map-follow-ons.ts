/**
 * Recompete map FOLLOW-ONS — planner-independent read (Recompete performance Gate 1, 2026-09-24).
 *
 * The follow-on set is tiny by construction: `data_source = 'usaspending_followon'` is 410 of 178,601
 * rows (396 mapped, measured 2026-09-24). The old single read asked PostgREST for
 *   canonical plan ∧ mapped ∧ bbox ∧ data_source = follow-on
 * and left the join order to the planner. With trigram indexes on the text columns the planner
 * misreads the regex selectivity and drives that read from a text-index BitmapOr instead of the
 * 410-row follow-on filter — measured on a rolled-back indexed copy: 774–824 ms instead of 134–149 ms
 * (tasks/recompete-trgm-prototype-2026-09-24.md).
 *
 * So the read is split so that NO index choice can make it expensive:
 *   1. candidates — follow-on ∧ mapped ∧ bbox, with NO text predicate (a few hundred ids at most);
 *   2. the UNCHANGED canonical plan, applied only to `contract_id IN (candidates)` — a unique-index
 *      lookup of at most CHUNK rows per request, whatever the text predicate looks like.
 *
 * The result is the same set by construction: step 2 re-applies every predicate of the old read
 * (plan, mapped, bbox, data_source), and step 1 only restricts it to rows that already satisfy the
 * follow-on/mapped/bbox part. The canonical plan is applied through the caller's `applyPlan` — this
 * module never interprets search meaning. Order is deterministic (contract_id) and the old MAX_PINS
 * cap is kept.
 */
export const FOLLOW_ON_SOURCE = 'usaspending_followon';
/** PostgREST caps a response at 1,000 rows; step 1 pages at that size. */
const PAGE = 1000;
/** ids per step-2 request: 100 × ≤54-char contract_ids keeps the URL well inside proxy limits. */
export const FOLLOW_ON_ID_CHUNK = 100;

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

export interface FollowOnDeps {
  /** A fresh `from('recompete_opportunities')` builder. */
  from: () => Query;
  /** The caller's canonical plan + surface filters, mapped rows only (applyMapsRecompeteFilters). */
  applyPlan: (q: Query) => Query;
  /** The caller's viewport bound. */
  bbox: (q: Query) => Query;
  cols: string;
  cap: number;
}

async function candidateIds(d: FollowOnDeps): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await d.bbox(
      d.from().select('contract_id').eq('data_source', FOLLOW_ON_SOURCE).not('map_lat', 'is', null),
    ).order('contract_id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`follow-on candidates: ${error.message}`);
    const page = (data || []) as Row[];
    for (const r of page) ids.push(String(r.contract_id));
    if (page.length < PAGE) return ids;
  }
}

/** The follow-on pins for this request: identical set to the old single read, deterministic order. */
export async function fetchFollowOnRows(d: FollowOnDeps): Promise<Row[]> {
  const ids = await candidateIds(d);
  if (!ids.length) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += FOLLOW_ON_ID_CHUNK) chunks.push(ids.slice(i, i + FOLLOW_ON_ID_CHUNK));
  const parts = await Promise.all(chunks.map(async (chunk) => {
    const { data, error } = await d.bbox(d.applyPlan(d.from().select(d.cols)))
      .eq('data_source', FOLLOW_ON_SOURCE).in('contract_id', chunk);
    if (error) throw new Error(`follow-on rows: ${error.message}`);
    return (data || []) as Row[];
  }));
  const rows = parts.flat();
  rows.sort((a, b) => (String(a.contract_id) < String(b.contract_id) ? -1 : String(a.contract_id) > String(b.contract_id) ? 1 : 0));
  return rows.slice(0, d.cap);
}
