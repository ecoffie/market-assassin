/**
 * /api/app/recompete-map — the two read paths + the ONE response builder (Gate 2 rollout, 2026-09-24).
 *
 *   readOld  — the PostgREST multi-read path, moved VERBATIM out of the route (same calls, same order,
 *              same null handling). It stays the rollback until production acceptance is complete.
 *   readNew  — compute-once (compute-once-pg.ts): one read-only statement from the same plan.
 *   buildRecompeteMapBody — the ONLY place the user-visible payload is assembled, so both paths cannot
 *              drift in presentation (merge/dedupe, toPin, capped, null-vs-0 rules).
 *   compareReads — what the shadow/verify comparison checks, field by field.
 */
import { applyMapsRecompeteFilters, mapsRecompeteDiscoveryMeta, type MapsRecompeteRequest } from './maps-recompete-discovery';
import { RECOMPETE_PIN_COLS, toPin } from './map-pin';
import { fetchFollowOnRows } from './map-follow-ons';
import { runComputeOnce } from './compute-once-pg';
import { parentIdOf, workTerms, type ParentScope } from '@/lib/vehicles/parent-scope';

export const MAX_PINS = 1000;
type Row = Record<string, unknown>;
export type BBox = { west: number; south: number; east: number; north: number };

/** What one path read. null = the count query failed (UNKNOWN — never shown as 0; Bug Prevention #11). */
export interface MarketRead {
  total: number | null;
  unmapped: number | null;
  inView: number | null;
  pins: Row[];
  followOns: Row[];
  ms: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

/**
 * `counts: false` = Maps P0's `?counts=0` (map-counts-mode.ts): the client already holds this intent's
 * market truth, so a pan skips the two bbox-independent head counts. total/unmapped come back null here
 * and the body OMITS them (countsSkipped) — they never reach the user as 0 or unknown.
 */
export interface ReadOpts { counts?: boolean }

export async function readOld(db: Db, req: MapsRecompeteRequest, b: BBox, opts: ReadOpts = {}): Promise<MarketRead> {
  const withCounts = opts.counts !== false;
  const t0 = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (q: any, mapped: 'only' | 'none' = 'only') => applyMapsRecompeteFilters(q, req, mapped);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bbox = (q: any) => q.gte('map_lat', b.south).lte('map_lat', b.north).gte('map_lng', b.west).lte('map_lng', b.east);

  const totalForFiltersHead = applyFilters(db.from('recompete_opportunities').select('contract_id', { count: 'exact', head: true }));
  // THE MAP-TRUTH CONTRACT — rows matching the filters that the map CANNOT DRAW (map_lat IS NULL).
  const unmappedHead = applyFilters(db.from('recompete_opportunities').select('contract_id', { count: 'exact', head: true }), 'none');
  const countsP = withCounts ? Promise.all([totalForFiltersHead, unmappedHead]) : Promise.resolve(null);

  // DETERMINISTIC PAGE (Gate 1): expiry date, then contract_id as a tie-breaker only.
  const viewQ = bbox(applyFilters(db.from('recompete_opportunities').select(RECOMPETE_PIN_COLS, { count: 'exact' })))
    .order('period_of_performance_current_end', { ascending: true })
    .order('contract_id', { ascending: true })
    .limit(MAX_PINS);
  // Follow-ons: planner-independent two-step read (map-follow-ons.ts). Fail-soft — never takes down pins.
  const followOnP = fetchFollowOnRows({
    from: () => db.from('recompete_opportunities'),
    applyPlan: (q) => applyFilters(q),
    bbox, cols: RECOMPETE_PIN_COLS, cap: MAX_PINS,
  }).catch((e: Error) => { console.error('[recompete-map] follow-ons failed (pins unaffected):', e.message); return [] as Row[]; });
  // The counts run CONCURRENTLY with the viewport reads (P0), not as a phase before them.
  const [counts, [{ data, count: totalInView, error }, followOns]] = await Promise.all([countsP, Promise.all([viewQ, followOnP])]);
  if (error) throw error;
  const totalForFilters = counts ? counts[0].count : null;
  const unmappedForFilters = counts ? counts[1].count : null;
  return {
    total: totalForFilters ?? null, unmapped: unmappedForFilters ?? null, inView: totalInView ?? null,
    pins: (data || []) as Row[], followOns: followOns as Row[], ms: Date.now() - t0,
  };
}

export async function readNew(req: MapsRecompeteRequest, b: BBox, opts: ReadOpts = {}, timeoutMs?: number): Promise<MarketRead> {
  const r = await runComputeOnce(req, { bbox: b, cap: MAX_PINS, pinCols: RECOMPETE_PIN_COLS }, timeoutMs);
  // One pass computes the counts anyway; with counts:false they are dropped so both paths return the same shape.
  const withCounts = opts.counts !== false;
  return { total: withCounts ? r.total : null, unmapped: withCounts ? r.unmapped : null, inView: r.inView, pins: r.pins, followOns: r.followOns, ms: r.ms };
}

/**
 * The parent/vehicle scope as the response states it — how the scope was established, never a bare
 * label. null when the request carried no scope (the body is then byte-identical to before).
 */
export function parentScopeMeta(scope: ParentScope, work: string) {
  const terms = workTerms(work);
  if (scope.status === 'none') return terms.length ? { status: 'none' as const, work_terms: terms } : null;
  if (scope.status === 'unresolved') {
    return { status: 'unresolved' as const, kind: scope.kind, requested: scope.requested, reason_code: scope.reason_code, reason: scope.reason, candidates: scope.candidates ?? null, work_terms: terms };
  }
  const v = scope.vehicle;
  return {
    status: 'resolved' as const, kind: scope.kind, label: scope.label, requested: scope.requested,
    parents_in_scope: scope.parents.length,
    parent_ids: scope.kind === 'parent' ? scope.parents.map(parentIdOf) : undefined,
    solicitations: v ? v.vehicle.solicitations : undefined,
    membership: v ? { method: 'parent IDV solicitation_identifier ∈ vehicle solicitations (USASpending award record)', ...v.coverage } : undefined,
    work_terms: terms,
  };
}

/**
 * An UNRESOLVED parent/vehicle scope: nothing was searched, so there is no count and no pin. Uses the
 * canonical `needs_refinement` status the Map already renders as the refinement sentence (never "0").
 */
export function unresolvedScopeBody(req: MapsRecompeteRequest) {
  const meta = parentScopeMeta(req.surface.parentScope, req.surface.work)!;
  return {
    success: true, mode: 'recompete',
    discovery: { ...mapsRecompeteDiscoveryMeta(req.plan), status: 'needs_refinement', refinement: (meta as { reason?: string }).reason ?? '' },
    vehicle_scope: meta,
    totalForFilters: null, totalInView: null, capped: false, unmappedForFilters: null,
    pins: [],
  };
}

/** The user-visible payload — identical construction whichever path read the market. */
export function buildRecompeteMapBody(req: MapsRecompeteRequest, r: MarketRead, opts: ReadOpts = {}) {
  const withCounts = opts.counts !== false;
  const cid = (x: unknown) => String((x as { contract_id?: unknown }).contract_id ?? '');
  const rows = r.pins;
  // Captured follow-ons expire the LATEST, so the capped expiry-ascending page buries them; merge in any
  // the page missed, deduped by contract_id (Eric 2026-07-28).
  const seen = new Set(rows.map(cid));
  const extraFollowOns = r.followOns.filter((x) => !seen.has(cid(x)));
  const pins = [...rows, ...extraFollowOns].map(toPin);
  const scopeMeta = parentScopeMeta(req.surface.parentScope, req.surface.work);
  return {
    success: true, mode: 'recompete',
    // Canonical discovery status + the recompete window actually applied.
    discovery: mapsRecompeteDiscoveryMeta(req.plan),
    // counts=0 → the market-wide fields are OMITTED (never 0/null): the client holds them.
    ...(withCounts ? {} : { countsSkipped: true }),
    // A FAILED count is UNKNOWN (null), never 0 (Bug Prevention Rule #11): `?? 0` showed a timed-out scoped
    // count as "0 orders" while MCP reported the same read as degraded (#1692).
    totalForFilters: withCounts ? (r.total ?? null) : undefined, totalInView: r.inView ?? pins.length,
    capped: (r.inView ?? 0) > (rows.length),
    // null = UNKNOWN (the count failed), never 0 (Bug Prevention Rule #11).
    unmappedForFilters: withCounts ? (r.unmapped ?? null) : undefined,
    // Additive, and only when the request carried a parent/vehicle/work scope. Present on counted AND
    // count-skipped (counts=0) responses alike: the scope is a property of the request, not of the counts.
    ...(scopeMeta ? { vehicle_scope: scopeMeta } : {}),
    pins,
  };
}

export const COMPARED_FIELDS = [
  'market_total', 'mapped_total', 'unmapped_total', 'in_view_total',
  'pin_ids', 'pin_payload', 'follow_on_ids', 'discovery', 'response_body',
] as const;
export type ComparedField = typeof COMPARED_FIELDS[number];

/** Field-by-field comparison of two reads of the same request. Empty array = identical. */
export function compareReads(req: MapsRecompeteRequest, a: MarketRead, b: MarketRead): ComparedField[] {
  const ids = (xs: Row[]) => JSON.stringify(xs.map((x) => String(x.contract_id)));
  const market = (r: MarketRead) => (r.total == null || r.unmapped == null ? null : r.total + r.unmapped);
  const ba = buildRecompeteMapBody(req, a), bb = buildRecompeteMapBody(req, b);
  const out: ComparedField[] = [];
  if (market(a) !== market(b)) out.push('market_total');
  if (a.total !== b.total) out.push('mapped_total');
  if (a.unmapped !== b.unmapped) out.push('unmapped_total');
  if (a.inView !== b.inView) out.push('in_view_total');
  if (ids(a.pins) !== ids(b.pins)) out.push('pin_ids');
  if (JSON.stringify(a.pins) !== JSON.stringify(b.pins)) out.push('pin_payload');
  if (ids(a.followOns) !== ids(b.followOns)) out.push('follow_on_ids');
  if (JSON.stringify(ba.discovery) !== JSON.stringify(bb.discovery)) out.push('discovery');
  if (JSON.stringify(ba) !== JSON.stringify(bb)) out.push('response_body');
  return out;
}

/**
 * A difference caused ONLY by the old path losing a count (PostgREST statement timeout → null = UNKNOWN)
 * is old-path degradation, not a semantic mismatch. Measured in the 2026-09-24 shadow sample: under load
 * the authenticator role's 8 s statement_timeout dropped the broad-list total on the old path while
 * compute-once returned it. Strict test: the old side must carry a null count, and filling ONLY those
 * nulls from the new side must make the two reads byte-identical. Anything else stays a mismatch.
 */
export function isOldDegradedOnly(req: MapsRecompeteRequest, oldRead: MarketRead, newRead: MarketRead): boolean {
  if (oldRead.total != null && oldRead.unmapped != null && oldRead.inView != null) return false;
  const filled: MarketRead = {
    ...oldRead,
    total: oldRead.total ?? newRead.total,
    unmapped: oldRead.unmapped ?? newRead.unmapped,
    inView: oldRead.inView ?? newRead.inView,
  };
  return compareReads(req, filled, newRead).length === 0;
}
