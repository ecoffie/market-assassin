/**
 * EXECUTION regressions for the scoped task-order search — every assertion runs the production query
 * code against real rows in an in-process Postgres (PGlite). Covers the three #1692 review findings:
 *
 *   1. dropped filters — every scoped input is either APPLIED (and narrows the rows, and is echoed in
 *      applied_filters) or REFUSED (nothing searched); none is silently ignored;
 *   2. a bare PIID with MORE THAN 1,000 orders under one agency and a second parent agency past that
 *      point — must resolve as ambiguous, never to the first agency;
 *   3. GENERATED award ids with a missing parent slot — counted as unattributed orders, never lost.
 *
 * Plus the invariants the fixes must not disturb: the Map (PostgREST readOld AND the SQL twin
 * recompeteOnePassSql, both from the shared map link) returns exactly the tool's orders.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

// A fixed registry so the fixtures are independent of re-verification runs.
vi.mock('@/data/vehicles/vehicle-parents.json', () => ({
  default: {
    verified_at: '2026-09-24T00:00:00.000Z', source: 'test', candidate_population: 'test', candidates: 3, unresolved_candidates: 0,
    vehicles: { oasis_plus: { members: [
      { parent_id: 'CONT_IDV_47QRCA25DA002_4732', solicitation_identifier: '47QRCA23R0002', recipient_name: 'A' },
      { parent_id: 'CONT_IDV_47QRCA24DH016_4732', solicitation_identifier: '47QRCA23R0003', recipient_name: 'B' },
    ] } },
  },
}));

import { createRecompeteDb, postgrestOver, type Row } from './__testing__/pglite-postgrest';
import { searchScopedTaskOrders, parentAgenciesForPiid } from './task-order-search';
import { idvContracts, refusedScopedFilters } from '@/mcp/tools/idv-contracts';
import { mapsRecompeteRequest } from '@/lib/recompete/maps-recompete-discovery';
import { readOld } from '@/lib/recompete/recompete-map-paths';
import { recompeteOnePassSql } from '@/lib/recompete/maps-recompete-sql';
import { RECOMPETE_PIN_COLS } from '@/lib/recompete/map-pin';
import { isUnattributedOrder, UNATTRIBUTED_ORDERS_OR } from './parent-scope';

const iso = (months: number) => { const d = new Date(); d.setMonth(d.getMonth() + months); return d.toISOString().slice(0, 10); };
const A = '47QRCA25DA002', B = '47QRCA24DH016';
const order = (id: string, over: Row = {}): Row => ({
  contract_id: id, piid: id.split('_')[2], contract_type: 'DELIVERY ORDER', quality_flag: null,
  description: 'MANAGEMENT CONSULTING SUPPORT', naics_code: '541611', psc_description: 'SUPPORT- MANAGEMENT',
  awarding_agency: 'DEPARTMENT OF HOMELAND SECURITY', awarding_sub_agency: 'U.S. COAST GUARD',
  incumbent_name: 'FIXTURE LLC', place_of_performance_state: 'VA', potential_total_value: 5_000_000, total_obligation: 1_000_000,
  period_of_performance_current_end: iso(6), map_lat: 38.9, map_lng: -77.0, data_source: 'usaspending', ...over,
});

const ROWS: Row[] = [
  order(`CONT_AWD_T01_7008_${A}_4732`),                                                       // base match
  order(`CONT_AWD_T02_7008_${B}_4732`, { map_lat: null, map_lng: null }),                     // base match, unmapped
  order(`CONT_AWD_T03_7008_${A}_4732`, { place_of_performance_state: 'MD' }),                 // fails state only
  order(`CONT_AWD_T04_7008_${A}_4732`, { potential_total_value: 100_000 }),                   // fails min_value only
  order(`CONT_AWD_T05_7008_${A}_4732`, { naics_code: '541330', description: 'MANAGEMENT CONSULTING' }), // fails naics only
  order(`CONT_AWD_T06_1341_${A}_4732`, { awarding_agency: 'DEPARTMENT OF COMMERCE', awarding_sub_agency: 'NIST' }), // fails agency only
  order(`CONT_AWD_T07_7008_${A}_4732`, { description: 'JANITORIAL', naics_code: '561720', psc_description: 'CUSTODIAL' }), // fails work only
  order(`CONT_AWD_T08_7008_${A}_4732`, { period_of_performance_current_end: iso(-1) }),        // expired
  order('CONT_AWD_T09_7008_47QRAD20D1001_4732'),                                              // original OASIS — negative control
  order('CONT_AWD_T10_9700_FA850124D0005_9700'),                                              // unrelated vehicle — negative control
  // Finding 3 — orders whose parent is NOT recorded:
  order('CONT_AWD_T11_7008_-NONE-_-NONE-'),                                                   // generated id, parent missing
  order('CONT_AWD_T12_7008_47QRCA25DZ999_-NONE-'),                                            // generated id, parent agency missing
  order('CONT_AWD_T13_7008_-NONE-_-NONE-', { contract_type: 'PURCHASE ORDER' }),              // NOT an order → not unattributed
  order('T14RAWPIID', { contract_type: 'BPA CALL' }),                                        // raw PIID order
  order('CONT_AWD_T15_7008_-NONE-_4732'),                                                     // generated id, parent piid missing, agency present
  // Finding 2 — PIID ZZBIGPIID0001: 1,001 orders under 9700 inserted FIRST, then one under 4732.
  ...Array.from({ length: 1001 }, (_, i) => order(`CONT_AWD_B${String(i).padStart(4, '0')}_9700_ZZBIGPIID0001_9700`, { description: 'LOGISTICS' })),
  order('CONT_AWD_BLAST_7008_ZZBIGPIID0001_4732', { description: 'LOGISTICS' }),
];

let pg: PGlite;
let db: ReturnType<typeof postgrestOver>;
beforeAll(async () => { pg = await createRecompeteDb(ROWS); db = postgrestOver(pg); }, 60_000);
afterAll(async () => { await pg?.close(); });

const BASE = { vehicle: 'OASIS+', work: 'management consulting', lead_months: 60, limit: 100 };
const ids = (r: { orders: { contract_id: string }[] }) => r.orders.map((o) => o.contract_id).sort();

/** The Map, both read paths, from the tool's own shared link. */
async function mapFromLink(url: string) {
  const params = Object.fromEntries(new URL(url).searchParams);
  const req = mapsRecompeteRequest((k) => params[k]);
  const world = { west: -180, south: -90, east: 180, north: 90 };
  const old = await readOld(db, req, world);
  const sql = recompeteOnePassSql(req, { bbox: world, cap: 1000, pinCols: RECOMPETE_PIN_COLS, withMarketIds: true });
  const one = (await pg.query<{ total: string; unmapped: string; market_ids: string[] }>(sql.text, sql.values)).rows[0];
  return { old, onePass: { total: Number(one.total), unmapped: Number(one.unmapped), ids: [...one.market_ids].sort() } };
}

