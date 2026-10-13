// Re-check every example URL from the GSC "Not found (404)" drilldown (export 2026-09-30) against LIVE
// production and classify by CURRENT response. Read-only HTTP GETs; no BigQuery (ENABLE_SEO_LIVE_BQ is off in
// production, so uncached contractor pages serve cache-only / notFound and never cold-scan).
//
// Buckets (requested):
//   200_repaired                         — 2xx now (flags: noindex, canonical elsewhere, empty/thin)
//   308_canonical_redirect               — 301/308 whose one-hop target returns 200
//   intentional_404_absent_from_sitemap  — 404/410 AND not in the live sitemap (Google will age it out)
//   still_broken                         — 404/410 still IN the sitemap, 5xx, timeouts, redirect → non-200, 302/307
//
// Usage: node recheck.mjs <Table.csv> <out.csv> <sitemap.xml> [<sitemap2.xml> ...]
import { readFileSync, writeFileSync } from 'node:fs';
const [table, out, ...maps] = process.argv.slice(2);
const UA = 'Mozilla/5.0 (compatible; MindySEOHealth/1.0; +https://getmindy.ai; Googlebot-compatible)';
const norm = (u) => u.replace(/\/+$/, '').toLowerCase();
const sitemap = new Set();
for (const m of maps) for (const x of readFileSync(m, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) sitemap.add(norm(x[1].replace(/&amp;/g, '&')));
const rows = readFileSync(table, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map((l) => { const i = l.lastIndexOf(','); return { url: l.slice(0, i), lastCrawled: l.slice(i + 1) }; });

async function get(url, redirect = 'manual') {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000); const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect, signal: ctl.signal, headers: { 'user-agent': UA, accept: 'text/html' } });
    const body = r.status === 200 ? (await r.text()).slice(0, 400000) : (await r.body?.cancel(), '');
    return { status: r.status, location: r.headers.get('location'), body, ms: Date.now() - t0 };
  } catch (e) { return { status: 0, error: e.name === 'AbortError' ? 'timeout' : String(e.message).slice(0, 80), body: '', ms: Date.now() - t0 }; }
  finally { clearTimeout(t); }
}
function pageFlags(url, body) {
  const f = [];
  const robots = (body.match(/<meta[^>]+name=["']robots["'][^>]*>/i) || [''])[0];
  if (/noindex/i.test(robots)) f.push('noindex');
  const can = (body.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [])[1];
  if (can && norm(can) !== norm(url)) f.push('canonical_elsewhere');
  const h1 = (body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  if (!h1) f.push('no_h1');
  const text = body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (text.length < 1500) f.push('thin');
  return { flags: f, canonical: can || '' };
}
async function classify(row) {
  const inMap = sitemap.has(norm(row.url));
  const r = await get(row.url);
  const rec = { url: row.url, last_crawled: row.lastCrawled, in_sitemap: inMap, status: r.status || r.error, location: r.location || '', target_status: '', flags: '', canonical: '', bucket: '' };
  if (r.status >= 200 && r.status < 300) {
    const p = pageFlags(row.url, r.body); rec.flags = p.flags.join(';'); rec.canonical = p.canonical; rec.bucket = '200_repaired';
  } else if ([301, 308].includes(r.status)) {
    const target = new URL(r.location, row.url).toString();
    const t = await get(target); rec.target_status = t.status || t.error; rec.location = target;
    rec.bucket = t.status === 200 ? '308_canonical_redirect' : 'still_broken';
    if (t.status !== 200) rec.flags = 'redirect_target_not_200';
  } else if ([404, 410].includes(r.status)) {
    rec.bucket = inMap ? 'still_broken' : 'intentional_404_absent_from_sitemap';
    if (inMap) rec.flags = '404_but_in_sitemap';
  } else {
    rec.bucket = 'still_broken'; rec.flags = [302, 307].includes(r.status) ? 'temporary_redirect' : (r.status >= 500 ? 'server_error' : String(rec.status));
  }
  return rec;
}
const results = []; let i = 0; const t0 = Date.now();
await Promise.all(Array.from({ length: 3 }, async () => { while (i < rows.length) { const row = rows[i++]; results.push(await classify(row)); } }));
const cols = ['url', 'last_crawled', 'in_sitemap', 'status', 'location', 'target_status', 'flags', 'canonical', 'bucket'];
const esc = (v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
results.sort((a, b) => a.bucket.localeCompare(b.bucket) || a.url.localeCompare(b.url));
writeFileSync(out, [cols.join(','), ...results.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n');
const tally = (k) => results.reduce((m, r) => (m[r[k]] = (m[r[k]] || 0) + 1, m), {});
console.log(JSON.stringify({ urls: rows.length, sitemap_urls: sitemap.size, seconds: Math.round((Date.now() - t0) / 1000), by_bucket: tally('bucket'), by_status: tally('status') }, null, 1));
