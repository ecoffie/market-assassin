// Cache evaluator parity + local cost (Agent 3, 2026-11-15). Development only; offline; no network, no DB.
// For each benchmark phrasing: compileOps(plan.horizons.open.ops) over the snapshot's open rows must select EXACTLY the
// runner's matched set (the runner equals the real find_opportunities path: route-parity 28/28). Also measures
// serialize/parse/checksum time and heap for the snapshot file the cron would write. Local laptop numbers are a proxy,
// NOT the Vercel measurement (#7).
// usage (inside this checkout): npx tsx tasks/.../cache-parity/parity.mts <corpus.json> <queries_v4.json> <runner.json> <today>
import fs from 'fs';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MCP_POLICY } from '@/lib/discovery/policy';
import { compileOps, SNAPSHOT_COLS } from '@/lib/opportunities/open-cache';
import { serializeOpenSnapshot, parseOpenSnapshot } from '@/lib/opportunities/open-snapshot-store';
const [corpusP, phrP, runP, today] = process.argv.slice(2);
globalThis.fetch = (() => { throw new Error('network disabled'); }) as never;
const rows = JSON.parse(fs.readFileSync(corpusP, 'utf8')).rows as Array<Record<string, unknown>>;
const runner = JSON.parse(fs.readFileSync(runP, 'utf8'));
const phr = JSON.parse(fs.readFileSync(phrP, 'utf8'));
const fy = Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 10 ? 1 : 0);
const list: Array<{ business: string; phrasing: number; query: string }> = [];
for (const [business, v] of Object.entries(phr as Record<string, any>)) {
  const qs: string[] = Array.isArray(v) ? v : (v.q || v.queries || v.phrasings);
  qs.forEach((query, phrasing) => list.push({ business, phrasing, query }));
}
let same = 0, uncacheable = 0; const out: unknown[] = [];
for (const r of runner.results) {
  const plan = buildDiscoveryPlan({ query: r.query }, MCP_POLICY, { today, fiscalYear: fy });
  let ids: string[] | null = null; let why: string | null = null;
  try { const pass = compileOps(plan.horizons.open.ops as never); ids = rows.filter(pass).map((x) => String(x.notice_id)).sort(); }
  catch (e) { why = (e as Error).message; uncacheable++; }
  const exp: string[] = r.matched;
  const ok = ids != null && ids.length === exp.length && ids.every((x, i) => x === exp[i]);
  if (ok) same++;
  const extra = ids ? ids.filter((x) => !new Set(exp).has(x)).length : null;
  const missing = ids ? exp.filter((x) => !new Set(ids!).has(x)).length : null;
  out.push({ business: r.business, phrasing: r.phrasing, runner: exp.length, cache: ids?.length ?? null, extra, missing, uncacheable: why });
  console.log(`${(r.business + '#' + r.phrasing).padEnd(14)} runner ${String(exp.length).padStart(5)} cache ${String(ids?.length ?? '-').padStart(5)} ${ok ? 'SAME' : why ? 'UNCACHEABLE ' + why : `DIFF +${extra} -${missing}`}`);
}
console.log(`\nparity ${same}/${runner.results.length} (uncacheable ${uncacheable})`);
const proj = rows.map((x) => Object.fromEntries(SNAPSHOT_COLS.map((c) => [c, (x[c] ?? null) as string | null])));
const t0 = performance.now(); const snap = { builtAt: new Date().toISOString(), count: proj.length, rows: proj as never };
const { bytes } = serializeOpenSnapshot(snap); const t1 = performance.now();
if (global.gc) global.gc(); const h0 = process.memoryUsage().heapUsed;
const back = parseOpenSnapshot(bytes); const t2 = performance.now(); const h1 = process.memoryUsage().heapUsed;
console.log(`snapshot rows ${back.count} · gzip ${(bytes.length / 1e6).toFixed(1)} MB · serialize+sha ${(t1 - t0).toFixed(0)} ms · gunzip+parse+verify ${(t2 - t1).toFixed(0)} ms · heap +${((h1 - h0) / 1e6).toFixed(0)} MB (laptop proxy)`);
fs.writeFileSync(process.env.OUT || '/dev/null', JSON.stringify({ parity: `${same}/${runner.results.length}`, rows: out }, null, 1));
