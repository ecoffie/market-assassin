#!/usr/bin/env node
/**
 * City-coordinate integrity — reproducible audit + correction of src/data/us-city-coords.json.
 *
 * WHY. The table shipped in #410 with no generator. Each entry is the centroid of ONE ZIP that
 * carries the city name (RICHMOND|VA = ZIP 23234, a Chesterfield ZIP 10.5 km south of the city;
 * NEW YORK|NY = 10001), not the place. Richmond pins therefore drew outside a downtown-Richmond
 * viewport (Players acceptance check 5, 2026-10-04).
 *
 * SOURCE OF TRUTH (US Census Bureau, public domain):
 *   - 2024 Gazetteer places      https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip
 *     → INTPTLAT/INTPTLONG = the Census internal point of each incorporated place / CDP.
 *   - 2024 cartographic places   https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_place_500k.zip
 *     → the place boundary, used to decide whether the CURRENT point is inside the named place.
 *
 * RULE (correct only what is established):
 *   1. Match `CITY|ST` to exactly one Census place in that state (name normalised; an incorporated
 *      place wins over CDPs of the same name; any remaining tie = ambiguous → unchanged).
 *   2. Leave the entry alone if its current point is inside the place boundary, or within 0.5 km of
 *      it (500k generalisation noise). A ZIP centroid inside the city is a fine city point.
 *   3. Otherwise replace it with the Census internal point, which must itself lie in the polygon,
 *      but only when the move is ≤ 25 km. Larger moves are mostly homonyms (postal Voorhees, NJ is
 *      in Camden County; the Census "Voorhees CDP" is 81 km away), so they are HELD for review.
 *   Unmatched postal localities (no Census place, e.g. NORTH CHESTERFIELD) are unchanged.
 *
 * Usage: node scripts/geo/correct-city-coords.mjs --gazetteer <2024_Gaz_place_national.txt>
 *          --places <dir with cb_2024_us_place_500k.shp/.dbf> [--write]
 *   Dry-run prints the summary. --write rewrites the table and writes the manifest
 *   data/geo/us-city-coords-corrections-2026-10-04.json (applied + held).
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const GAZ = arg('--gazetteer'), PLACES = arg('--places'), WRITE = process.argv.includes('--write');
if (!GAZ || !PLACES) { console.error('need --gazetteer and --places'); process.exit(2); }
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const TABLE = path.join(ROOT, 'src/data/us-city-coords.json');
const MANIFEST = path.join(ROOT, 'data/geo/us-city-coords-corrections-2026-10-04.json');
export const MAX_MOVE_KM = 25;
export const EDGE_TOLERANCE_KM = 0.5;

const SUFFIX = /\s+(city and borough|consolidated government \(balance\)|consolidated government|metropolitan government \(balance\)|metropolitan government|metro government \(balance\)|unified government \(balance\)|unified government|city \(balance\)|urban county|metro township|municipality|corporation|comunidad|zona urbana|borough|village|town|city|CDP)$/;
export function normPlace(n) {
  return n.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\./g, '').replace(/'/g, '').replace(/-/g, ' ')
    .replace(/^SAINT /, 'ST ').replace(/^STE /, 'ST ').replace(/^SAINTE /, 'ST ')
    .replace(/^MOUNT /, 'MT ').replace(/^FORT /, 'FT ')
    .replace(/^MC(?=[A-Z])/, 'MC ').replace(/\s+/g, ' ').trim();
}
const hav = (a, b, c, d) => { const r = Math.PI / 180; const x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(x)); };

// ── Gazetteer
const places = new Map();
for (const l of fs.readFileSync(GAZ, 'utf8').split('\n').slice(1)) {
  if (!l.trim()) continue;
  const f = l.split('\t').map((s) => s.trim());
  const [st, geoid, , name, , funcstat] = f;
  const k = normPlace(name.replace(SUFFIX, '')) + '|' + st;
  (places.get(k) || places.set(k, []).get(k)).push({ lat: +f[10], lng: +f[11], name, funcstat, geoid });
}
// ── Cartographic boundaries (minimal shapefile/dbf reader; polygons only)
const dbf = fs.readFileSync(path.join(PLACES, 'cb_2024_us_place_500k.dbf'));
const nrec = dbf.readUInt32LE(4), hlen = dbf.readUInt16LE(8), rlen = dbf.readUInt16LE(10);
const fields = []; for (let o = 32; dbf[o] !== 0x0d; o += 32) fields.push({ name: dbf.toString('latin1', o, o + 11).replace(/\0.*$/, ''), len: dbf[o + 16] });
const geoids = []; for (let i = 0; i < nrec; i++) { let o = hlen + i * rlen + 1; let g = ''; for (const f of fields) { if (f.name === 'GEOID') g = dbf.toString('latin1', o, o + f.len).trim(); o += f.len; } geoids.push(g); }
const shp = fs.readFileSync(path.join(PLACES, 'cb_2024_us_place_500k.shp'));
const polyByGeoid = new Map(); let off = 100, idx = 0;
while (off < shp.length) {
  const len = shp.readInt32BE(off + 4) * 2, c = off + 8;
  if (shp.readInt32LE(c) === 5) {
    const np = shp.readInt32LE(c + 36), npt = shp.readInt32LE(c + 40);
    const parts = []; for (let i = 0; i < np; i++) parts.push(shp.readInt32LE(c + 44 + 4 * i));
    const pb = c + 44 + 4 * np; const pts = new Float64Array(npt * 2);
    for (let i = 0; i < npt * 2; i++) pts[i] = shp.readDoubleLE(pb + 8 * i);
    polyByGeoid.set(geoids[idx], { parts, pts, npt });
  }
  idx++; off = c + len;
}
const rings = (p, fn) => { for (let k = 0; k < p.parts.length; k++) fn(p.parts[k], k + 1 < p.parts.length ? p.parts[k + 1] : p.npt); };
function inPoly(p, x, y) { let c = false; rings(p, (s, e) => { for (let i = s, j = e - 1; i < e; j = i++) { const xi = p.pts[2 * i], yi = p.pts[2 * i + 1], xj = p.pts[2 * j], yj = p.pts[2 * j + 1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } }); return c; }
function edgeKm(p, x, y) { let best = Infinity; const kx = 111.32 * Math.cos(y * Math.PI / 180), ky = 110.57; rings(p, (s, e) => { for (let i = s; i < e - 1; i++) { const ax = (p.pts[2 * i] - x) * kx, ay = (p.pts[2 * i + 1] - y) * ky, bx = (p.pts[2 * i + 2] - x) * kx, by = (p.pts[2 * i + 3] - y) * ky; const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / ((dx * dx + dy * dy) || 1))); best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy)); } }); return best; }

// ── Audit
const table = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
const applied = [], held = []; const s = { entries: 0, unmatched: 0, ambiguous: 0, inside: 0, edge: 0, applied: 0, held: 0, canonOutside: 0 };
for (const [key, [lat, lng]] of Object.entries(table)) {
  s.entries++;
  const i = key.lastIndexOf('|'); const cityName = key.slice(0, i), st = key.slice(i + 1);
  let cand = places.get(normPlace(cityName) + '|' + st) || [];
  if (cand.length === 0) { s.unmatched++; continue; }
  if (cand.length > 1) { const inc = cand.filter((c) => c.funcstat === 'A'); if (inc.length === 1) cand = inc; }
  if (cand.length > 1) { s.ambiguous++; continue; }
  const pl = cand[0]; const poly = polyByGeoid.get(pl.geoid);
  if (!poly) { s.unmatched++; continue; }
  if (inPoly(poly, lng, lat)) { s.inside++; continue; }
  const edge = edgeKm(poly, lng, lat);
  if (edge <= EDGE_TOLERANCE_KM) { s.edge++; continue; }
  if (!inPoly(poly, pl.lng, pl.lat)) { s.canonOutside++; continue; }
  const to = [+pl.lat.toFixed(4), +pl.lng.toFixed(4)];
  const move = +hav(lat, lng, to[0], to[1]).toFixed(2);
  const row = { key, from: [lat, lng], to, move_km: move, outside_by_km: +edge.toFixed(2), place: pl.name, geoid: pl.geoid };
  if (move <= MAX_MOVE_KM) { applied.push(row); s.applied++; table[key] = to; } else { held.push(row); s.held++; }
}
console.log(s);
if (WRITE) {
  fs.writeFileSync(TABLE, JSON.stringify(table));
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify({
    source: { gazetteer: '2024_Gaz_place_national', boundaries: 'cb_2024_us_place_500k', rule: { maxMoveKm: MAX_MOVE_KM, edgeToleranceKm: EDGE_TOLERANCE_KM } },
    summary: s, applied, held,
  }, null, 0));
  console.log('wrote', path.relative(ROOT, TABLE), 'and', path.relative(ROOT, MANIFEST));
}
