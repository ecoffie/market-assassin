/**
 * LIVE ORACLE — parent-contract / vehicle–scoped task-order search (read-only).
 *
 * Proves the acceptance criteria against the live `recompete_opportunities` table, through the SAME
 * code the MCP tool and the Map API run, and cross-checks every count with an INDEPENDENT path
 * (a broad LIKE read filtered in JS against the registry, window and work terms — the SQL regex never
 * grades itself). Writes the evidence (result ids + parent-id evidence) for review.
 *
 *   npx tsx scripts/verify-task-order-scope.ts            # prints summary, writes evidence JSON
 *   npx tsx scripts/verify-task-order-scope.ts --json     # machine-readable summary
 *
 * No writes anywhere. Exits 1 on any failed check.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';

config({ path: '.env.local', quiet: true });

// Loaded inside main() so dotenv runs first and no module reads the env early.
type Mods = {
  idvContracts: typeof import('../src/mcp/tools/idv-contracts')['idvContracts'];
  searchScopedTaskOrders: typeof import('../src/lib/vehicles/task-order-search')['searchScopedTaskOrders'];
  mapsRecompeteRequest: typeof import('../src/lib/recompete/maps-recompete-discovery')['mapsRecompeteRequest'];
  readOld: typeof import('../src/lib/recompete/recompete-map-paths')['readOld'];
  buildRecompeteMapBody: typeof import('../src/lib/recompete/recompete-map-paths')['buildRecompeteMapBody'];
  resolveVehicle: typeof import('../src/lib/vehicles/registry')['resolveVehicle'];
  vehicleOfParent: typeof import('../src/lib/vehicles/registry')['vehicleOfParent'];
  vehicleCoverage: typeof import('../src/lib/vehicles/registry')['vehicleCoverage'];
  recordedParent: typeof import('../src/lib/vehicles/parent-scope')['recordedParent'];
  isUnattributedOrder: typeof import('../src/lib/vehicles/parent-scope')['isUnattributedOrder'];
  parentIdOf: typeof import('../src/lib/vehicles/parent-scope')['parentIdOf'];
  workEvidence: typeof import('../src/lib/vehicles/parent-scope')['workEvidence'];
  workTerms: typeof import('../src/lib/vehicles/parent-scope')['workTerms'];
};
let M: Mods;
async function load(): Promise<Mods> {
  const [a, b, c, d, e, f] = await Promise.all([
    import('../src/mcp/tools/idv-contracts'), import('../src/lib/vehicles/task-order-search'),
    import('../src/lib/recompete/maps-recompete-discovery'), import('../src/lib/recompete/recompete-map-paths'),
    import('../src/lib/vehicles/registry'), import('../src/lib/vehicles/parent-scope'),
  ]);
  return {
    idvContracts: a.idvContracts, searchScopedTaskOrders: b.searchScopedTaskOrders, mapsRecompeteRequest: c.mapsRecompeteRequest,
    readOld: d.readOld, buildRecompeteMapBody: d.buildRecompeteMapBody, resolveVehicle: e.resolveVehicle, vehicleOfParent: e.vehicleOfParent, vehicleCoverage: e.vehicleCoverage,
    recordedParent: f.recordedParent, isUnattributedOrder: f.isUnattributedOrder, parentIdOf: f.parentIdOf, workEvidence: f.workEvidence, workTerms: f.workTerms,
  };
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const WORLD = { west: -180, south: -90, east: 180, north: 90 };
const LEAD = 60;
const OUT_DIR = 'tasks/task-order-parent-scope';

type Check = { id: string; pass: boolean; detail: string };
const checks: Check[] = [];
const evidence: Record<string, unknown> = {};
const check = (id: string, pass: boolean, detail: string) => { checks.push({ id, pass, detail }); };

function windowBounds() {
  const today = new Date();
  const end = new Date(today); end.setMonth(end.getMonth() + LEAD);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(today), to: iso(end) };
}

/** Every page of a scoped search — proves pagination is complete and deterministic. */
async function allPages(input: Parameters<Mods['searchScopedTaskOrders']>[0], pageSize = 50) {
  const ids: string[] = [];
  const rows: Awaited<ReturnType<Mods['searchScopedTaskOrders']>>['orders'] = [];
  let first: Awaited<ReturnType<Mods['searchScopedTaskOrders']>> | null = null;
  for (let page = 1; page < 200; page++) {
    const r = await M.searchScopedTaskOrders({ ...input, limit: pageSize, page });
    if (!first) first = r;
    rows.push(...r.orders); ids.push(...r.orders.map((o) => o.contract_id));
    if (!r.has_next_page) break;
  }
  return { first: first!, ids, rows };
}

