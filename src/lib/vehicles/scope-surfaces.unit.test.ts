/**
 * The parent/vehicle + work scope reaches EVERY Awarded reader as the same surface ops:
 * the Maps request builder, the PostgREST applier, the SQL twin (compute-once), the unresolved
 * short-circuit body, and the shared map link. Hermetic (registry mocked, no DB).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/data/vehicles/vehicle-parents.json', () => ({
  default: {
    verified_at: '2026-09-24T00:00:00.000Z', source: 'test', candidate_population: 'test', candidates: 2, unresolved_candidates: 0,
    vehicles: { oasis_plus: { members: [
      { parent_id: 'CONT_IDV_47QRCA25DA002_4732', solicitation_identifier: '47QRCA23R0002', recipient_name: 'A' },
      { parent_id: 'CONT_IDV_47QRCA24DH016_4732', solicitation_identifier: '47QRCA23R0003', recipient_name: 'B' },
    ] } },
  },
}));

import { mapsRecompeteRequest, mapsRecompeteSurfaceOps, applyMapsRecompeteFilters } from '@/lib/recompete/maps-recompete-discovery';
import { recompeteOnePassSql } from '@/lib/recompete/maps-recompete-sql';
import { buildRecompeteMapBody, unresolvedScopeBody } from '@/lib/recompete/recompete-map-paths';
import { scopedMapUrl, scopedParams } from './task-order-search';

const req = (p: Record<string, string>) => mapsRecompeteRequest((k) => p[k]);
const SQL_OPTS = { bbox: { west: -180, south: -90, east: 180, north: 90 }, cap: 10, pinCols: 'contract_id' };

describe('Maps request builder', () => {
  it('no scope → surface ops and body byte-identical to before (no vehicle_scope key)', () => {
    const r = req({ naics: '541611' });
    expect(r.surface.parentScope).toEqual({ status: 'none' });
    expect(mapsRecompeteSurfaceOps(r.surface, 'any')).toEqual([]);
    const body = buildRecompeteMapBody(r, { total: 3, unmapped: 1, inView: 3, pins: [], followOns: [], ms: 1 });
    expect('vehicle_scope' in body).toBe(false);
  });
  it('a vehicle alone is a positive scope (the plan is ok, not needs_positive_scope)', () => {
    const r = req({ vehicle: 'OASIS+' });
    expect(r.plan.status).toBe('ok');
    const ops = mapsRecompeteSurfaceOps(r.surface, 'any');
    expect(ops).toHaveLength(2);
    // Prefilter FIRST (derived from the members, a superset), then the exact parent-slot regex.
    expect((ops[0] as { expr: string }).expr).toBe('contract_id.like.CONT_AWD_*_47QRCA*_4732');
    expect((ops[1] as { expr: string }).expr).toContain('47QRCA24DH016|47QRCA25DA002');
  });
  it('work adds one AND-ed op per term', () => {
    const ops = mapsRecompeteSurfaceOps(req({ vehicle: 'OASIS+', work: 'management consulting' }).surface, 'any');
    expect(ops).toHaveLength(4);
  });
  it('an unresolved scope compiles to a never-match op AND the route body searches nothing', () => {
    const r = req({ vehicle: 'OASIS' });
    expect(r.surface.parentScope.status).toBe('unresolved');
    const ops = mapsRecompeteSurfaceOps(r.surface, 'any');
    expect((ops[0] as { expr: string }).expr).toBe('contract_id.match."^$"');
    const body = unresolvedScopeBody(r);
    expect(body.discovery.status).toBe('needs_refinement');
    expect(body.discovery.refinement).toMatch(/OASIS/);
    expect(body.totalForFilters).toBeNull();
    expect(body.pins).toEqual([]);
  });
});

describe('PostgREST applier and SQL twin receive the same scope', () => {
  it('the PostgREST path calls .or() with the scope expressions', () => {
    const calls: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = new Proxy({}, { get: (_t, prop) => (...a: unknown[]) => { if (prop === 'or') calls.push(String(a[0])); return q; } });
    applyMapsRecompeteFilters(q, req({ vehicle: 'OASIS+', work: 'management consulting' }), 'any');
    expect(calls.some((c) => c.includes('47QRCA25DA002'))).toBe(true);
    expect(calls.filter((c) => c.startsWith('description.imatch.'))).toHaveLength(2);
  });
  it('the SQL twin serializes the scope as bound parameters (no user text in the SQL string)', () => {
    const { text, values } = recompeteOnePassSql(req({ vehicle: 'OASIS+', work: 'management consulting' }), SQL_OPTS);
    expect(text).toMatch(/"contract_id" LIKE \$\d+::text/);
    expect(text).toMatch(/"contract_id" ~ \$\d+::text/);
    expect(text.indexOf('"contract_id" LIKE')).toBeLessThan(text.indexOf('"contract_id" ~'));
    expect(text).toMatch(/"naics_description" ~\* \$\d+::text/);
    expect(text).not.toContain('47QRCA');
    expect(values.some((v) => v.includes('47QRCA25DA002') && v.startsWith('^CONT_AWD_'))).toBe(true);
  });
  it('the SQL twin also fails closed on an unresolved scope', () => {
    const { values } = recompeteOnePassSql(req({ parent: 'not-an-id' }), SQL_OPTS);
    expect(values).toContain('^$');
  });
});

describe('shared map link', () => {
  it('isolates the Awarded horizon and carries every scope param the API reads', () => {
    const url = scopedMapUrl(scopedParams({ vehicle: 'OASIS+', work: 'management consulting', lead_months: 60 }));
    const u = new URL(url);
    expect(u.pathname).toBe('/opportunity-map');
    expect(u.searchParams.get('mode')).toBe('recompete');
    expect(u.searchParams.get('horizon')).toBe('recompete');
    expect(u.searchParams.get('vehicle')).toBe('OASIS+');
    expect(u.searchParams.get('work')).toBe('management consulting');
    expect(u.searchParams.get('leadMax')).toBe('60');
    // The link, read back as the API reads it, rebuilds the SAME request.
    const back = req(Object.fromEntries(u.searchParams));
    const direct = req(scopedParams({ vehicle: 'OASIS+', work: 'management consulting', lead_months: 60 }));
    expect(mapsRecompeteSurfaceOps(back.surface, 'any')).toEqual(mapsRecompeteSurfaceOps(direct.surface, 'any'));
    expect(back.plan.horizons.recompete.ops).toEqual(direct.plan.horizons.recompete.ops);
  });
  it('exact parent ids survive the link with commas intact', () => {
    const url = scopedMapUrl(scopedParams({ parent: 'CONT_IDV_47QRCA25DA002_4732,CONT_IDV_47QRCA24DH016_4732' }));
    expect(url).toContain('parent=CONT_IDV_47QRCA25DA002_4732,CONT_IDV_47QRCA24DH016_4732');
  });
});
