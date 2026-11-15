// READ-ONLY benchmark: today's SQL Open path vs cachedOpenRetrieval (open-cache.ts) on Agent 4's 28 phrasings.
// Builds one snapshot (timed, sized), then per query: SQL count + 500-row deadline window vs cache count + window.
// Reports exact parity (count, window ids) where SQL succeeds, latency, and SQL failures (timeouts).
// usage: tsx cache-bench.mts <bench dir> <out.json>
import fs from 'fs';
import zlib from 'zlib';
import { createClient } from '@supabase/supabase-js';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MAPS_POLICY } from '@/lib/discovery/policy';
import { applyOpenPlan } from '@/lib/discovery/apply';
import { buildOpenSnapshot, cachedOpenRetrieval } from '@/lib/opportunities/open-cache';

const [benchDir, outPath] = process.argv.slice(2);
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const Q = JSON.parse(fs.readFileSync(`${benchDir}/queries_v4.json`, 'utf8'));
const SELECT = 'notice_id,title,response_deadline,naics_code,psc_code';
const t0 = Date.now();
const snap = await buildOpenSnapshot(db);
const buildMs = Date.now() - t0;
const json = JSON.stringify(snap);
const size = { json_bytes: Buffer.byteLength(json), gzip_bytes: zlib.gzipSync(json).length };
console.log('snapshot rows', snap.count, 'build ms', buildMs, size);
const out: Record<string, unknown> = { snapshot: { rows: snap.count, built_at: snap.builtAt, build_ms: buildMs, ...size }, queries: {} };
for (const [biz, cfg] of Object.entries<{ q: string[] }>(Q)) {
  for (const [i, q] of cfg.q.entries()) {
    const plan = buildDiscoveryPlan({ query: q }, MAPS_POLICY);
    const s0 = Date.now();
    const [h, w] = await Promise.all([
      applyOpenPlan(db.from('sam_opportunities').select('notice_id', { count: 'exact', head: true }), plan),
      applyOpenPlan(db.from('sam_opportunities').select(SELECT), plan).order('response_deadline', { ascending: true, nullsFirst: false }).limit(500),
    ]);
    const sqlMs = Date.now() - s0;
    const sqlErr = h.error?.message || w.error?.message || null;
    const c0 = Date.now();
    const c = await cachedOpenRetrieval({ client: db, plan, snapshot: snap, select: SELECT, windowLimit: 500 });
    const cacheMs = Date.now() - c0;
    const sqlIds = new Set((w.data || []).map((r: { notice_id: string }) => r.notice_id));
    const cIds = c.status === 'ok' ? new Set(c.rows.map((r) => String(r.notice_id))) : null;
    // Window ids can differ only by tie order at the 500th deadline; compare the sets below the boundary.
    const sameCount = !sqlErr && c.status === 'ok' ? h.count === c.count : null;
    const lastDeadline = (w.data || []).at(-1)?.response_deadline;
    const strictly = (rows: Array<{ notice_id: string; response_deadline: string | null }>) => new Set(rows.filter((r) => (w.data || []).length < 500 || String(r.response_deadline) < String(lastDeadline)).map((r) => r.notice_id));
    const sameWindow = !sqlErr && cIds ? [...strictly(w.data || [])].every((id) => cIds.has(id)) : null;
    (out.queries as Record<string, unknown>)[`${biz}#${i}`] = {
      sql: { ms: sqlMs, count: h.count ?? null, error: sqlErr },
      cache: c.status === 'ok' ? { ms: cacheMs, count: c.count, ...c.coverage } : { ms: cacheMs, unavailable: c.reason },
      parity: { count: sameCount, window: sameWindow, sql_window: sqlIds.size },
    };
    console.log(`${biz}#${i}`.padEnd(14), `SQL ${sqlMs}ms ${sqlErr ? 'ERR ' + sqlErr.slice(0, 30) : h.count}`.padEnd(44),
      c.status === 'ok' ? `CACHE ${cacheMs}ms ${c.count} (cand ${c.coverage.candidates}, delta ${c.coverage.delta_rows})` : `CACHE unavailable: ${c.reason}`,
      sameCount === null ? '' : `count ${sameCount ? '=' : '≠'} window ${sameWindow ? '=' : '≠'}`);
  }
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
