/**
 * Snapshot / verify for restamp-stored-city-coords.ts. For every planned row records the stored
 * map_lat/map_lng and an md5 of EVERY OTHER column, so a write can be proven coordinate-only and
 * rolled back exactly.
 *   npx tsx scripts/geo/restamp-snapshot.ts <plan.json> <out.json>            # snapshot
 *   npx tsx scripts/geo/restamp-snapshot.ts <plan.json> <out.json> --verify <before.json>
 */
import fs from 'node:fs';
import { config } from 'dotenv';
import { Client } from 'pg';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDatabaseUrl } = require('../lib/db-url.js');
config({ path: '.env.local', quiet: true });
const [planPath, outPath] = process.argv.slice(2);
const vi = process.argv.indexOf('--verify'); const beforePath = vi > 0 ? process.argv[vi + 1] : null;
const T: Record<string, [string, string]> = {
  'open (sam_opportunities)': ['sam_opportunities', 'notice_id'],
  'coming back (recompete_opportunities)': ['recompete_opportunities', 'contract_id'],
  'coming soon (agency_forecasts)': ['agency_forecasts', 'id'],
};
(async () => {
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')).plan as Record<string, Array<{ id: string; to: [number, number] }>>;
  const c = new Client({ connectionString: getDatabaseUrl(), ssl: { rejectUnauthorized: false } }); await c.connect();
  await c.query('BEGIN READ ONLY');
  const out: Record<string, Record<string, { lat: number; lng: number; h: string }>> = {};
  for (const [surface, rows] of Object.entries(plan)) {
    const [table, idCol] = T[surface]; out[surface] = {};
    for (let i = 0; i < rows.length; i += 2000) {
      const ids = rows.slice(i, i + 2000).map((r) => r.id);
      const { rows: got } = await c.query(
        `SELECT ${idCol}::text id, map_lat::float8 lat, map_lng::float8 lng, md5((to_jsonb(t) - 'map_lat' - 'map_lng')::text) h
           FROM ${table} t WHERE ${idCol}::text = ANY($1)`, [ids]);
      for (const g of got) out[surface][g.id] = { lat: g.lat, lng: g.lng, h: g.h };
    }
  }
  await c.query('ROLLBACK'); await c.end();
  fs.writeFileSync(outPath, JSON.stringify(out));
  for (const s of Object.keys(out)) console.log(`${s}: ${Object.keys(out[s]).length} rows snapshotted`);
  if (beforePath) {
    const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
    for (const [surface, rows] of Object.entries(plan)) {
      let moved = 0, notMoved = 0, otherChanged = 0;
      const want = new Map(rows.map((r) => [r.id, r.to]));
      for (const [id, a] of Object.entries(out[surface])) {
        const b = before[surface][id]; const to = want.get(id)!;
        if (Math.abs(a.lat - to[0]) < 1e-6 && Math.abs(a.lng - to[1]) < 1e-6) moved++; else notMoved++;
        if (a.h !== b.h) otherChanged++;
      }
      console.log(`${surface}: moved to target ${moved} · not moved ${notMoved} · OTHER COLUMNS CHANGED ${otherChanged}`);
    }
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