describe('baseline scope executes and the Map agrees (both read paths)', () => {
  it('OASIS+ × management consulting → the six in-scope rows; work-miss, expired and both controls excluded', async () => {
    const r = await searchScopedTaskOrders(BASE, db);
    expect(r.status).toBe('ok');
    expect(ids(r)).toEqual([`CONT_AWD_T01_7008_${A}_4732`, `CONT_AWD_T02_7008_${B}_4732`, `CONT_AWD_T03_7008_${A}_4732`,
      `CONT_AWD_T04_7008_${A}_4732`, `CONT_AWD_T05_7008_${A}_4732`, `CONT_AWD_T06_1341_${A}_4732`].sort());
    const m = await mapFromLink(r.map_url!);
    expect(m.old.total).toBe(r.mapped_total);
    expect(m.old.unmapped).toBe(r.unmapped_total);
    expect(m.onePass.ids).toEqual(ids(r));
    expect(m.old.pins.map((p) => String(p.contract_id)).sort()).toEqual(r.orders.filter((o) => o.on_map).map((o) => o.contract_id).sort());
  });
});

describe('finding 1 — every scoped filter is APPLIED (narrows, echoed, same on the Map) or REFUSED', () => {
  const cases: { name: string; input: Record<string, unknown>; excluded: string; applied: string }[] = [
    { name: 'state (pop)', input: { state: 'VA' }, excluded: `CONT_AWD_T03_7008_${A}_4732`, applied: 'state' },
    { name: 'min_value', input: { min_value: 1_000_000 }, excluded: `CONT_AWD_T04_7008_${A}_4732`, applied: 'min_value' },
    { name: 'naics', input: { naics: '541611' }, excluded: `CONT_AWD_T05_7008_${A}_4732`, applied: 'naics' },
    { name: 'agency', input: { agency: 'Department of Homeland Security' }, excluded: `CONT_AWD_T06_1341_${A}_4732`, applied: 'agency' },
  ];
  for (const c of cases) {
    it(`${c.name}: removes exactly the row that fails it, and the Map link removes it too`, async () => {
      const before = await searchScopedTaskOrders(BASE, db);
      const after = await searchScopedTaskOrders({ ...BASE, ...c.input }, db);
      expect(ids(before)).toContain(c.excluded);
      expect(ids(after)).not.toContain(c.excluded);
      expect(ids(after)).toEqual(ids(before).filter((x) => x !== c.excluded));
      expect(after.applied_filters.map((f) => f.filter)).toContain(c.applied);
      const m = await mapFromLink(after.map_url!);
      expect(m.onePass.ids).toEqual(ids(after));
      expect((m.old.total ?? 0) + (m.old.unmapped ?? 0)).toBe(after.total);
    });
  }
  const refused: [string, Record<string, unknown>, string][] = [
    ['psc', { psc: 'R408' }, 'psc'],
    ['date_from', { date_from: '2025-01-01' }, 'date_from'],
    ['date_to', { date_to: '2026-01-01' }, 'date_to'],
    ['search_type idv', { search_type: 'idv' }, 'search_type'],
    ['state without state_scope', { state: 'VA' }, 'state'],
    ['state with recipient scope', { state: 'VA', state_scope: 'recipient' }, 'state'],
    ['state with both scope', { state: 'VA', state_scope: 'both' }, 'state'],
    ['unknown state', { state: 'Atlantis', state_scope: 'pop' }, 'state'],
    ['negative min_value', { min_value: -5 }, 'min_value'],
    ['NaN min_value', { min_value: Number.NaN }, 'min_value'],
    ['fractional min_value', { min_value: 1000.5 }, 'min_value'],
    ['min_value the Map cannot carry', { min_value: 1e21 }, 'min_value'],
  ];
  for (const [name, input, filter] of refused) {
    it(`${name}: refused — nothing searched, reason named, never a broader result`, async () => {
      const r = await idvContracts({ vehicle: 'OASIS+', work: 'management consulting', ...input } as never);
      expect(r.status).toBe('needs_refinement');
      expect(r._meta.total).toBeNull();
      expect(r.contracts).toEqual([]);
      expect(r.refused_filters?.map((f) => f.filter)).toContain(filter);
    });
  }
  it('every PUBLISHED input of search_idv_contracts is classified (a new input fails here until it is)', async () => {
    const { listMcpTools } = await import('@/lib/mcp/tool-registry');
    const def = listMcpTools().find((t) => (t as { function?: { name?: string } }).function?.name === 'search_idv_contracts') as
      { function: { parameters: { properties: Record<string, unknown> } } };
    const published = Object.keys(def.function.parameters.properties).sort();
    const SCOPE_OR_PAGING = ['vehicle', 'parent_id', 'work', 'lead_months', 'limit', 'page', 'state_scope'];
    const APPLIED = ['naics', 'agency', 'state', 'min_value'];                  // proven to narrow above
    const REFUSED_WHEN_SET: Record<string, unknown> = { psc: 'R408', date_from: '2025-01-01', date_to: '2026-01-01', search_type: 'idv' };
    for (const [k, v] of Object.entries(REFUSED_WHEN_SET)) {
      expect(refusedScopedFilters({ [k]: v } as never).map((f) => f.filter), k).toContain(k);
    }
    expect(published).toEqual([...SCOPE_OR_PAGING, ...APPLIED, ...Object.keys(REFUSED_WHEN_SET)].sort());
  });
  it('min_value 0 is the legacy "no floor": not applied, not refused', async () => {
    expect(refusedScopedFilters({ min_value: 0 } as never)).toEqual([]);
    const r = await searchScopedTaskOrders({ ...BASE, min_value: 0 }, db);
    expect(r.applied_filters.map((f) => f.filter)).not.toContain('min_value');
  });
  it('#1692 review 9: a state NAME is normalized once — query, echo and Map link all say the code', async () => {
    const r = await searchScopedTaskOrders({ ...BASE, state: 'Virginia' }, db);
    expect(r.applied_filters.find((f) => f.filter === 'state')?.value).toBe('VA');
    expect(new URL(r.map_url!).searchParams.get('state')).toBe('VA');
    expect(ids(r)).not.toContain(`CONT_AWD_T03_7008_${A}_4732`);
  });
});

