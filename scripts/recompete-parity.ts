/**
 * Recompete COMPUTE-ONCE parity oracle (Gate 2, 2026-09-24). Read-only.
 *
 * For every fixture, run BOTH:
 *   OLD — today's live multi-read path, the exact supabase-js/PostgREST calls recompete-map makes:
 *         market total (head count) · unmapped (head count) · viewport page with its exact count ·
 *         follow-ons (map-follow-ons.ts) — plus, for the oracle only, every market id.
 *   NEW — ONE statement from recompeteOnePassSql() (maps-recompete-sql.ts), executed directly.
 * and require BYTE identity on:
 *   market IDs · market total · unmapped · in-view count · ordered pin rows (full JSON) ·
 *   follow-on rows (full JSON) · the final merged pin list the route would ship.
 *
 *   npx tsx scripts/recompete-parity.ts                 # full suite
 *   npx tsx scripts/recompete-parity.ts --only drones   # substring filter on fixture ids
 *   npx tsx scripts/recompete-parity.ts --json out.json
 *
 * Exit 1 on any difference. A difference is re-run once on BOTH sides before it counts, so a row the
 * hourly sync (cron :25) rewrote between the two reads is reported as CHURN, not as a parity failure.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { FIXTURES } from '@/lib/discovery/__fixtures__/fixtures';
import { mapsRecompeteRequest, applyMapsRecompeteFilters } from '@/lib/recompete/maps-recompete-discovery';
import { RECOMPETE_PIN_COLS } from '@/lib/recompete/map-pin';
import { fetchFollowOnRows } from '@/lib/recompete/map-follow-ons';
import { recompeteOnePassSql } from '@/lib/recompete/maps-recompete-sql';

type Params = Record<string, string>;
type BBox = { west: number; south: number; east: number; north: number };
const CONUS: BBox = { west: -125, south: 24, east: -66.9, north: 49.6 };
const DC: BBox = { west: -77.2, south: 38.8, east: -76.9, north: 39.0 };
const OCEAN: BBox = { west: -40, south: 10, east: -30, north: 20 };
const ALASKA: BBox = { west: -170, south: 50, east: -129, north: 72 };
const CAP = 1000;

function suite(): Array<{ id: string; params: Params; bbox: BBox }> {
  const s: Array<{ id: string; params: Params; bbox: BBox }> = [];
  const toParams = (inp: Record<string, unknown>): Params => {
    const p: Params = {};
    if (inp.query) p.q = String(inp.query);
    if (inp.agency) p.agency = String(inp.agency);
    if (inp.naics) p.naics = String(inp.naics);
    if (inp.state) p.state = String(inp.state);
    return p;
  };
  // 1 · every canonical discovery fixture (the golden-plan + cross-surface set)
  for (const f of FIXTURES) s.push({ id: `canon:${f.id}`, params: toParams(f.input as unknown as Record<string, unknown>), bbox: CONUS });
  // 2 · the Gate 1 acceptance queries not already in the canonical set
  s.push({ id: 'gate:broad capability list', params: { q: 'program management, training, technical writing, logistics, data analytics, systems engineering' }, bbox: CONUS });
  s.push({ id: 'gate:nonsense', params: { q: 'xqzvplk florbnax' }, bbox: CONUS });
  s.push({ id: 'gate:NAICS 541512', params: { naics: '541512' }, bbox: CONUS });
  // 3 · every Maps SURFACE filter (the part of the market the plan does not own)
  s.push({ id: 'surface:setAside SB-Total + 541512', params: { naics: '541512', setAside: 'SB-Total' }, bbox: CONUS });
  s.push({ id: 'surface:setAside 8(a) + cybersecurity', params: { q: 'cybersecurity', setAside: '8(a)' }, bbox: CONUS });
  s.push({ id: 'surface:subAgency Veterans + janitorial', params: { q: 'janitorial', subAgency: 'Veterans' }, bbox: CONUS });
  s.push({ id: 'surface:value 1M–50M + cybersecurity', params: { q: 'cybersecurity', minValue: '1000000', maxValue: '50000000' }, bbox: CONUS });
  s.push({ id: 'surface:sap friendly + 541512', params: { naics: '541512', sap: 'friendly' }, bbox: CONUS });
  s.push({ id: 'surface:sap gated + software license', params: { q: 'software license', sap: 'gated' }, bbox: CONUS });
  s.push({ id: 'surface:likelihood high + 236220', params: { naics: '236220', likelihood: 'high' }, bbox: CONUS });
  s.push({ id: 'surface:leadMax 6 + cybersecurity', params: { q: 'cybersecurity', leadMax: '6' }, bbox: CONUS });
  s.push({ id: 'surface:agency VA + state VA', params: { agency: 'VA', state: 'VA' }, bbox: CONUS });
  s.push({ id: 'surface:everything at once', params: { q: 'cybersecurity', setAside: 'SB-Total', minValue: '100000', sap: 'friendly', likelihood: 'high', leadMax: '12' }, bbox: CONUS });
  // 4 · presentation: other viewports (bbox only changes pins/in-view/follow-ons, never the market)
  s.push({ id: 'bbox:DC janitorial', params: { q: 'janitorial' }, bbox: DC });
  s.push({ id: 'bbox:DC 541512', params: { naics: '541512' }, bbox: DC });
  s.push({ id: 'bbox:ocean cybersecurity', params: { q: 'cybersecurity' }, bbox: OCEAN });
  s.push({ id: 'bbox:Alaska broad', params: { q: 'program management, training, technical writing, logistics, data analytics, systems engineering' }, bbox: ALASKA });
  return s;
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const from = () => db.from('recompete_opportunities');

type Result = {
  marketIds: string[]; total: number; unmapped: number; inView: number;
  pins: unknown[]; followOns: unknown[]; merged: string[]; ms: number;
};

/** Route merge rule (recompete-map/route.ts): page first, then follow-ons the page missed. */
function merge(pins: Array<Record<string, unknown>>, fo: Array<Record<string, unknown>>): string[] {
  const seen = new Set(pins.map((r) => String(r.contract_id)));
  return [...pins.map((r) => String(r.contract_id)), ...fo.filter((r) => !seen.has(String(r.contract_id))).map((r) => String(r.contract_id))];
}

