/**
 * Bounded re-stamp of STORED map coordinates after the city-coordinate correction (#1824).
 *
 * Open Now (sam_opportunities), Coming Back (recompete_opportunities) and Coming Soon
 * (agency_forecasts) read stored map_lat/map_lng, stamped from the old single-ZIP city table.
 * This moves ONLY those two columns, and only for rows whose stored point is PROVEN to be
 * "old city coordinate + this row's own deterministic jitter" for a city the correction
 * changed:
 *
 *   base = stored − cityJitterOffset(stableSeed(row id))
 *   base must EQUAL the manifest's `from` for exactly one corrected CITY|ST in the row's state
 *   Open / Coming Soon: the live geocode chain under the corrected table must also land on
 *     `to + offset` — proves the row was placed by that city, not by a ZIP centroid that
 *     happens to coincide with the old city point.
 *   Coming Back (task-order city, not stored on the row): map_loc_source = 'task_order_city',
 *     the matching key's state = place_of_performance_state, and the old point is unique among
 *     corrected keys in that state.
 *   new = to + offset
 *
 * Anything that does not reproduce exactly is AMBIGUOUS and left alone. No other column is
 * written; on recompete the BEFORE UPDATE triggers (which recompute lead_time_months,
 * recompete_likelihood and updated_at) are bypassed with session_replication_role=replica so
 * the coordinate write touches nothing else. Each UPDATE is guarded on the old coordinates.
 *
 *   npx tsx scripts/geo/restamp-stored-city-coords.ts                  # dry run (default)
 *   npx tsx scripts/geo/restamp-stored-city-coords.ts --apply --snapshot <file>
 *     --apply refuses unless the snapshot file (written by the dry run) exists and matches.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';
import { CITY_COORDS } from '../../src/lib/geo/city-geocode';
import { resolvePinCoord } from '../../src/lib/opportunities/map-data';
import { resolveNavyPlace } from '../../src/lib/forecasts/navy-installations';
import { normalizeStateCode } from '../../src/lib/utils/us-states';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDatabaseUrl } = require('../lib/db-url.js');

config({ path: '.env.local', quiet: true });
const APPLY = process.argv.includes('--apply');
const argv = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const ROOT = path.resolve(__dirname, '../..');
const MANIFEST = path.join(ROOT, 'data/geo/us-city-coords-corrections-2026-10-04.json');
const OUT_DIR = path.join(ROOT, '.claude/coord-restamp');
const EPS = 1e-6;

type LL = [number, number];
const manifestRaw = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as {
  applied: Array<{ key: string; from: LL; to: LL }>; held_resolved?: Array<{ key: string; from: LL; to: LL }>;
};
// automatic corrections (<= 25 km) plus the held moves individually PROVEN same place
// RESTAMP_SCOPE: 'auto' = only the automatic (<= 25 km) corrections; 'held' = only the held moves
// individually proven same place (each an explicit, approved exception to the 25 km rule);
// unset = both.
const SCOPE = process.env.RESTAMP_SCOPE;
const manifest = { applied: [
  ...(SCOPE === 'held' ? [] : manifestRaw.applied),
  ...(SCOPE === 'auto' ? [] : (manifestRaw.held_resolved ?? [])),
] };
if (SCOPE && SCOPE !== 'auto' && SCOPE !== 'held') throw new Error(`unknown RESTAMP_SCOPE ${SCOPE}`);
const corrected = new Map(manifest.applied.map((r) => [r.key, r]));
// old coordinate → corrected keys sharing it, per state (old points are ZIP centroids; some are shared)
const byOld = new Map<string, string[]>();
const oldKey = (st: string, ll: LL) => `${st}|${ll[0].toFixed(4)}|${ll[1].toFixed(4)}`;
for (const r of manifest.applied) {
  const st = r.key.slice(r.key.lastIndexOf('|') + 1);
  const k = oldKey(st, r.from);
  (byOld.get(k) || byOld.set(k, []).get(k)!).push(r.key);
}
// the corrected table must actually be live in this checkout
for (const r of manifest.applied.slice(0, 50).concat(manifest.applied.slice(-10))) {
  if (CITY_COORDS[r.key][0] !== r.to[0] || CITY_COORDS[r.key][1] !== r.to[1]) throw new Error(`table not corrected for ${r.key}`);
}

function stableSeed(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
function offset(seed: number): LL { const s = seed % 12; return [(s - 6) * 0.011, (((s * 5) % 12) - 6) * 0.011]; }
const near = (a: number, b: number) => Math.abs(a - b) < EPS;
const km = (a: LL, b: LL) => { const r = Math.PI / 180; const x = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(x)); };

// verbatim from scripts/backfill-forecast-latlng.ts (the chain that stamped agency_forecasts)
function cleanForecastState(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (/nationwide|not specified|various|multiple/i.test(s)) return null;
  s = s.replace(/[\s,]+(united states of america|united states|u\.?s\.?a\.?|u\.?s\.?)\s*$/i, '').trim();
  const cityState = /^(.+),\s*([A-Za-z]{2})$/.exec(s);
  if (cityState) s = cityState[2].toUpperCase();
  return s || null;
}
function navyShorthandState(raw: string | null): { city: string | null; state: string | null } | null {
  if (!raw) return null;
  const p = resolveNavyPlace(raw);
  if (!p || (!p.state && !p.city)) return null;
  return { city: p.city ?? null, state: p.state ?? null };
}

type Verdict = { id: string; from: LL; to: LL; key: string; move_km: number };
type Tally = { surface: string; scanned: number; affected: number; unchanged: number; already_correct: number; zip_placed: number; ambiguous: number; max_km: number; over_25km: number; ambiguousSamples: string[] };

function classify(
  stored: LL, seedId: string, states: string[],
  chainNew: (() => { lat: number; lng: number } | null) | null,
): { kind: 'affected' | 'unchanged' | 'already' | 'zip_placed' | 'ambiguous'; key?: string; to?: LL; reason?: string } {
  const o = offset(stableSeed(seedId));
  const base: LL = [stored[0] - o[0], stored[1] - o[1]];
  const hits = states.flatMap((st) => byOld.get(oldKey(st, base)) || [])
    .filter((k) => near(corrected.get(k)!.from[0], base[0]) && near(corrected.get(k)!.from[1], base[1]));
  if (hits.length === 0) {
    // already moved? (stamped after the correction deployed)
    const alreadyHit = states.some((st) => manifest.applied.some((r) => r.key.endsWith('|' + st) && near(r.to[0], base[0]) && near(r.to[1], base[1])));
    return { kind: alreadyHit ? 'already' : 'unchanged' };
  }
  if (hits.length > 1) return { kind: 'ambiguous', reason: `old point shared by ${hits.join(', ')}` };
  const key = hits[0]; const r = corrected.get(key)!;
  const to: LL = [+(r.to[0] + o[0]).toFixed(6), +(r.to[1] + o[1]).toFixed(6)];
  if (chainNew) {
    const g = chainNew();
    // The chain still lands on the stored point: the row was placed by a ZIP (or office) centroid
    // that coincides with the old city point. That point is a real ZIP location and stays.
    if (g && near(g.lat, stored[0]) && near(g.lng, stored[1])) return { kind: 'zip_placed' };
    if (!g || !near(g.lat, to[0]) || !near(g.lng, to[1])) return { kind: 'ambiguous', reason: `${key}: geocode chain lands elsewhere (${g ? g.lat.toFixed(4) + ',' + g.lng.toFixed(4) : 'none'})` };
  }
  return { kind: 'affected', key, to };
}

async function main() {
  const c = new Client({ connectionString: getDatabaseUrl(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  const tallies: Tally[] = []; const plan: Record<string, Verdict[]> = {};
  const run = async (surface: string, sql: string, each: (r: Record<string, unknown>) => ReturnType<typeof classify> & { id: string; stored: LL }) => {
    const t: Tally = { surface, scanned: 0, affected: 0, unchanged: 0, already_correct: 0, zip_placed: 0, ambiguous: 0, max_km: 0, over_25km: 0, ambiguousSamples: [] };
    plan[surface] = [];
    const { rows } = await c.query(sql);
    for (const r of rows) {
      t.scanned++;
      const v = each(r);
      if (v.kind === 'unchanged') t.unchanged++;
      else if (v.kind === 'already') t.already_correct++;
      else if (v.kind === 'zip_placed') t.zip_placed++;
      else if (v.kind === 'ambiguous') { t.ambiguous++; if (t.ambiguousSamples.length < 8) t.ambiguousSamples.push(`${v.id}: ${v.reason}`); }
      else {
        const d = km(v.stored, v.to!); t.affected++; t.max_km = Math.max(t.max_km, +d.toFixed(2)); if (d > 25) t.over_25km++;
        plan[surface].push({ id: v.id, from: v.stored, to: v.to!, key: v.key!, move_km: +d.toFixed(2) });
      }
    }
    tallies.push(t);
  };

  await run('open (sam_opportunities)',
    `SELECT notice_id, title, pop_city, pop_state, pop_zip, pop_country, office_address, map_lat::float8 lat, map_lng::float8 lng
       FROM sam_opportunities WHERE map_lat IS NOT NULL AND map_lng IS NOT NULL`,
    (r) => {
      const stored: LL = [Number(r.lat), Number(r.lng)];
      const office = (r.office_address || null) as { state?: string } | null;
      const states = [...new Set([normalizeStateCode(String(r.pop_state || '')), normalizeStateCode(office?.state || '')].filter(Boolean) as string[])];
      const seedId = String(r.notice_id ?? r.title ?? '');
      const v = classify(stored, seedId, states, () => resolvePinCoord(r as Parameters<typeof resolvePinCoord>[0]));
      return { ...v, id: String(r.notice_id), stored };
    });

  await run('coming back (recompete_opportunities)',
    `SELECT contract_id, place_of_performance_state, map_lat::float8 lat, map_lng::float8 lng
       FROM recompete_opportunities WHERE map_loc_source = 'task_order_city' AND map_lat IS NOT NULL AND map_lng IS NOT NULL`,
    (r) => {
      const stored: LL = [Number(r.lat), Number(r.lng)];
      const st = normalizeStateCode(String(r.place_of_performance_state || ''));
      const v = classify(stored, String(r.contract_id ?? ''), st ? [st] : [], null);
      return { ...v, id: String(r.contract_id), stored };
    });

  await run('coming soon (agency_forecasts)',
    `SELECT id, title, pop_city, pop_state, pop_zip, pop_country, map_lat::float8 lat, map_lng::float8 lng
       FROM agency_forecasts WHERE map_lat IS NOT NULL AND map_lng IS NOT NULL`,
    (r) => {
      const stored: LL = [Number(r.lat), Number(r.lng)];
      const sh = navyShorthandState(r.pop_state as string | null);
      const row = { notice_id: String(r.id), title: r.title as string | null, pop_city: (sh?.city ?? r.pop_city) as string | null,
        pop_state: sh?.state ?? cleanForecastState(r.pop_state as string | null), pop_zip: r.pop_zip as string | null, pop_country: r.pop_country as string | null };
      const st = normalizeStateCode(row.pop_state || '');
      const v = classify(stored, String(r.id), st ? [st] : [], () => resolvePinCoord(row));
      return { ...v, id: String(r.id), stored };
    });

  console.log('surface | scanned | rows affected | unchanged | ZIP-placed (correct, unchanged) | ambiguous | max displacement | >25km');
  for (const t of tallies) console.log(`${t.surface} | ${t.scanned} | ${t.affected} | ${t.unchanged + t.already_correct} | ${t.zip_placed} | ${t.ambiguous} | ${t.max_km} km | ${t.over_25km}`);
  for (const t of tallies) if (t.ambiguousSamples.length) console.log(`\nambiguous samples — ${t.surface}:\n  ` + t.ambiguousSamples.join('\n  '));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!APPLY) {
    const snap = path.join(OUT_DIR, `restamp-plan-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(snap, JSON.stringify({ createdAt: new Date().toISOString(), tallies, plan }));
    console.log(`\nDRY RUN — zero writes. Snapshot + plan: ${path.relative(ROOT, snap)}`);
    await c.end(); return;
  }

  // ── APPLY: only the rows in the dry-run snapshot, only if the fresh classification agrees
  const snapPath = argv('--snapshot');
  if (!snapPath || !fs.existsSync(snapPath)) throw new Error('--apply requires --snapshot <dry-run file>');
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as { plan: Record<string, Verdict[]> };
  const TABLES: Record<string, { table: string; idCol: string }> = {
    'open (sam_opportunities)': { table: 'sam_opportunities', idCol: 'notice_id' },
    'coming back (recompete_opportunities)': { table: 'recompete_opportunities', idCol: 'contract_id' },
    'coming soon (agency_forecasts)': { table: 'agency_forecasts', idCol: 'id' },
  };
  for (const [surface, rows] of Object.entries(snap.plan)) {
    const fresh = new Map(plan[surface].map((v) => [v.id, v]));
    const todo = rows.filter((v) => { const f = fresh.get(v.id); return f && near(f.to[0], v.to[0]) && near(f.to[1], v.to[1]); });
    const { table, idCol } = TABLES[surface];
    let written = 0;
    for (let i = 0; i < todo.length; i += 500) {
      const batch = todo.slice(i, i + 500);
      await c.query('BEGIN');
      await c.query("SET LOCAL session_replication_role = 'replica'"); // no triggers: coordinates only
      for (const v of batch) {
        const res = await c.query(
          `UPDATE ${table} SET map_lat = $1, map_lng = $2
            WHERE ${idCol} = $3 AND abs(map_lat - $4) < 1e-6 AND abs(map_lng - $5) < 1e-6`,
          [v.to[0], v.to[1], v.id, v.from[0], v.from[1]]);
        written += res.rowCount ?? 0;
      }
      await c.query('COMMIT');
    }
    console.log(`${surface}: planned ${rows.length}, still valid ${todo.length}, written ${written}`);
  }
  await c.end();
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
