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
  const s = req.surface;
  let q = applyRecompetePlan(query, req.plan);
  if (mapped === 'only') q = q.not('map_lat', 'is', null);
  else if (mapped === 'none') q = q.is('map_lat', null);
  if (s.setAside) q = q.eq('set_aside_type', s.setAside);
  if (s.subAgency) q = q.ilike('awarding_sub_agency', `%${s.subAgency}%`);
  if (s.minValue != null) q = q.gte('potential_total_value', s.minValue);
  if (s.maxValue != null) q = q.lte('potential_total_value', s.maxValue);
  if (s.sap === 'friendly') q = q.in('contract_type', ['PURCHASE ORDER', 'BPA CALL']);
  else if (s.sap === 'gated') q = q.eq('contract_type', 'DELIVERY ORDER');
  if (s.likelihood === 'high') q = q.eq('recompete_likelihood', 'high');
  return q;
}

/** Additive `discovery` block on the API response (a blocked plan is never presented as a zero market). */
export function mapsRecompeteDiscoveryMeta(plan: DiscoveryPlan) {
  return {
    version: plan.version, status: plan.status, refinement: plan.refinement, via: plan.horizons.recompete.via,
    window_months: plan.policy.recompete.windowMonths,
  };
}
