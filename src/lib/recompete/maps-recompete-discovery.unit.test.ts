/**
 * Maps Recompete adapter contract (Phase C2, 2026-09-22). Hermetic: a recording stub stands in for
 * the Supabase builder, so these assert exactly which predicates /api/app/recompete-map sends.
 */
import { describe, it, expect } from 'vitest';
import { mapsRecompeteRequest, applyMapsRecompeteFilters, mapsRecompeteSurfaceScope } from './maps-recompete-discovery';
import { buildDiscoveryPlan, MCP_POLICY, type PlanContext } from '@/lib/discovery';

const CTX: PlanContext = { today: '2026-09-22', fiscalYear: 2026 };
type Call = { m: string; a: unknown[] };
function stub() {
  const calls: Call[] = [];
  const q: Record<string, unknown> = {};
  for (const m of ['eq', 'gt', 'lt', 'or', 'in', 'not', 'lte', 'gte', 'neq', 'is', 'ilike']) q[m] = (...a: unknown[]) => { calls.push({ m, a }); return q; };
  return { q, calls };
}
const req = (params: Record<string, string>) => mapsRecompeteRequest((k) => params[k] ?? null, { ctx: CTX });
const run = (params: Record<string, string>, mapped: 'only' | 'none' | 'any' = 'only') => {
  const r = req(params);
  const s = stub();
  applyMapsRecompeteFilters(s.q, r, mapped);
  return { r, calls: s.calls, ors: s.calls.filter((c) => c.m === 'or').map((c) => String(c.a[0])) };
};
const has = (calls: Call[], m: string, col: string, val?: unknown) => calls.some((c) => c.m === m && c.a[0] === col && (val === undefined || JSON.stringify(c.a[1]) === JSON.stringify(val)));

describe('the Recompete MARKET is the canonical plan (MCP is the reference)', () => {
  it('no Maps surface filter → exactly MCP\'s recompete ops, in order', () => {
    for (const q of ['janitorial', 'cybersecurity', 'ai governance', '541512', 'USDA -computers', 'Naval facilities in Nevada']) {
      const mcp = buildDiscoveryPlan({ query: q }, MCP_POLICY, CTX).horizons.recompete.ops;
      expect(req({ q }).plan.horizons.recompete.ops, q).toEqual(mcp);
    }
  });
  it('janitorial = the canonical industry preset + 18-month window (never the old keyword ilike)', () => {
    const { r, ors, calls } = run({ q: 'janitorial' }, 'any');
    expect(r.plan.horizons.recompete.via).toBe('industry_preset');
    expect(ors.join()).toMatch(/naics_code\.eq\.561720/);
    expect(ors.join()).not.toMatch(/incumbent_name\.ilike/);
    expect(has(calls, 'gte', 'period_of_performance_current_end', '2026-09-22')).toBe(true);
    expect(has(calls, 'lte', 'period_of_performance_current_end', '2028-03-22')).toBe(true);
  });
  it('agency is whole-word identity over agency AND sub-agency; a multi-select is ORed', () => {
    const one = run({ agency: 'VA' }).ors.join();
    expect(one).not.toMatch(/ilike\.%VA%/i);
    expect(one).toMatch(/awarding_sub_agency/);
    const multi = req({ agency: 'AGRICULTURE|VETERANS AFFAIRS' });
    expect(multi.input.agency).toEqual(['AGRICULTURE', 'VETERANS AFFAIRS']);
    expect(multi.plan.buyers).toHaveLength(2);
  });
  it('an explicit NAICS filter ANDs with the query (the old route silently dropped q)', () => {
    const { ors } = run({ q: 'janitorial', naics: '561720' });
    expect(ors).toContain('naics_code.eq.561720');
    expect(ors.some((e) => /561730/.test(e))).toBe(true); // the query's preset still applies
  });
  it('past contracts are never in the market (includePast retired)', () => {
    const { calls } = run({ q: 'janitorial', includePast: '1' });
    expect(has(calls, 'gte', 'period_of_performance_current_end', '2026-09-22')).toBe(true);
  });
});