describe('finding 2 — bare PIID with >1,000 rows under one agency and a second agency past the cap', () => {
  it('finds BOTH agencies (the 1,000-row sample would have seen only 9700)', async () => {
    const first1000 = await db.from('recompete_opportunities').select('contract_id')
      .filter('contract_id', 'match', '^CONT_AWD_.+_[0-9A-Z]{4}_ZZBIGPIID0001_[0-9A-Z]{4}$').limit(1000);
    expect(new Set((first1000.data ?? []).map((r) => String(r.contract_id).slice(-4)))).toEqual(new Set(['9700'])); // the trap is real
    expect(await parentAgenciesForPiid(db, 'ZZBIGPIID0001')).toEqual(['4732', '9700']);
  });
  it('the scoped search refuses to guess: unresolved, both exact ids offered, nothing searched', async () => {
    const r = await searchScopedTaskOrders({ parent_id: 'ZZBIGPIID0001', lead_months: 60 }, db);
    expect(r.status).toBe('unresolved');
    expect(r.total).toBeNull();
    expect(r.orders).toEqual([]);
    expect(r.reason).toContain('CONT_IDV_ZZBIGPIID0001_4732');
    expect(r.reason).toContain('CONT_IDV_ZZBIGPIID0001_9700');
  });
  it('each exact id still returns only its own parent\'s orders (1,001 and 1)', async () => {
    const big = await searchScopedTaskOrders({ parent_id: 'CONT_IDV_ZZBIGPIID0001_9700', lead_months: 60, limit: 10 }, db);
    const small = await searchScopedTaskOrders({ parent_id: 'CONT_IDV_ZZBIGPIID0001_4732', lead_months: 60 }, db);
    expect(big.total).toBe(1001);
    expect(small.total).toBe(1);
    expect(ids(small)).toEqual(['CONT_AWD_BLAST_7008_ZZBIGPIID0001_4732']);
  });
  it('a single-agency PIID still resolves (bare 47QRCA25DA002 → its one agency)', async () => {
    expect(await parentAgenciesForPiid(db, A)).toEqual(['4732']);
    const r = await searchScopedTaskOrders({ parent_id: A, lead_months: 60 }, db);
    expect(r.status).toBe('ok');
  });
});

