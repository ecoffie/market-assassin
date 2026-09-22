/**
 * Plan → Supabase query. Mechanical only; every semantic decision was made in plan.ts.
 */
import { parseMapFilters, applyMapFilters } from '@/lib/opportunities/map-filters';
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
  return applyOps(applyMapFilters(query, f), plan.horizons.open.ops);
}

export function applyRecompetePlan(query: any, plan: DiscoveryPlan): any {
  return applyOps(query, plan.horizons.recompete.ops);
}

/** agency_forecasts. applyForecastFilters owns naics/agency (identity-resolved)/state; q is always null. */
export function applyForecastPlan(query: any, plan: DiscoveryPlan): any {
  return applyOps(applyForecastFilters(query, plan.horizons.forecast.forecastFilters), plan.horizons.forecast.ops);
}