async function oldPath(params: Params, bbox: BBox): Promise<Result> {
  const req = mapsRecompeteRequest((k) => params[k] ?? null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apply = (q: any, mapped: 'only' | 'none' | 'any' = 'only') => applyMapsRecompeteFilters(q, req, mapped);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bb = (q: any) => q.gte('map_lat', bbox.south).lte('map_lat', bbox.north).gte('map_lng', bbox.west).lte('map_lng', bbox.east);
  const t0 = Date.now();
  // exactly the route's reads and concurrency (recompete-map/route.ts on main)
  const [tot, unm] = await Promise.all([
    apply(from().select('contract_id', { count: 'exact', head: true })),
    apply(from().select('contract_id', { count: 'exact', head: true }), 'none'),
  ]);
  const [view, fo] = await Promise.all([
    bb(apply(from().select(RECOMPETE_PIN_COLS, { count: 'exact' })))
      .order('period_of_performance_current_end', { ascending: true }).order('contract_id', { ascending: true }).limit(CAP),
    fetchFollowOnRows({ from, applyPlan: (q) => apply(q), bbox: bb, cols: RECOMPETE_PIN_COLS, cap: CAP }),
  ]);
  const ms = Date.now() - t0;
  for (const r of [tot, unm, view]) if (r.error) throw new Error(`old path: ${r.error.message}`);
  const ids: string[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await apply(from().select('contract_id'), 'any').order('contract_id', { ascending: true }).range(off, off + 999);
    if (error) throw new Error(`old path ids: ${error.message}`);
    const page = (data || []) as Array<{ contract_id: string }>;
    ids.push(...page.map((r) => r.contract_id));
    if (page.length < 1000) break;
  }
  // market ids in the DATABASE collation, exactly like the one-pass json_agg(ORDER BY _id)
  const pins = (view.data || []) as Array<Record<string, unknown>>;
  return { marketIds: ids, total: tot.count ?? -1, unmapped: unm.count ?? -1, inView: view.count ?? -1,
    pins, followOns: fo, merged: merge(pins, fo as Array<Record<string, unknown>>), ms };
}

async function newPath(pg: Client, params: Params, bbox: BBox): Promise<Result & { sqlChars: number }> {
  const req = mapsRecompeteRequest((k) => params[k] ?? null);
  const { text, values } = recompeteOnePassSql(req, { bbox, cap: CAP, pinCols: RECOMPETE_PIN_COLS, withMarketIds: true });
  const t0 = Date.now();
  const r = (await pg.query(text, values)).rows[0];
  const ms = Date.now() - t0;
  const pins = r.pins as Array<Record<string, unknown>>, fo = r.follow_ons as Array<Record<string, unknown>>;
  return { marketIds: r.market_ids, total: Number(r.total), unmapped: Number(r.unmapped), inView: Number(r.in_view),
    pins, followOns: fo, merged: merge(pins, fo), ms, sqlChars: text.length };
}
/** Timing-only variant: the statement the route would run (no market-id list). */
async function newPathTimed(pg: Client, params: Params, bbox: BBox): Promise<number> {
  const req = mapsRecompeteRequest((k) => params[k] ?? null);
  const { text, values } = recompeteOnePassSql(req, { bbox, cap: CAP, pinCols: RECOMPETE_PIN_COLS });
  const t0 = Date.now(); await pg.query(text, values); return Date.now() - t0;
}

const FIELDS = ['marketIds', 'total', 'unmapped', 'inView', 'pins', 'followOns', 'merged'] as const;
function diff(a: Result, b: Result): string[] {
  return FIELDS.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

async function main() {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
  const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
  const pg = new Client({ connectionString: process.env.DATABASE_URL, application_name: 'recompete-parity (read-only)' });
  await pg.connect();
  await pg.query("SET statement_timeout = '120s'");
  await pg.query('SET default_transaction_read_only = on');
  const rows: Array<Record<string, unknown>> = [];
  let failed = 0, churn = 0;
  for (const f of suite().filter((x) => !only || x.id.includes(only))) {
    let a = await oldPath(f.params, f.bbox);
    let b = await newPath(pg, f.params, f.bbox);
    let d = diff(a, b);
    let status = d.length ? 'DIFF' : 'IDENTICAL';
    if (d.length) {                               // re-run both: separate reads can straddle a sync write
      const a2 = await oldPath(f.params, f.bbox), b2 = await newPath(pg, f.params, f.bbox);
      const d2 = diff(a2, b2);
      if (!d2.length) { status = 'CHURN (identical on re-run)'; churn++; a = a2; b = b2; d = d2; }
      else { failed++; a = a2; b = b2; d = d2; }
    }
    const tNew = await newPathTimed(pg, f.params, f.bbox);
    const row = { id: f.id, status, differs: d, market: a.marketIds.length, total: a.total, unmapped: a.unmapped, inView: a.inView,
      pins: (a.pins as unknown[]).length, followOns: (a.followOns as unknown[]).length, oldMs: a.ms, newMs: tNew };
    rows.push(row);
    console.log(`${status === 'IDENTICAL' ? '✓' : status.startsWith('CHURN') ? '~' : '✗'} ${f.id.padEnd(44)} market=${String(a.marketIds.length).padStart(6)} total=${String(a.total).padStart(6)} unmapped=${String(a.unmapped).padStart(5)} inView=${String(a.inView).padStart(6)} pins=${String((a.pins as unknown[]).length).padStart(4)} fo=${String((a.followOns as unknown[]).length).padStart(3)} | old ${String(a.ms).padStart(5)} ms → once ${String(tNew).padStart(5)} ms${d.length ? `  DIFFERS: ${d.join(',')}` : ''}`);
  }
  await pg.end();
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
  console.log(`\n${failed ? '✗' : '✓'} ${rows.length - failed}/${rows.length} fixtures byte-identical (market IDs · total · unmapped · in-view · ordered pin rows · follow-on rows · merged pins)${churn ? ` — ${churn} needed a re-run (sync churn)` : ''}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