describe('timing is policy: leadMax sets the window, never the meaning', () => {
  it('leadMax=6 → a 6-month window; same ops otherwise', () => {
    const six = req({ q: 'janitorial', leadMax: '6' });
    const base = req({ q: 'janitorial' });
    expect(six.policy.recompete.windowMonths).toBe(6);
    const notWindow = (o: { op: string; col?: string }) => !(o.op === 'lte' && o.col === 'period_of_performance_current_end');
    expect(six.plan.horizons.recompete.ops.filter(notWindow)).toEqual(base.plan.horizons.recompete.ops.filter(notWindow));
    expect(six.plan.horizons.recompete.ops).toContainEqual({ op: 'lte', col: 'period_of_performance_current_end', val: '2027-03-22' });
  });
  it('garbage leadMax falls back to the 18-month policy', () => expect(req({ leadMax: 'abc' }).policy.recompete.windowMonths).toBe(18));
});

describe('positive-scope rule (Eric, 2026-09-22)', () => {
  it.each([['setAside', 'SDVOSB'], ['subAgency', 'Forest Service'], ['sap', 'friendly']])('%s qualifies', (k, v) =>
    expect(req({ q: '-computers', [k]: v }).plan.status).toBe('ok'));
  it.each(['541512 -computers', 'USDA -computers', 'SDVOSB -computers'])('%s is valid on its own', (q) => expect(req({ q }).plan.status).toBe('ok'));
  it('naked -computers → needs_positive_scope, and the query fails CLOSED', () => {
    const { r, calls } = run({ q: '-computers' }, 'any');
    expect(r.plan.status).toBe('needs_positive_scope');
    expect(has(calls, 'is', 'contract_id', null)).toBe(true);
  });
  it('value / likelihood / lead time never qualify', () => {
    const r = req({ q: '-computers', minValue: '1000000', maxValue: '9000000', likelihood: 'high', leadMax: '6' });
    expect(mapsRecompeteSurfaceScope(r.surface)).toEqual([]);
    expect(r.plan.status).toBe('needs_positive_scope');
  });
});

describe('surface filters and presentation are preserved', () => {
  it('set-aside checkbox, sub-agency, value, SAP, likelihood apply exactly as before', () => {
    const { calls } = run({ setAside: 'SDVOSB', subAgency: 'Forest Service', minValue: '100', maxValue: '900', sap: 'friendly', likelihood: 'high' });
    expect(has(calls, 'eq', 'set_aside_type', 'SDVOSB')).toBe(true);
    expect(has(calls, 'ilike', 'awarding_sub_agency', '%Forest Service%')).toBe(true);
    expect(has(calls, 'gte', 'potential_total_value', 100)).toBe(true);
    expect(has(calls, 'lte', 'potential_total_value', 900)).toBe(true);
    expect(has(calls, 'in', 'contract_type', ['PURCHASE ORDER', 'BPA CALL'])).toBe(true);
    expect(has(calls, 'eq', 'recompete_likelihood', 'high')).toBe(true);
  });
  it('the set-aside checkbox never reaches the plan (its raw ILIKE would make SB match SDVOSB)', () => {
    const r = req({ setAside: 'SB' });
    expect(r.input.setAside).toBeUndefined();
    expect(JSON.stringify(r.plan.horizons.recompete.ops)).not.toMatch(/set_aside_type/);
  });
  it('mapped splits ONE market: only = drawable, none = not drawable, any = market truth', () => {
    expect(has(run({ q: 'janitorial' }, 'only').calls, 'not', 'map_lat')).toBe(true);
    expect(has(run({ q: 'janitorial' }, 'none').calls, 'is', 'map_lat', null)).toBe(true);
    const any = run({ q: 'janitorial' }, 'any').calls;
    expect(any.some((c) => c.a[0] === 'map_lat')).toBe(false);
  });
});
