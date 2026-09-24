/**
 * Recompete replay — the acceptance oracle for Recompete performance gates (read-only).
 *
 * Runs the Recompete map's OWN query code (Canonical Discovery plan → applyMapsRecompeteFilters →
 * the route's page order → fetchFollowOnRows) against the live database for a fixed fixture suite and
 * records, per query:
 *   market IDs (every contract the canonical market matches, mapped or not) · market total (mapped)
 *   · unmapped total · the ordered 1,000-pin page · the follow-on IDs
 * as counts + sha256 fingerprints, so two runs (before/after an index, old/new read shape) can be
 * compared byte-for-byte.
 *
 *   npx tsx scripts/recompete-replay.ts --out before.json
 *   npx tsx scripts/recompete-replay.ts --out after.json --compare before.json   # exit 1 on any difference
 *
 * ⚠ The recompete table is written by an hourly sync (cron :25). Compare runs taken inside the same
 * quiet window, and run the baseline twice: a baseline that disagrees with itself is data churn, not a
 * regression.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { mapsRecompeteRequest, applyMapsRecompeteFilters } from '@/lib/recompete/maps-recompete-discovery';
import { RECOMPETE_PIN_COLS } from '@/lib/recompete/map-pin';
import { fetchFollowOnRows } from '@/lib/recompete/map-follow-ons';

export const RECOMPETE_FIXTURES: Array<[string, Record<string, string>]> = [
  ['ai governance', { q: 'ai governance' }],
  ['cybersecurity', { q: 'cybersecurity' }],
  ['janitorial', { q: 'janitorial' }],
  ['software license', { q: 'software license' }],
  ['nonsense', { q: 'xqzvplk florbnax' }],
  ['broad capability list', { q: 'program management, training, technical writing, logistics, data analytics, systems engineering' }],
  ['NAICS 541512', { naics: '541512' }],
];
const BBOX = { west: -125, south: 24, east: -66.9, north: 49.6 };
const sha = (xs: string[]) => createHash('sha256').update(xs.join('\n')).digest('hex').slice(0, 16);

function arg(name: string) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; }

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const from = () => db.from('recompete_opportunities');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bbox = (q: any) => q.gte('map_lat', BBOX.south).lte('map_lat', BBOX.north).gte('map_lng', BBOX.west).lte('map_lng', BBOX.east);
  const out: Record<string, unknown> = {};
  for (const [name, params] of RECOMPETE_FIXTURES) {
    const req = mapsRecompeteRequest((k) => params[k] ?? null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apply = (q: any, mapped: 'only' | 'none' | 'any' = 'only') => applyMapsRecompeteFilters(q, req, mapped);
    const t0 = Date.now();
    const ids: string[] = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await apply(from().select('contract_id'), 'any').order('contract_id', { ascending: true }).range(off, off + 999);
      if (error) throw new Error(`${name} market ids: ${error.message}`);
      const page = (data || []) as Array<{ contract_id: string }>;
      ids.push(...page.map((r) => r.contract_id));
      if (page.length < 1000) break;
    }
    const tot = await apply(from().select('contract_id', { count: 'exact', head: true }));
    const unm = await apply(from().select('contract_id', { count: 'exact', head: true }), 'none');
    if (tot.error || unm.error) throw new Error(`${name} counts: ${(tot.error || unm.error)!.message}`);
    // The route's page: same filters, same order (expiry → contract_id), same cap. Full rows, byte-compared.
    const pg = await bbox(apply(from().select(RECOMPETE_PIN_COLS)))
      .order('period_of_performance_current_end', { ascending: true }).order('contract_id', { ascending: true }).limit(1000);
    if (pg.error) throw new Error(`${name} page: ${pg.error.message}`);
    const pageRows = (pg.data || []) as Array<Record<string, unknown>>;
    const fo = await fetchFollowOnRows({ from, applyPlan: (q) => apply(q), bbox, cols: RECOMPETE_PIN_COLS, cap: 1000 });
    out[name] = {
      market: { n: ids.length, sha: sha(ids) },
      total: tot.count, unmapped: unm.count,
      page: { n: pageRows.length, idsSha: sha(pageRows.map((r) => String(r.contract_id))), rowsSha: sha([JSON.stringify(pageRows)]) },
      followOns: { n: fo.length, sha: sha(fo.map((r) => String(r.contract_id))) },
      ms: Date.now() - t0,
    };
    console.log(name.padEnd(24), JSON.stringify(out[name]));
  }
  const file = arg('--out'); if (file) writeFileSync(file, JSON.stringify(out, null, 1));
  const cmp = arg('--compare');
  if (cmp) {
    const before = JSON.parse(readFileSync(cmp, 'utf8'));
    let bad = 0;
    for (const [name] of RECOMPETE_FIXTURES) {
      const a = { ...before[name], ms: 0 }, b = { ...(out[name] as object), ms: 0 };
      const same = JSON.stringify(a) === JSON.stringify(b);
      if (!same) bad++;
      console.log(`${same ? '✓' : '✗'} ${name}${same ? '' : `\n   before ${JSON.stringify(a)}\n   after  ${JSON.stringify(b)}`}`);
    }
    console.log(bad ? `\n✗ ${bad} fixture(s) differ` : `\n✓ all ${RECOMPETE_FIXTURES.length} fixtures byte-identical (market IDs · total · unmapped · ordered page rows · follow-ons)`);
    process.exit(bad ? 1 : 0);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