describe('finding 3 — generated award ids with a missing parent are unattributed orders', () => {
  it('SQL (the executed expression) and the JS twin agree row by row', async () => {
    const viaSql = await db.from('recompete_opportunities').select('contract_id').or(UNATTRIBUTED_ORDERS_OR);
    const sqlIds = (viaSql.data ?? []).map((r) => String(r.contract_id)).sort();
    expect(viaSql.error).toBeNull();
    expect(sqlIds).toEqual(ROWS.filter(isUnattributedOrder).map((r) => String(r.contract_id)).sort());
    expect(sqlIds).toEqual(['CONT_AWD_T11_7008_-NONE-_-NONE-', 'CONT_AWD_T12_7008_47QRCA25DZ999_-NONE-', 'CONT_AWD_T15_7008_-NONE-_4732', 'T14RAWPIID']);
  });
  it('the scoped search counts them (the first version counted only the raw-PIID one)', async () => {
    const r = await searchScopedTaskOrders(BASE, db);
    expect(r.unattributed_orders).toBe(4);
    // …and never admits them into the vehicle's result.
    for (const id of ['CONT_AWD_T11_7008_-NONE-_-NONE-', 'CONT_AWD_T12_7008_47QRCA25DZ999_-NONE-', 'CONT_AWD_T15_7008_-NONE-_4732', 'T14RAWPIID']) expect(ids(r)).not.toContain(id);
  });
});
