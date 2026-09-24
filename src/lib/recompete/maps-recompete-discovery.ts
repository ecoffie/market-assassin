/**
 * Maps Recompete → Canonical Discovery (Phase C2, 2026-09-22).
 *
 * The ONE place /api/app/recompete-map turns a request into a query. The canonical plan
 * (src/lib/discovery) owns what the Recompete market IS: free text (industry preset → term of art →
 * whole-word matcher), agency identity (multi-select = OR), query-named NAICS / PSC-crosswalk /
 * set-aside / state, exclusions, and the timing window (not expired; 18 months by policy). Everything
 * else on the request is Maps SURFACE policy that can only NARROW that market: the set-aside checkbox,
 * sub-agency, value range, contract-type (SAP) and likelihood filters, and the map_lat bound that
 * splits market truth into mappable / unmapped. Presentation (bbox, ordering, pin cap, follow-on
 * merge) stays in the route.
 *
 * Record: tasks/canonical-discovery-phase-c2-maps-recompete-2026-09-22.md
 */
import { buildDiscoveryPlan, applyRecompetePlan, MAPS_POLICY, contextFor, type DiscoveryInput, type DiscoveryPlan, type PlanContext, type SurfacePolicy } from '@/lib/discovery';
import { multiAgency } from '@/lib/opportunities/agency-match';
import { parentPrefilterExpr, parentScopeExpr, resolveParentScope, workScopeExprs, workTerms, type ParentScope } from '@/lib/vehicles/parent-scope';

type Get = (k: string) => string | null | undefined;

export interface MapsRecompeteSurface {
  /**
   * The Maps set-aside CHECKBOX value, applied as the pre-migration exact `set_aside_type` match.
   * ⚠️ Deliberately NOT passed to the plan: the plan's explicit-set-aside path is a raw substring
   * ILIKE built for MCP's free-text `set_aside`, so the Maps group key "SB" would match SDVOSB/WOSB
   * rows. The checkbox vocabulary (SB/8A/HZ vs stored "SB-Total"/"8(a)"/"HUBZone") is a separate,
   * pre-existing defect recorded in the Phase C2 record — not changed by this migration.
   */
  setAside: string;
  subAgency: string;
  minValue: number | null;
  maxValue: number | null;
  sap: '' | 'friendly' | 'gated';
  likelihood: '' | 'high';
  /**
   * Parent-contract / vehicle scope (`?vehicle=` or `?parent=`), resolved through the verified vehicle
   * registry. Applied INSIDE every read (a surface op), so counts, pins and pages all see the same
   * scoped market. `unresolved` → the route answers with a refinement and reads NOTHING.
   */
  parentScope: ParentScope;
  /** Work subject (`?work=`): every term must appear in a WORK field (description/NAICS/PSC text). */
  work: string;
}

export interface MapsRecompeteRequest {
  input: DiscoveryInput;
  policy: SurfacePolicy;
  plan: DiscoveryPlan;
  surface: MapsRecompeteSurface;
}

