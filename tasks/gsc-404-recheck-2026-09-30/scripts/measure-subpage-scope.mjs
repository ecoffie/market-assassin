// Full production scope of empty /contractors/*/naics and /contractors/*/agencies pages.
// CACHE-ONLY and READ-ONLY: uses the KV *read-only* token (writes are impossible), KV MGET only.
// No BigQuery, no live resolver, no warming, no writes. Sitemap is read from the public URL.
//
// Mirrors production exactly:
//   profile key  bq:{DATA_VERSION}:rollup:by-slug:{slug}:v2-merged      (getRollupBySlug / served-slugs.ts)
//   naics rows   bq:{DATA_VERSION}:rollup:{rollup_uei}:all-naics:v2-m    (getAllNaicsForRecipient)
//   agency rows  bq:{DATA_VERSION}:rollup:{rollup_uei}:all-agencies:v4-m (getAllAgenciesForRecipient)
// queryCached semantics: key absent → 'unavailable' (cold miss, live BQ off); [] → true zero; rows → renderable.
//
// Usage: node --env-file=<.env.local> measure-subpage-scope.mjs <DATA_VERSION> <out.json>
import { createClient } from '@vercel/kv';
import { writeFileSync } from 'node:fs';
const [DATA_VERSION, out] = process.argv.slice(2);
const kv = createClient({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_READ_ONLY_TOKEN });
const B = 200;
const mget = async (keys) => { const res = []; for (let i = 0; i < keys.length; i += B) { res.push(...(await kv.mget(...keys.slice(i, i + B)))); calls++; } return res; };
let calls = 0;

const xml = await (await fetch('https://getmindy.ai/sitemap.xml')).text();
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const sub = { naics: [], agencies: [] };
for (const u of urls) { const m = u.match(/\/contractors\/([^/]+)\/(naics|agencies)$/); if (m) sub[m[2]].push(m[1]); }
const slugs = [...new Set([...sub.naics, ...sub.agencies])];
const profiles = await mget(slugs.map((s) => `bq:${DATA_VERSION}:rollup:by-slug:${s}:v2-merged`));
const prof = new Map(slugs.map((s, i) => [s, Array.isArray(profiles[i]) ? profiles[i][0] ?? null : profiles[i] ?? null]));

const result = {};
const examples = {};
for (const tab of ['naics', 'agencies']) {
  const list = sub[tab];
  const suffix = tab === 'naics' ? 'all-naics:v2-m' : 'all-agencies:v4-m';
  const storedField = tab === 'naics' ? 'distinct_naics_count' : 'distinct_agency_count';
  const withUei = list.map((s) => ({ s, p: prof.get(s) }));
  const keys = withUei.map(({ p }) => (p?.rollup_uei ? `bq:${DATA_VERSION}:rollup:${p.rollup_uei}:${suffix}` : null));
  const vals = await mget(keys.map((k) => k ?? '__none__'));
  const t = { sitemap_listed: list.length, profile_unavailable: 0, rows_unavailable: 0, rows_true_zero: 0, renderable: 0, renderable_below_min5: 0, stored_vs_rendered_mismatch: 0, renderable_rows_total: 0 };
  const ex = { rows_unavailable: [], rows_true_zero: [], renderable_below_min5: [], mismatch: [] };
  withUei.forEach(({ s, p }, i) => {
    if (!p) { t.profile_unavailable++; return; }
    const v = vals[i];
    const stored = Number(p[storedField] || 0);
    if (v === null || v === undefined) { t.rows_unavailable++; if (ex.rows_unavailable.length < 5) ex.rows_unavailable.push(`${s} (stored ${stored})`); return; }
    const n = Array.isArray(v) ? v.length : 0;
    if (n === 0) { t.rows_true_zero++; if (ex.rows_true_zero.length < 5) ex.rows_true_zero.push(`${s} (stored ${stored})`); return; }
    t.renderable++; t.renderable_rows_total += n;
    if (n < 5) { t.renderable_below_min5++; if (ex.renderable_below_min5.length < 5) ex.renderable_below_min5.push(`${s} (${n} rows, stored ${stored})`); }
    if (n !== stored) { t.stored_vs_rendered_mismatch++; if (ex.mismatch.length < 5) ex.mismatch.push(`${s} (rendered ${n}, stored ${stored})`); }
  });
  t.empty_or_unavailable = t.profile_unavailable + t.rows_unavailable + t.rows_true_zero;
  result[tab] = t; examples[tab] = ex;
}
const summary = { measured_at: new Date().toISOString(), data_version: DATA_VERSION, sitemap_urls_total: urls.length, contractor_slugs_with_tabs: slugs.length, kv_mget_calls: calls, ...result, examples };
writeFileSync(out, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
