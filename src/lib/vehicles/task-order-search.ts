/**
 * Parent-contract / vehicle–scoped TASK-ORDER search — the shared read behind MCP
 * `search_idv_contracts` (when `vehicle` / `parent_id` is given) and, by construction, the Opportunity
 * Map's Awarded layer: both build their request with `mapsRecompeteRequest` and filter with
 * `applyMapsRecompeteFilters`, so the plan, the parent scope, the work subject, the timing window and
 * the page order are the SAME code. Every filter is applied INSIDE the query, before counting, ordering
 * and pagination.
 *
 * Population (stated in every result, never implied): orders in `recompete_opportunities` — task /
 * delivery orders whose period of performance has NOT ended and ends within `lead_months` (default
 * 60, the Map maximum). Historical, completed orders are not in this population.
 *
 * What a result distinguishes (and never collapses into "0"):
 *   unresolved              — the vehicle/parent could not be established; nothing was searched
 *   ok                      — matching orders under verified parents
 *   zero_matching_orders    — the parent scope HAS orders in the population; none match the work/filters
 *   no_parent_orders        — the parent scope has NO orders in the population (not evidence that none exist)
 *   unattributed_orders     — separately: orders matching the work/filters whose parent is NOT recorded,
 *                             so they cannot be attributed to any vehicle (neither included nor denied)
 */
import { createClient } from '@supabase/supabase-js';
import { applyMapsRecompeteFilters, mapsRecompeteRequest, type MapsRecompeteRequest } from '@/lib/recompete/maps-recompete-discovery';
import { parentScopeMeta } from '@/lib/recompete/recompete-map-paths';
import { UNATTRIBUTED_ORDERS_OR, parentIdOf, recordedParent, workEvidence, workTerms } from './parent-scope';
import { vehicleOfParent } from './registry';

export const MINDY_MAP_BASE = 'https://getmindy.ai/opportunity-map';
export const DEFAULT_LEAD_MONTHS = 60;

export interface ScopedTaskOrderInput {
  vehicle?: string;
  /** Exact parent id(s), comma list: CONT_IDV_<PIID>_<AGENCY>. A bare PIID is resolved to its agency. */
  parent_id?: string;
  work?: string;
  naics?: string;
  agency?: string;
  state?: string;
  lead_months?: number;
  limit?: number;
  page?: number;
}

export interface ScopedTaskOrderRow {
  contract_id: string;
  piid: string | null;
  recipient_name: string | null;
  recipient_uei: string | null;
  agency: string | null;
  sub_agency: string | null;
  description: string | null;
  naics_code: string | null;
  naics_description: string | null;
  psc_description: string | null;
  potential_total_value: number | null;
  total_obligation: number | null;
  period_end: string | null;
  place_of_performance_state: string | null;
  on_map: boolean;
  parent: { parent_id: string; source: 'contract_id'; vehicle: ReturnType<typeof vehicleOfParent> };
  work_evidence: { term: string; fields: string[] }[];
  usaspending_url: string;
}

export type ScopedStatus = 'ok' | 'zero_matching_orders' | 'no_parent_orders' | 'unresolved' | 'needs_refinement' | 'degraded';

export interface ScopedTaskOrderResult {
  status: ScopedStatus;
  reason: string | null;
  scope: ReturnType<typeof parentScopeMeta>;
  population: string;
  total: number | null;
  mapped_total: number | null;
  unmapped_total: number | null;
  parent_orders_in_population: number | null;
  unattributed_orders: number | null;
  page: number;
  limit: number;
  has_next_page: boolean;
  orders: ScopedTaskOrderRow[];
  map_url: string | null;
}

const COLS = 'contract_id, piid, incumbent_name, incumbent_uei, awarding_agency, awarding_sub_agency, description, '
  + 'naics_code, naics_description, psc_description, potential_total_value, total_obligation, '
  + 'period_of_performance_current_end, place_of_performance_state, map_lat';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };
function defaultDb(): Db {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** The request params, exactly as the Map API reads them (`?vehicle= ?parent= ?work= ?naics= …`). */
export function scopedParams(input: ScopedTaskOrderInput & { parent?: string }): Record<string, string> {
  const out: Record<string, string> = {};
  const lead = Math.min(60, Math.max(1, Math.round(input.lead_months ?? DEFAULT_LEAD_MONTHS)));
  if (input.vehicle) out.vehicle = input.vehicle.trim();
  if (input.parent) out.parent = input.parent;
  if (input.work?.trim()) out.work = input.work.trim();
  if (input.naics?.trim()) out.naics = input.naics.trim();
  if (input.agency?.trim()) out.agency = input.agency.trim();
  if (input.state?.trim()) out.state = input.state.trim().toUpperCase();
  out.leadMax = String(lead);
  return out;
}

/**
 * The shared Map link. `mode=recompete&horizon=recompete` isolates the Awarded horizon so no other
 * horizon's unscoped rows are summed into the headline; every scope param is the one the API reads.
 */
export function scopedMapUrl(params: Record<string, string>): string {
  const u = new URLSearchParams({ mode: 'recompete', horizon: 'recompete', ...params });
  return `${MINDY_MAP_BASE}?${u.toString().replace(/%2C/g, ',')}`;
}

/** Bare PIID → the parent agencies it appears under in the population (the agency slot is identity). */
async function parentAgenciesForPiid(db: Db, piid: string): Promise<string[] | null> {
  const safe = piid.replace(/[^0-9A-Z-]/g, '');
  const { data, error } = await db.from('recompete_opportunities').select('contract_id')
    .filter('contract_id', 'match', `^CONT_AWD_.+_[0-9A-Z]{4}_${safe.replace(/-/g, '\\-')}_[0-9A-Z]{4}$`).limit(1000);
  if (error) { console.error('[task-order-search] piid agency lookup failed:', error.message); return null; }
  return [...new Set((data ?? []).map((r: { contract_id: string }) => recordedParent(r.contract_id)?.agency).filter(Boolean) as string[])].sort();
}

async function headCount(q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number | null> {
  const { count, error } = await q;
  if (error) { console.error('[task-order-search] count failed:', error.message); return null; }
  return count ?? null; // null = UNKNOWN, never 0 (Bug Prevention Rule #11)
}

function base(req: MapsRecompeteRequest, status: ScopedStatus, reason: string | null, page: number, limit: number, mapUrl: string | null): ScopedTaskOrderResult {
  return {
    status, reason, scope: parentScopeMeta(req.surface.parentScope, req.surface.work),
    population: `Active task/delivery orders in Mindy's Awarded table: period of performance not ended and ending within ${req.policy.recompete.windowMonths} months. Completed orders are not included.`,
    total: null, mapped_total: null, unmapped_total: null, parent_orders_in_population: null, unattributed_orders: null,
    page, limit, has_next_page: false, orders: [], map_url: mapUrl,
  };
}

export async function searchScopedTaskOrders(input: ScopedTaskOrderInput, db: Db = defaultDb()): Promise<ScopedTaskOrderResult> {
  const limit = Math.min(100, Math.max(1, Math.round(input.limit ?? 25)));
  const page = Math.max(1, Math.round(input.page ?? 1));

  // Exact parent: a bare PIID is resolved to its agency ONLY when exactly one agency carries it.
  let parent = input.parent_id?.trim() || undefined;
  let bareReason: string | null = null;
  if (parent && !input.vehicle) {
    const resolved: string[] = [];
    for (const raw of parent.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)) {
      if (raw.startsWith('CONT_IDV_')) { resolved.push(raw); continue; }
      const ags = await parentAgenciesForPiid(db, raw);
      if (ags == null) { bareReason = `Could not look up parent PIID ${raw} (database error) — pass the full id CONT_IDV_${raw}_<AGENCY>.`; break; }
      if (ags.length === 1) resolved.push(`CONT_IDV_${raw}_${ags[0]}`);
      else if (ags.length > 1) { bareReason = `PIID ${raw} appears as a parent under ${ags.length} agencies (${ags.join(', ')}); pass one exact id: ${ags.map((a) => `CONT_IDV_${raw}_${a}`).join(' or ')}.`; break; }
      else { bareReason = `No orders in the population record PIID ${raw} as their parent, so its agency cannot be established. Pass the full id CONT_IDV_${raw}_<AGENCY>.`; break; }
    }
    if (!bareReason) parent = resolved.join(',');
  }

  const params = scopedParams({ ...input, parent: bareReason ? `INVALID:${parent}` : parent });
  const req = mapsRecompeteRequest((k) => params[k]);
  const mapUrl = req.surface.parentScope.status === 'resolved' || req.surface.parentScope.status === 'none' ? scopedMapUrl(params) : null;

  if (req.surface.parentScope.status === 'unresolved') {
    const r = base(req, 'unresolved', bareReason ?? req.surface.parentScope.reason, page, limit, null);
    return r;
  }
  if (req.plan.status !== 'ok') {
    return base(req, 'needs_refinement', req.plan.refinement ?? 'The query cannot define a market.', page, limit, null);
  }

  const table = () => db.from('recompete_opportunities');
  const head = () => table().select('contract_id', { count: 'exact', head: true });

  // The same scoped market as the Map: market truth ('any'), mapped ('only'), unmapped ('none').
  const [total, mapped, unmapped] = await Promise.all([
    headCount(applyMapsRecompeteFilters(head(), req, 'any')),
    headCount(applyMapsRecompeteFilters(head(), req, 'only')),
    headCount(applyMapsRecompeteFilters(head(), req, 'none')),
  ]);

  // Coverage: the parent scope alone (same window, no work/NAICS/agency/state) …
  const scopeOnly = scopedParams({ vehicle: input.vehicle, parent, lead_months: input.lead_months });
  const parentReq = mapsRecompeteRequest((k) => scopeOnly[k]);
  // … and the orders matching the SAME work/filters whose parent is not recorded at all.
  const noScope = { ...params }; delete noScope.vehicle; delete noScope.parent;
  const unattrReq = mapsRecompeteRequest((k) => noScope[k]);
  const [parentOrders, unattributed] = await Promise.all([
    headCount(applyMapsRecompeteFilters(head(), parentReq, 'any')),
    unattrReq.plan.status === 'ok'
      ? headCount(applyMapsRecompeteFilters(head(), unattrReq, 'any').or(UNATTRIBUTED_ORDERS_OR))
      : Promise.resolve(null),
  ]);

  // Page: the Map's deterministic order (expiry, then contract_id), filtered BEFORE the range.
  const { data, error } = await applyMapsRecompeteFilters(table().select(COLS), req, 'any')
    .order('period_of_performance_current_end', { ascending: true })
    .order('contract_id', { ascending: true })
    .range((page - 1) * limit, page * limit - 1);

  const out = base(req, 'ok', null, page, limit, mapUrl);
  out.total = total; out.mapped_total = mapped; out.unmapped_total = unmapped;
  out.parent_orders_in_population = parentOrders; out.unattributed_orders = unattributed;
  if (error || total == null) {
    if (error) console.error('[task-order-search] page read failed:', error.message);
    return { ...out, status: 'degraded', reason: 'The scoped order read failed — retry; do not report zero orders.' };
  }
  const work = req.surface.work;
  out.orders = (data ?? []).map((r: Record<string, unknown>) => {
    const cid = String(r.contract_id);
    const p = recordedParent(cid)!; // the scope op only admits rows with a recorded parent
    return {
      contract_id: cid,
      piid: (r.piid as string) ?? null,
      recipient_name: (r.incumbent_name as string) ?? null,
      recipient_uei: (r.incumbent_uei as string) ?? null,
      agency: (r.awarding_agency as string) ?? null,
      sub_agency: (r.awarding_sub_agency as string) ?? null,
      description: (r.description as string) ?? null,
      naics_code: (r.naics_code as string) ?? null,
      naics_description: (r.naics_description as string) ?? null,
      psc_description: (r.psc_description as string) ?? null,
      potential_total_value: r.potential_total_value == null ? null : Number(r.potential_total_value),
      total_obligation: r.total_obligation == null ? null : Number(r.total_obligation),
      period_end: (r.period_of_performance_current_end as string) ?? null,
      place_of_performance_state: (r.place_of_performance_state as string) ?? null,
      on_map: r.map_lat != null,
      parent: { parent_id: parentIdOf(p), source: 'contract_id' as const, vehicle: vehicleOfParent(parentIdOf(p)) },
      work_evidence: workTerms(work).length ? workEvidence(r, work) : [],
      usaspending_url: `https://www.usaspending.gov/award/${encodeURIComponent(cid)}`,
    };
  });
  out.has_next_page = page * limit < total;
  if (total === 0) {
    if (parentOrders === 0) {
      out.status = 'no_parent_orders';
      out.reason = 'The requested parent/vehicle has no orders in this population (active orders ending within the window). That is a coverage statement, not evidence that no orders exist.';
    } else if (parentOrders != null) {
      out.status = 'zero_matching_orders';
      out.reason = `The parent/vehicle has ${parentOrders} order(s) in this population; none match the work subject/filters.`;
    } else {
      out.status = 'degraded';
      out.reason = 'Zero matches, but the parent-scope count failed — cannot tell a coverage gap from zero.';
    }
  }
  return out;
}