const num = (v: string | null | undefined) => {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Maps-only POSITIVE scopes on this horizon (Eric, 2026-09-22 rule B): set-aside, sub-agency and the
 * SAP (contract-type) control. Value range, likelihood and lead time are windows on the market, not a
 * market — they never make an exclusion-only query valid.
 */
export function mapsRecompeteSurfaceScope(s: MapsRecompeteSurface): string[] {
  const out: string[] = [];
  if (s.setAside) out.push('setAside');
  if (s.subAgency) out.push('subAgency');
  if (s.sap) out.push('sap');
  if (s.parentScope.status === 'resolved') out.push(s.parentScope.kind);
  if (workTerms(s.work).length) out.push('work');
  return out;
}

/**
 * Lead time is TIMING POLICY, never meaning: `leadMax=N` sets the recompete window to N months, the
 * same way MCP's `timeframe.recompete_months` does (1..60, default 18).
 */
export function mapsRecompetePolicy(get: Get): SurfacePolicy {
  const lead = num(get('leadMax'));
  const windowMonths = lead != null ? Math.min(60, Math.max(1, Math.round(lead))) : MAPS_POLICY.recompete.windowMonths;
  return { ...MAPS_POLICY, recompete: { windowMonths } };
}

export function mapsRecompeteRequest(get: Get, opts?: { ctx?: PlanContext }): MapsRecompeteRequest {
  const t = (k: string) => String(get(k) ?? '').trim();
  const sap = t('sap').toLowerCase();
  const surface: MapsRecompeteSurface = {
    setAside: t('setAside'),
    subAgency: t('subAgency'),
    minValue: num(get('minValue')),
    maxValue: num(get('maxValue')),
    sap: sap === 'friendly' || sap === 'gated' ? sap : '',
    likelihood: t('likelihood').toLowerCase() === 'high' ? 'high' : '',
    parentScope: resolveParentScope({ vehicle: t('vehicle'), parent: t('parent') }),
    work: t('work'),
  };
  const agencies = multiAgency(get('agency') ?? '');
  const input: DiscoveryInput = {
    query: t('q') || t('search'),
    // One buyer stays a string (identical to MCP); a multi-select is a list of distinct buyers, ORed.
    agency: agencies.length > 1 ? agencies : agencies[0] ?? null,
    state: t('state') || null,
    naics: t('naics') || null,
    psc: t('psc') || null,
    hasSurfaceScope: mapsRecompeteSurfaceScope(surface).length > 0,
  };
  const policy = mapsRecompetePolicy(get);
  return { input, policy, surface, plan: buildDiscoveryPlan(input, policy, opts?.ctx ?? contextFor()) };
}

/**
 * One canonical plan + the Maps surface filters on a recompete_opportunities query. Used by ALL
 * three Recompete paths (market total, unmapped count, viewport pins + follow-ons).
 *   mapped 'only' = rows the map can draw · 'none' = matching rows it cannot · 'any' = market truth.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyMapsRecompeteFilters(query: any, req: MapsRecompeteRequest, mapped: 'only' | 'none' | 'any' = 'only'): any {
  let q = applyRecompetePlan(query, req.plan);
  for (const o of mapsRecompeteSurfaceOps(req.surface, mapped)) q = applySurfaceOp(q, o);
  return q;
}

/**
 * The Maps SURFACE filters as data (Recompete Gate 2, 2026-09-24) — ONE definition consumed by both
 * appliers: the PostgREST builder above (the same calls, in the same order, as before this was data)
 * and the SQL twin (maps-recompete-sql.ts) that evaluates the market once. A surface filter added here
 * reaches both paths; one added to only one of them is exactly the drift the parity oracle exists for.
 */
export type SurfaceOp =
  | { op: 'notnull'; col: string }
  | { op: 'isnull'; col: string }
  | { op: 'eq'; col: string; val: string }
  | { op: 'ilike'; col: string; val: string }
  | { op: 'gte'; col: string; val: number }
  | { op: 'lte'; col: string; val: number }
  | { op: 'in'; col: string; vals: string[] }
  /** A PostgREST logic list (the plan's own `or` grammar) — the SQL twin serializes it via opSql. */
  | { op: 'or'; expr: string };

export function mapsRecompeteSurfaceOps(s: MapsRecompeteSurface, mapped: 'only' | 'none' | 'any'): SurfaceOp[] {
  const out: SurfaceOp[] = [];
  if (mapped === 'only') out.push({ op: 'notnull', col: 'map_lat' });
  else if (mapped === 'none') out.push({ op: 'isnull', col: 'map_lat' });
  if (s.setAside) out.push({ op: 'eq', col: 'set_aside_type', val: s.setAside });
  if (s.subAgency) out.push({ op: 'ilike', col: 'awarding_sub_agency', val: `%${s.subAgency}%` });
  if (s.minValue != null) out.push({ op: 'gte', col: 'potential_total_value', val: s.minValue });
  if (s.maxValue != null) out.push({ op: 'lte', col: 'potential_total_value', val: s.maxValue });
  if (s.sap === 'friendly') out.push({ op: 'in', col: 'contract_type', vals: ['PURCHASE ORDER', 'BPA CALL'] });
  else if (s.sap === 'gated') out.push({ op: 'eq', col: 'contract_type', val: 'DELIVERY ORDER' });
  if (s.likelihood === 'high') out.push({ op: 'eq', col: 'recompete_likelihood', val: 'high' });
  // Parent scope: resolved → the anchored parent-slot match; unresolved → select NOTHING (the route
  // short-circuits before reading, this is the belt to that brace — never "all vehicles").
  if (s.parentScope.status === 'resolved') {
    out.push({ op: 'or', expr: parentPrefilterExpr(s.parentScope.parents) });  // cheap superset, first
    out.push({ op: 'or', expr: parentScopeExpr(s.parentScope.parents) });      // exact parent slot
  }
  else if (s.parentScope.status === 'unresolved') out.push({ op: 'or', expr: parentScopeExpr([]) });
  for (const expr of workScopeExprs(s.work)) out.push({ op: 'or', expr });
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySurfaceOp(q: any, o: SurfaceOp): any {
  switch (o.op) {
    case 'notnull': return q.not(o.col, 'is', null);
    case 'isnull': return q.is(o.col, null);
    case 'eq': return q.eq(o.col, o.val);
    case 'ilike': return q.ilike(o.col, o.val);
    case 'gte': return q.gte(o.col, o.val);
    case 'lte': return q.lte(o.col, o.val);
    case 'in': return q.in(o.col, o.vals);
    case 'or': return q.or(o.expr);
  }
}

/** Additive `discovery` block on the API response (a blocked plan is never presented as a zero market). */
export function mapsRecompeteDiscoveryMeta(plan: DiscoveryPlan) {
  return {
    version: plan.version, status: plan.status, refinement: plan.refinement, via: plan.horizons.recompete.via,
    window_months: plan.policy.recompete.windowMonths,
  };
}
