/**
 * Maps Recompete — COMPUTE ONCE (Recompete performance Gate 2, 2026-09-24). DESIGN + PARITY ONLY:
 * nothing in the running app calls this yet (record: tasks/recompete-compute-once-design-2026-09-24.md).
 *
 * Today one /api/app/recompete-map request evaluates the canonical market predicate ~4–5 times:
 * market total · unmapped · viewport pins (page + its exact count) · follow-ons. For a keyword market
 * that predicate is dozens of regexes (EXPLAIN: 0.4–1 s per evaluation even with the Gate 1 trigram
 * indexes, for common words). This builds ONE statement that evaluates it ONCE (a MATERIALIZED CTE of
 * the market's ids + the few columns presentation needs) and derives every number and row from it.
 *
 * NOT another search interpreter. Meaning comes only from:
 *   · req.plan.horizons.recompete.ops  — the canonical plan, serialized by discovery/sql.ts
 *   · mapsRecompeteSurfaceOps(...)     — the SAME surface spec the PostgREST path applies
 * Maps presentation stays parameters owned by the route: bbox, page order (expiry → contract_id), the
 * pin cap, the pin columns, and the follow-on source. The route keeps the merge/dedupe + toPin.
 *
 * Collation: the page tie-break sorts contract_id in the DATABASE collation, exactly like the live
 * `.order('contract_id')`. The follow-ons sort with COLLATE "C" because the live path
 * (map-follow-ons.ts) sorts them in JavaScript — code-unit order, which is what "C" is.
 */
import { SqlParams, opsSql, type ColumnTypes, type SqlType } from '@/lib/discovery/sql';
import { mapsRecompeteSurfaceOps, type MapsRecompeteRequest, type SurfaceOp } from './maps-recompete-discovery';
import { FOLLOW_ON_SOURCE } from './map-follow-ons';

/** Every column the plan, the surface filters or presentation may touch — and its type (for the casts). */
export const RECOMPETE_COLUMN_TYPES: ColumnTypes = {
  contract_id: 'text', piid: 'text', incumbent_name: 'text', incumbent_uei: 'text',
  awarding_agency: 'text', awarding_sub_agency: 'text', naics_code: 'text', naics_description: 'text',
  psc_code: 'text', psc_description: 'text', description: 'text',
  potential_total_value: 'numeric', total_obligation: 'numeric',
  period_of_performance_current_end: 'date', set_aside_type: 'text', contract_type: 'text',
  place_of_performance_city: 'text', place_of_performance_state: 'text',
  map_lat: 'float8', map_lng: 'float8', map_loc_source: 'text', last_synced_at: 'text', // timestamptz; selected only, never bound
  quality_flag: 'text', data_source: 'text', recompete_likelihood: 'text',
};

export interface OnePassOptions {
  bbox: { west: number; south: number; east: number; north: number };
  /** Pin cap (the route's MAX_PINS). */
  cap: number;
  /** Comma list, exactly the route's select (RECOMPETE_PIN_COLS). */
  pinCols: string;
  /** Oracle only: also return every market id (mapped or not), sorted. */
  withMarketIds?: boolean;
  /** 'positional' ($n, node-pg) or 'array' ($1[n], a text[] RPC argument). */
  paramStyle?: 'positional' | 'array';
}

const q = (col: string) => {
  if (!RECOMPETE_COLUMN_TYPES[col]) throw new Error(`maps-recompete-sql: column not on the whitelist: ${col}`);
  return `"${col}"`;
};

function surfaceSql(o: SurfaceOp, p: SqlParams): string {
  const t = RECOMPETE_COLUMN_TYPES[o.col] as SqlType | undefined;
  if (!t) throw new Error(`maps-recompete-sql: surface column not on the whitelist: ${o.col}`);
  switch (o.op) {
    case 'notnull': return `${q(o.col)} IS NOT NULL`;
    case 'isnull': return `${q(o.col)} IS NULL`;
    case 'eq': return `${q(o.col)} = ${p.bind(o.val, t)}`;
    case 'ilike': return `${q(o.col)} ILIKE ${p.bind(o.val.replace(/\*/g, '%'), 'text')}`;
    case 'gte': return `${q(o.col)} >= ${p.bind(String(o.val), t)}`;
    case 'lte': return `${q(o.col)} <= ${p.bind(String(o.val), t)}`;
    case 'in': return `${q(o.col)} IN (${o.vals.map((v) => p.bind(v, t)).join(', ')})`;
  }
}

/** The single statement. Returns one row: total · unmapped · in_view · pins · follow_ons [· market_ids]. */
export function recompeteOnePassSql(req: MapsRecompeteRequest, o: OnePassOptions): { text: string; values: string[] } {
  const p = new SqlParams(o.paramStyle ?? 'positional');
  const where = [
    opsSql(req.plan.horizons.recompete.ops, RECOMPETE_COLUMN_TYPES, p),
    ...mapsRecompeteSurfaceOps(req.surface, 'any').map((s) => surfaceSql(s, p)),   // mapped/unmapped split below
  ].join('\n    AND ');
  const cols = o.pinCols.split(',').map((c) => c.trim()).filter(Boolean).map(q).join(', ');
  const b = o.bbox;
  const S = p.bind(String(b.south), 'float8'), N = p.bind(String(b.north), 'float8');
  const Wb = p.bind(String(b.west), 'float8'), E = p.bind(String(b.east), 'float8');
  const cap = p.bind(String(o.cap), 'int8');
  const fo = p.bind(FOLLOW_ON_SOURCE, 'text');
  const text = `WITH m AS MATERIALIZED (
  SELECT "contract_id" AS _id, "period_of_performance_current_end" AS _end, "data_source" AS _src,
         ("map_lat" IS NOT NULL) AS _mapped,
         COALESCE("map_lat" >= ${S} AND "map_lat" <= ${N} AND "map_lng" >= ${Wb} AND "map_lng" <= ${E}, false) AS _inview
  FROM public.recompete_opportunities
  WHERE ${where}
),
page AS (SELECT _id, _end FROM m WHERE _mapped AND _inview ORDER BY _end ASC, _id ASC LIMIT ${cap}),
fo AS (SELECT _id FROM m WHERE _mapped AND _inview AND _src = ${fo} ORDER BY _id COLLATE "C" ASC LIMIT ${cap})
SELECT
  (SELECT count(*) FROM m WHERE _mapped) AS total,
  (SELECT count(*) FROM m WHERE NOT _mapped) AS unmapped,
  (SELECT count(*) FROM m WHERE _mapped AND _inview) AS in_view,
  (SELECT COALESCE(json_agg(r ORDER BY pg._end ASC, pg._id ASC), '[]'::json)
     FROM page pg CROSS JOIN LATERAL (SELECT ${cols} FROM public.recompete_opportunities x WHERE x."contract_id" = pg._id) r) AS pins,
  (SELECT COALESCE(json_agg(r ORDER BY f._id COLLATE "C" ASC), '[]'::json)
     FROM fo f CROSS JOIN LATERAL (SELECT ${cols} FROM public.recompete_opportunities x WHERE x."contract_id" = f._id) r) AS follow_ons${
    o.withMarketIds ? `,\n  (SELECT COALESCE(json_agg(_id ORDER BY _id ASC), '[]'::json) FROM m) AS market_ids` : ''}`;
  return { text, values: p.values };
}
