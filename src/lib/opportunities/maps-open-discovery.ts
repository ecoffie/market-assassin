/**
 * Maps Open → Canonical Discovery (Phase C, 2026-09-22).
 *
 * The ONE place /api/app/opportunity-map turns a request into a query. The canonical plan
 * (src/lib/discovery) owns what the query MEANS — free text, agency, query-named NAICS / PSC /
 * set-aside / state, exclusions. Everything else on the request is Maps SURFACE policy and still
 * goes through the shared applyMapFilters, with the plan-owned keys (`q`/`search`, `agency`) blanked
 * so its legacy search brain (buildSearchOr / resolveQueryIntent / substring agencyOrExpr) never runs.
 *
 * applyMapFilters itself is untouched: saved searches, alert crons, the market dashboard and CAI still
 * call it with a live `search`. Those migrate in their own phases.
 *
 * Record: tasks/canonical-discovery-phase-c-maps-open-2026-09-22.md
 */
import { buildDiscoveryPlan, applyOps, MAPS_POLICY, contextFor, type DiscoveryInput, type DiscoveryPlan, type PlanContext } from '@/lib/discovery';
import { applyMapFilters, parseMapFilters, multiVal, type MapFilters } from './map-filters';
import { multiAgency } from './agency-match';

type Get = (k: string) => string | null | undefined;

export interface MapsOpenRequest {
  /** Surface filters as parsed today. `search`/`agency` are still present here for inspection only. */
  filters: MapFilters;
  input: DiscoveryInput;
  plan: DiscoveryPlan;
}

/**
 * Maps-only POSITIVE scopes (Eric, 2026-09-22): a filter qualifies only if it positively identifies a
 * market, buyer or supplier-fit universe. NAICS / PSC / state / agency / concepts are already
 * positive inside the canonical plan. Notice type, posted/closing windows, docs, contact, country and
 * hide-commodity are freshness/presentation and never make an exclusion-only query valid.
 */
export function mapsSurfaceScope(f: MapFilters): string[] {
  const s: string[] = [];
  if (multiVal(f.setAside).length) s.push('setAside');
  if (f.fullOpen) s.push('fullOpen');
  if (f.strategy.length) s.push('strategy');
  if (multiVal(f.subAgency).length) s.push('subAgency');
  if (f.sapBuyer) s.push('sapBuyer');
  if (f.profileNaics.length || f.profileStates.length) s.push('profile');
  return s;
}

/** Request params (+ resolved profile) → canonical input + plan under MAPS_POLICY. */
export function mapsOpenRequest(
  get: Get,
  opts?: { profileNaics?: string[]; profileStates?: string[]; ctx?: PlanContext },
): MapsOpenRequest {
  const filters = parseMapFilters(get, { profileNaics: opts?.profileNaics, profileStates: opts?.profileStates });
  const t = (k: string) => String(get(k) ?? '').trim() || null;
  const agencies = multiAgency(get('agency') ?? '');
  const input: DiscoveryInput = {
    query: String(filters.search || '').trim(),
    // One buyer stays a string (identical to MCP); a multi-select is a list of distinct buyers, ORed.
    agency: agencies.length > 1 ? agencies : agencies[0] ?? null,
    state: t('state'),
    setAside: t('setAside'),
    naics: t('naics'),
    psc: t('psc'),
    hasSurfaceScope: mapsSurfaceScope(filters).length > 0,
  };
  return { filters, input, plan: buildDiscoveryPlan(input, MAPS_POLICY, opts?.ctx ?? contextFor()) };
}

/**
 * Does the QUERY itself say which market? (Anything beyond exclusions.) Profile scope is suppressed
 * only then — the pre-migration rule "an explicit search escapes profile scope". An exclusion-only
 * query that is valid BECAUSE of the profile keeps the profile: dropping it would turn
 * "profile − computers" into "whole federal market − computers", i.e. broaden it.
 */
export function queryNamesMarket(plan: DiscoveryPlan): boolean {
  const i = plan.intent;
  return plan.matcher.mode !== 'none' || i.agencies.length > 0 || i.states.length > 0
    || i.setAsides.length > 0 || i.naics.length > 0 || i.psc.length > 0;
}

/**
 * Apply one canonical plan + the Maps surface filters to a sam_opportunities query. Used by ALL
 * three Open paths (headline count, unmapped count, viewport pins) so they can never disagree.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyMapsOpenFilters(query: any, req: MapsOpenRequest): any {
  const { filters: f, plan } = req;
  const mf = plan.horizons.open.mapFilters;
  const escapeProfile = queryNamesMarket(plan);
  const surface: MapFilters = {
    ...f,
    search: '',               // plan-owned: text, query-named codes/set-asides/buyers/exclusions
    agency: '',               // plan-owned: whole-word buyer identity, never substring
    state: mf.state ?? '',    // request state ∪ state named in the query ("… in Nevada")
    psc: mf.psc ?? '',        // request PSC ∪ PSC named in the query
    profileNaics: escapeProfile ? [] : f.profileNaics,
    profileStates: escapeProfile ? [] : f.profileStates,
  };
  return applyOps(applyMapFilters(query, surface), plan.horizons.open.ops);
}

/** The additive `discovery` block on the API response (status is never presented as a zero market). */
export function mapsOpenDiscoveryMeta(plan: DiscoveryPlan) {
  return { version: plan.version, status: plan.status, refinement: plan.refinement, via: plan.horizons.open.via };
}

/**
 * Does this Open plan evaluate a REGEX (`imatch` / `match`) against the corpus? (#1696)
 *
 * Cost signal only — never meaning. A text/buyer/exclusion predicate is a `~*` over title,
 * description, sow_text, department and solicitation_number: ~1.1 s of DB CPU per pass over the
 * ~8.7k open rows (description/sow_text are TOASTed and detoasted per reference). The route uses
 * this to evaluate that predicate ONCE per request instead of once for the headline count and
 * again for the viewport. Both strategies return identical rows; see maps-open-viewport.ts.
 */
export function openPlanScansText(req: MapsOpenRequest): boolean {
  return (req.plan.horizons.open.ops as Array<{ expr?: unknown }>).some(
    (o) => typeof o.expr === 'string' && /\.i?match\./.test(o.expr),
  );
}