/** Independent recount: broad LIKE read on the parent agencies, then JS membership + window + work. */
async function independentVehicleCount(work: string) {
  const res = M.resolveVehicle('OASIS+');
  if (res.status !== 'resolved') throw new Error('OASIS+ not resolved');
  const members = new Set(res.members.map((m) => m.parent_id));
  const { from, to } = windowBounds();
  const ids = new Set<string>();
  for (const ag of res.vehicle.parentAgencies) {
    for (let off = 0; ; off += 1000) {
      const { data, error } = await db.from('recompete_opportunities')
        .select('contract_id, description, naics_code, naics_description, psc_description, period_of_performance_current_end, quality_flag')
        .like('contract_id', `CONT_AWD_%_${ag}`).order('contract_id').range(off, off + 999);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        const p = M.recordedParent(r.contract_id);
        if (!p || !members.has(M.parentIdOf(p))) continue;
        if (r.quality_flag != null) continue;
        const end = String(r.period_of_performance_current_end ?? '');
        if (!(end >= from && end <= to)) continue;
        if (work && !M.workEvidence(r, work).every((e) => e.fields.length > 0)) continue;
        ids.add(r.contract_id);
      }
      if (!data || data.length < 1000) break;
    }
  }
  return ids;
}

async function main() {
  M = await load();
  const cov = M.vehicleCoverage();
  const oasisPlus = M.resolveVehicle('OASIS+');
  evidence.registry = { ...cov, oasis_plus_members: oasisPlus.status === 'resolved' ? oasisPlus.members.length : 0 };
  check('registry.members', oasisPlus.status === 'resolved' && oasisPlus.members.length > 0,
    `OASIS+ verified parent IDVs: ${oasisPlus.status === 'resolved' ? oasisPlus.members.length : 0} (candidates checked ${cov.candidates_checked}, unresolved ${cov.unresolved_candidates})`);

  // ── 1. Management consulting under OASIS+ ─────────────────────────────────────────────
  const WORK = 'management consulting';
  const a1 = await allPages({ vehicle: 'OASIS+', work: WORK, lead_months: LEAD }, 7);
  const allMember = a1.rows.every((o) => o.parent.vehicle?.key === 'oasis_plus' && /^47QRCA23R000[1-6]$/.test(o.parent.vehicle.solicitation_identifier));
  const allWork = a1.rows.every((o) => o.work_evidence.length === M.workTerms(WORK).length && o.work_evidence.every((e) => e.fields.length > 0));
  const indep = await independentVehicleCount(WORK);
  const sameSet = indep.size === a1.ids.length && a1.ids.every((id) => indep.has(id));
  check('1.membership', a1.first.status === 'ok' && a1.rows.length > 0 && allMember, `${a1.rows.length} orders, all under verified OASIS+ parents (solicitation 47QRCA23R0001–0006)`);
  check('1.work_evidence', allWork, `every order carries evidence for every work term (${M.workTerms(WORK).join(', ')})`);
  check('1.independent_recount', sameSet && a1.first.total === indep.size, `tool total ${a1.first.total} · paged ${a1.ids.length} · independent JS recount ${indep.size}`);
  evidence.oasis_plus_management_consulting = {
    request: { vehicle: 'OASIS+', work: WORK, lead_months: LEAD },
    status: a1.first.status, total: a1.first.total, mapped_total: a1.first.mapped_total, unmapped_total: a1.first.unmapped_total,
    parent_orders_in_population: a1.first.parent_orders_in_population, unattributed_orders: a1.first.unattributed_orders,
    map_url: a1.first.map_url, population: a1.first.population,
    orders: a1.rows.map((o) => ({
      contract_id: o.contract_id, piid: o.piid, recipient: o.recipient_name, agency: o.agency, period_end: o.period_end,
      parent_id: o.parent.parent_id, parent_solicitation: o.parent.vehicle?.solicitation_identifier, pool: o.parent.vehicle?.pool,
      work_evidence: o.work_evidence, on_map: o.on_map,
    })),
  };

  // ── 2. Exact parent id ────────────────────────────────────────────────────────────────
  const parentCounts = new Map<string, number>();
  for (const o of (await allPages({ vehicle: 'OASIS+', lead_months: LEAD }, 100)).rows) parentCounts.set(o.parent.parent_id, (parentCounts.get(o.parent.parent_id) ?? 0) + 1);
  const [topParent] = [...parentCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (topParent) {
    const a2 = await allPages({ parent_id: topParent, lead_months: LEAD }, 5);
    check('2.exact_parent', a2.rows.length > 0 && a2.rows.every((o) => o.parent.parent_id === topParent) && a2.first.total === parentCounts.get(topParent),
      `${topParent}: ${a2.first.total} orders, all recording that parent (vehicle-scope count for it: ${parentCounts.get(topParent)})`);
    const bare = await M.searchScopedTaskOrders({ parent_id: topParent.replace(/^CONT_IDV_/, '').replace(/_[0-9A-Z]{4}$/, ''), lead_months: LEAD });
    check('2.bare_piid', bare.total === a2.first.total, `bare PIID resolves to the single agency carrying it → ${bare.total}`);
    evidence.exact_parent = { parent_id: topParent, total: a2.first.total, map_url: a2.first.map_url, order_ids: a2.ids };
  } else check('2.exact_parent', false, 'no OASIS+ parent with orders in the population');

  // ── 3. Negative controls ─────────────────────────────────────────────────────────────
  const { data: origRows, error: origErr } = await db.from('recompete_opportunities').select('contract_id')
    .or('contract_id.like.CONT_AWD_%_GS00Q14OA%_4732,contract_id.like.CONT_AWD_%_47QRAD%_4732').is('quality_flag', null).limit(200);
  if (origErr) throw new Error(origErr.message);
  const origParents = [...new Set((origRows ?? []).map((r) => M.recordedParent(r.contract_id)).filter(Boolean).map((p) => M.parentIdOf(p!)))];
  const leakedOriginal = origParents.filter((p) => M.vehicleOfParent(p) != null);
  const oasisPlusAll = await allPages({ vehicle: 'OASIS+', lead_months: LEAD }, 100);
  const oasisPlusParents = new Set(oasisPlusAll.rows.map((o) => o.parent.parent_id));
  const origInPlus = origParents.filter((p) => oasisPlusParents.has(p));
  check('3.original_oasis', origParents.length > 0 && leakedOriginal.length === 0 && origInPlus.length === 0,
    `${origParents.length} original-OASIS parents in the table (GS00Q14OA…/47QRAD…); 0 classified OASIS+, 0 in the OASIS+ result`);
  const MECH_ELEC = 'CONT_IDV_FA850124D0005_9700';
  const mech = await M.searchScopedTaskOrders({ parent_id: MECH_ELEC, lead_months: LEAD, limit: 100 });
  check('3.unrelated_vehicle', !oasisPlusParents.has(MECH_ELEC) && mech.orders.every((o) => o.parent.parent_id === MECH_ELEC),
    `Robins Mech-Elec II (${MECH_ELEC}): ${mech.total} own orders, none in the OASIS+ result`);
  if (origParents[0]) {
    const orig = await M.searchScopedTaskOrders({ parent_id: origParents[0], lead_months: LEAD, limit: 100 });
    check('3.original_oasis_as_exact_parent', orig.orders.every((o) => o.parent.parent_id === origParents[0] && o.parent.vehicle == null),
      `${origParents[0]} as an exact parent: ${orig.total} orders, vehicle evidence null (not OASIS+)`);
  }
  evidence.negative_controls = { original_oasis_parents_sampled: origParents, mech_elec: { parent: MECH_ELEC, total: mech.total } };

  // ── 4. Unknown / ambiguous ────────────────────────────────────────────────────────────
  const unresolvedCases = ['OASIS', 'Alliant 3', 'CIO-SP4', 'OASIS SB'];
  const u = await Promise.all(unresolvedCases.map((v) => M.idvContracts({ vehicle: v, search_type: 'task' })));
  u.forEach((r, i) => check(`4.unresolved:${unresolvedCases[i]}`, r.status === 'unresolved' && r._meta.total === null && r.contracts.length === 0 && r.map?.url == null,
    `${unresolvedCases[i]} → ${r.status}: ${r.reason}`));
  const badId = await M.idvContracts({ parent_id: 'CONT_IDV_NOTREAL' });
  check('4.invalid_parent', badId.status === 'unresolved' && badId._meta.total === null, `malformed id → ${badId.status}`);
  evidence.unresolved = u.map((r, i) => ({ vehicle: unresolvedCases[i], status: r.status, reason: r.reason, total: r._meta.total }));

  // ── 5. Missing parent data vs zero matching ─────────────────────────────────────────
  const ghost = await M.searchScopedTaskOrders({ parent_id: 'CONT_IDV_47QRCA99DZ999_4732', lead_months: LEAD });
  check('5.no_parent_orders', ghost.status === 'no_parent_orders' && ghost.total === 0 && ghost.parent_orders_in_population === 0, `parent with no orders in population → ${ghost.status}`);
  const zero = await M.searchScopedTaskOrders({ vehicle: 'OASIS+', work: 'submarine hull welding', lead_months: LEAD });
  check('5.zero_matching', zero.status === 'zero_matching_orders' && zero.total === 0 && (zero.parent_orders_in_population ?? 0) > 0,
    `OASIS+ has ${zero.parent_orders_in_population} orders; 0 match "submarine hull welding" → ${zero.status}`);
  check('5.unattributed_reported', typeof a1.first.unattributed_orders === 'number',
    `orders matching "${WORK}" whose parent is NOT recorded (cannot be attributed): ${a1.first.unattributed_orders}`);
  evidence.missing_vs_zero = {
    ghost: { status: ghost.status, reason: ghost.reason },
    zero: { status: zero.status, reason: zero.reason, parent_orders_in_population: zero.parent_orders_in_population },
    unattributed_for_management_consulting: a1.first.unattributed_orders,
  };

  // ── 6. Counts, cards, pagination and the Map agree ─────────────────────────────────
  const dup = a1.ids.length !== new Set(a1.ids).size;
  const repeat = await allPages({ vehicle: 'OASIS+', work: WORK, lead_months: LEAD }, 7);
  check('6.pagination', !dup && a1.ids.length === a1.first.total && JSON.stringify(repeat.ids) === JSON.stringify(a1.ids),
    `${a1.ids.length} unique ids across pages of 7 == total ${a1.first.total}; a second pass returns the identical order`);
  const mapParams = Object.fromEntries(new URL(a1.first.map_url!).searchParams);
  const mapReq = M.mapsRecompeteRequest((k) => mapParams[k]);
  const read = await M.readOld(db, mapReq, WORLD);
  const mapPinIds = read.pins.map((p) => String(p.contract_id)).sort();
  const toolOnMap = a1.rows.filter((o) => o.on_map).map((o) => o.contract_id).sort();
  check('6.map_counts', read.total === a1.first.mapped_total && read.unmapped === a1.first.unmapped_total && (read.total ?? 0) + (read.unmapped ?? 0) === a1.first.total,
    `Map API via the shared link: mapped ${read.total} + unmapped ${read.unmapped} = ${(read.total ?? 0) + (read.unmapped ?? 0)} · tool total ${a1.first.total}`);
  check('6.map_pins', JSON.stringify(mapPinIds) === JSON.stringify(toolOnMap), `Map pins (world bbox) == the tool's on-map orders: ${mapPinIds.length}`);
  evidence.map_agreement = { map_url: a1.first.map_url, map_mapped: read.total, map_unmapped: read.unmapped, map_pin_ids: mapPinIds };

  // ── 8. Correction batch (#1692 review) ───────────────────────────────────────────
  // 8a. Applied filters narrow the SAME result, are echoed, and the Map link agrees.
  const stateCounts = new Map<string, number>();
  for (const o of a1.rows) if (o.place_of_performance_state) stateCounts.set(o.place_of_performance_state, (stateCounts.get(o.place_of_performance_state) ?? 0) + 1);
  const topState = [...stateCounts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'VA';
  const filtered = await M.searchScopedTaskOrders({ vehicle: 'OASIS+', work: WORK, lead_months: LEAD, state: topState, min_value: 1_000_000, limit: 100 });
  const expectIds = a1.rows.filter((o) => o.place_of_performance_state === topState && (o.potential_total_value ?? 0) >= 1_000_000).map((o) => o.contract_id).sort();
  const gotIds = filtered.orders.map((o) => o.contract_id).sort();
  check('8.filters_applied', JSON.stringify(gotIds) === JSON.stringify(expectIds) && ['state', 'min_value'].every((f) => filtered.applied_filters.some((x) => x.filter === f)),
    `state=${topState} (pop) + min_value=1,000,000 → ${gotIds.length} (JS subset of the 23: ${expectIds.length}); both echoed in applied_filters`);
  const fParams = Object.fromEntries(new URL(filtered.map_url!).searchParams);
  const fRead = await M.readOld(db, M.mapsRecompeteRequest((k) => fParams[k]), WORLD);
  check('8.filters_map', (fRead.total ?? 0) + (fRead.unmapped ?? 0) === filtered.total && fParams.state === topState && fParams.minValue === '1000000',
    `Map link carries state + minValue: mapped ${fRead.total} + unmapped ${fRead.unmapped} = tool ${filtered.total}`);
  // 8b. Filters the scoped data cannot run are refused — nothing searched.
  const refusals = await Promise.all([
    { psc: 'R408' }, { date_from: '2025-01-01' }, { search_type: 'idv' as const }, { state: 'VA' }, { state: 'VA', state_scope: 'recipient' as const },
  ].map((x) => M.idvContracts({ vehicle: 'OASIS+', work: WORK, ...x })));
  check('8.filters_refused', refusals.every((r) => r.status === 'needs_refinement' && r._meta.total === null && (r.refused_filters?.length ?? 0) > 0),
    `psc · date_from · search_type:idv · state (no scope) · state (recipient) → ${refusals.map((r) => r.refused_filters?.[0]?.filter).join(', ')} refused`);
  // 8c. Unattributed orders, independent path: simple PostgREST filters (no regex) + the JS twin.
  const { from: wFrom, to: wTo } = windowBounds();
  const cand: Record<string, unknown>[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.from('recompete_opportunities')
      .select('contract_id, contract_type, description, naics_code, naics_description, psc_description, period_of_performance_current_end')
      .range(off, off + 999) // paged: the loop reads until a short page
      .in('contract_type', ['DELIVERY ORDER', 'BPA CALL', 'TASK ORDER']).is('quality_flag', null)
      .gte('period_of_performance_current_end', wFrom).lte('period_of_performance_current_end', wTo)
      .or('contract_id.not.like.CONT_AWD_*,contract_id.like.*-NONE-*').order('contract_id');
    if (error) throw new Error(error.message);
    cand.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const unattrJs = cand.filter((r) => M.isUnattributedOrder(r as never) && M.workEvidence(r, WORK).every((e) => e.fields.length > 0)).length;
  const genMissing = cand.filter((r) => String(r.contract_id).startsWith('CONT_AWD_') && M.isUnattributedOrder(r as never)).length;
  check('8.unattributed_recount', unattrJs === a1.first.unattributed_orders,
    `unattributed "${WORK}" orders: tool ${a1.first.unattributed_orders} · independent ${unattrJs} (generated ids with a missing parent among all window orders: ${genMissing})`);
  evidence.correction_batch = {
    filters: { state: topState, min_value: 1_000_000, ids: gotIds, applied_filters: filtered.applied_filters, map_url: filtered.map_url },
    refused: refusals.map((r) => ({ refused: r.refused_filters, status: r.status })),
    unattributed: { tool: a1.first.unattributed_orders, independent: unattrJs, generated_missing_parent_in_window: genMissing },
  };

  // ── 9. #1684 integration: a count-skipping pan read of the same shared link ──────────
  const pReq = M.mapsRecompeteRequest((k) => mapParams[k]);
  const countedBody = M.buildRecompeteMapBody(pReq, await M.readOld(db, pReq, WORLD, { counts: true }), { counts: true }) as Record<string, unknown>;
  const skippedBody = M.buildRecompeteMapBody(pReq, await M.readOld(db, pReq, WORLD, { counts: false }), { counts: false }) as Record<string, unknown>;
  const pinIds = (b: Record<string, unknown>) => JSON.stringify((b.pins as Array<{ id?: string }>).map((x) => String(x.id)).sort());
  check('9.counts_skipped_scope', skippedBody.countsSkipped === true && !('totalForFilters' in JSON.parse(JSON.stringify(skippedBody)))
    && pinIds(skippedBody) === pinIds(countedBody) && JSON.stringify(skippedBody.vehicle_scope) === JSON.stringify(countedBody.vehicle_scope)
    && countedBody.totalForFilters === a1.first.mapped_total && countedBody.unmappedForFilters === a1.first.unmapped_total,
    `counts=0 read: same ${(skippedBody.pins as unknown[]).length} pins, counts omitted (not 0), vehicle_scope kept; counted read = tool (${countedBody.totalForFilters} + ${countedBody.unmappedForFilters})`);

  // ── 7. Unfiltered task-order search unchanged ───────────────────────────────────────
  const legacy = await M.idvContracts({ naics: '541611', search_type: 'task', limit: 10 });
  check('7.unscoped_legacy_shape', legacy.status === undefined && legacy.search_type === 'task_orders' && Object.keys(legacy).sort().join() === '_meta,contracts,has_next_page,queried,search_type',
    `unscoped search → legacy USASpending path, ${legacy.contracts.length} orders, no scope fields`);
  const legacyParents = legacy.contracts.map((c) => M.recordedParent(c.generatedId)).map((p) => (p ? M.parentIdOf(p) : null));
  evidence.before_unscoped = {
    note: 'Before this change a task-order search could not be restricted to a vehicle: this is the only query shape available (NAICS 541611), and its orders sit under any parent.',
    orders: legacy.contracts.map((c, i) => ({ award: c.generatedId, parent_id: legacyParents[i], oasis_plus: legacyParents[i] ? M.vehicleOfParent(legacyParents[i]!) != null : false })),
  };

  // ── output ───────────────────────────────────────────────────────────────────────
  const failed = checks.filter((c) => !c.pass);
  const stamp = new Date().toISOString();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/evidence.json`, JSON.stringify({ generated_at: stamp, checks, evidence }, null, 1) + '\n');
  if (process.argv.includes('--json')) console.log(JSON.stringify({ generated_at: stamp, checks }, null, 1));
  else for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(34)} ${c.detail}`);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed · evidence → ${OUT_DIR}/evidence.json`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
