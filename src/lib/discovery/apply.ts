/**
 * Plan → Supabase query. Mechanical only; every semantic decision was made in plan.ts.
 */
import { parseMapFilters, applyMapFilters, parseStateList } from '@/lib/opportunities/map-filters';
import { applyForecastFilters } from '@/lib/opportunities/map-data';
import type { DiscoveryPlan, Op } from './plan';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function applyOps(query: any, ops: Op[]): any {
  let q = query;
  for (const o of ops) {
    if (o.op === 'or') q = q.or(o.expr);
    else if (o.op === 'eq') q = q.eq(o.col, o.val);
    else if (o.op === 'is') q = q.is(o.col, o.val);
    else if (o.op === 'gte') q = q.gte(o.col, o.val);
    else if (o.op === 'lte') q = q.lte(o.col, o.val);
    else if (o.op === 'ilike') q = q.ilike(o.col, o.val);
  }
  return q;
}

/**
 * sam_opportunities. Non-query filters go through the shared applyMapFilters with q forced empty
 * and NO agency (the plan's word-bounded buyer op replaces agencyOrExpr's substring match).
 * ⚠️ applyMapFilters skips profile scope only when `search` is set; a caller adding profile scope
 * must pass it ONLY when the plan has no text/structured query (today's `!isActiveSearch` rule).
 */
export function applyOpenPlan(query: any, plan: DiscoveryPlan): any {
  const mf = plan.horizons.open.mapFilters;
  const f = parseMapFilters((k) => (k === 'q' || k === 'search' || k === 'agency' ? null : mf[k] ?? null));
  let q = applyMapFilters(query, f);
  const pop = placeOfPerformanceWinsExpr(parseStateList(mf.state ?? null) || []);
  if (pop) q = q.or(pop);
  return applyOps(q, plan.horizons.open.ops);
}

/**
 * FIND geography (Eric, 2026-11-16): a state-scoped answer never shows work performed in ANOTHER
 * state or territory. applyMapFilters admits "place of performance OR buying-office state", so a
 * Guaynabo, PR notice bought by USACE Jacksonville answered a Florida question. ANDed with that OR,
 * this predicate makes place of performance decide whenever it is known; the buying office stands
 * in only when SAM left place of performance empty (~64% of notices). Result:
 *   (pop ∈ S) OR (pop IS NULL AND office ∈ S).
 * Scoped to FIND (MCP find_opportunities + Ask Mindy); the shared stateOrExpr (Maps, saved-search
 * alerts) is unchanged. Empty list → null (the match-nothing sentinel is handled upstream).
 */
export function placeOfPerformanceWinsExpr(codes: string[]): string | null {
  if (!codes.length) return null;
  // The buying office stands in for an empty place of performance ONLY when the work is not stated to be
  // abroad (Agent 4, 2026-11-24): an MCC Zambia road study bought by a DC office passed a VA/MD/DC filter.
  // pop_country is ISO3 ('USA' = domestic, as the map's country filter uses); null = not stated → still kept.
  return `pop_state.in.(${codes.join(',')}),and(pop_state.is.null,or(pop_country.is.null,pop_country.eq.USA))`;
}

/** Post-fetch guard with the same rule, for every horizon: a row whose place-of-performance state is
 *  known and not one of the asked states is out of scope. Unknown location is kept (not guessed) — unless
 *  the row states a FOREIGN place-of-performance country (popCountry given, not null/USA): work stated to
 *  be abroad is never in a US state region, whatever the buying office. */
export function performedOutsideRegion(popState: unknown, states: string[], popCountry?: unknown): boolean {
  if (!states.length) return false;
  const st = String(popState ?? '').trim().toUpperCase();
  if (st !== '') return !states.includes(st);
  const country = String(popCountry ?? '').trim().toUpperCase();
  return country !== '' && country !== 'USA';
}

export function applyRecompetePlan(query: any, plan: DiscoveryPlan): any {
  return applyOps(query, plan.horizons.recompete.ops);
}

/** agency_forecasts. applyForecastFilters owns naics/agency (identity-resolved)/state; q is always null. */
export function applyForecastPlan(query: any, plan: DiscoveryPlan): any {
  return applyOps(applyForecastFilters(query, plan.horizons.forecast.forecastFilters), plan.horizons.forecast.ops);
}
