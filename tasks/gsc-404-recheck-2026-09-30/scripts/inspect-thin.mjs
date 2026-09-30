// Inspect the 61 "indexable + thin + in sitemap" pages from recheck-results.csv. READ-ONLY: GETs only.
// No BigQuery (ENABLE_SEO_LIVE_BQ is off in production → cache-only renders). Changes nothing.
//
// Per page: title, H1, canonical (self?), robots meta / indexability, template-stripped unique text,
// distinct data points, empty-state wording, content links (links not shared by ≥80% of pages), and for
// sub-pages whether the parent /contractors/{slug} links to it.
// Usage: node inspect-thin.mjs <recheck-results.csv> <out.csv>
import { readFileSync, writeFileSync } from 'node:fs';
const [inp, out] = process.argv.slice(2);
const UA = 'Mozilla/5.0 (compatible; MindySEOHealth/1.0; +https://getmindy.ai; Googlebot-compatible)';
const parseCsv = (t) => { const L = t.trim().split('\n'); const h = L[0].split(','); return L.slice(1).map((l) => { const v = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { v.push(cur); cur = ''; } else cur += ch; } v.push(cur); return Object.fromEntries(h.map((k, i) => [k, v[i]])); }); };
const targets = parseCsv(readFileSync(inp, 'utf8')).filter((r) => r.bucket === '200_repaired' && r.in_sitemap === 'true' && r.flags === 'thin').map((r) => r.url);

async function get(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try { const r = await fetch(url, { redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': UA, accept: 'text/html' } }); return { status: r.status, body: r.status === 200 ? await r.text() : '' }; }
  catch (e) { return { status: 0, body: '' }; } finally { clearTimeout(t); }
}
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
function parse(url, body) {
  const main = (body.match(/<main[\s\S]*?<\/main>/i) || [body])[0];
  const clean = main.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
  const lines = decode(clean.replace(/<\/(p|li|h[1-6]|td|th|div|tr|span|a|dt|dd)>/gi, '\n').replace(/<[^>]+>/g, ' ')).split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length > 2);
  const links = [...new Set([...body.matchAll(/<a[^>]+href=["']([^"'#?]+)/gi)].map((m) => m[1].replace('https://getmindy.ai', '')).filter((h) => h.startsWith('/')))];
  return {
    title: decode((body.match(/<title>([\s\S]*?)<\/title>/i) || [, ''])[1]).trim(),
    h1: decode(((body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [, ''])[1]).replace(/<[^>]+>/g, '')).trim(),
    canonical: (body.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [, ''])[1],
    robots: ((body.match(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']+)["']/i) || [, ''])[1]),
    lines, links,
    emptyState: /no (naics|agency|agencies|contract|contracts|award|awards|recipient)? ?(data|records|contracts|awards|agencies|naics)[^.]{0,40}(found|available|yet)|data (is )?(temporarily )?unavailable|not available yet|we don.t have/i.test(lines.join(' ')),
    // The sub-page's OWN dataset: data rows in table bodies (header/profile stats are shared across a
    // contractor's pages and are NOT the sub-page's data).
    tableRows: [...main.matchAll(/<tbody[\s\S]*?<\/tbody>/gi)].reduce((n, m) => n + [...m[0].matchAll(/<tr[\s>]/gi)].length, 0)
      - [...main.matchAll(/<tbody[\s\S]*?<\/tbody>/gi)].reduce((n, m) => n + [...m[0].matchAll(/<td[^>]*colspan[^>]*>[\s\S]*?no [a-z ]*data available/gi)].length, 0),
    headerClaim: (lines.join(' ').match(/\b([\d,]+)\s+(NAICS codes where|federal agencies that)/i) || [, ''])[1],
  };
}
const pages = [];
let i = 0;
await Promise.all(Array.from({ length: 3 }, async () => { while (i < targets.length) { const url = targets[i++]; const r = await get(url); pages.push({ url, status: r.status, ...parse(url, r.body) }); } }));
// Template stripping: a line/link present on >= 30% (lines) / 80% (links) of the pages is template.
const lineFreq = new Map(), linkFreq = new Map();
for (const p of pages) { for (const l of new Set(p.lines)) lineFreq.set(l, (lineFreq.get(l) || 0) + 1); for (const h of p.links) linkFreq.set(h, (linkFreq.get(h) || 0) + 1); }
const N = pages.length;
// Parent link check for sub-pages
const parents = [...new Set(pages.map((p) => p.url.match(/^(https:\/\/getmindy\.ai\/contractors\/[^/]+)\/.+/)?.[1]).filter(Boolean))];
const parentLinks = new Map();
let j = 0;
await Promise.all(Array.from({ length: 3 }, async () => { while (j < parents.length) { const u = parents[j++]; const r = await get(u); parentLinks.set(u, { status: r.status, links: new Set([...r.body.matchAll(/<a[^>]+href=["']([^"'#?]+)/gi)].map((m) => m[1].replace('https://getmindy.ai', ''))) }); } }));

const rows = pages.map((p) => {
  const unique = p.lines.filter((l) => lineFreq.get(l) / N < 0.3);
  const uniqueText = unique.join(' ');
  const dataPoints = new Set([...uniqueText.matchAll(/\$\s?[\d,.]+\s?[KMB]?|\b\d{1,3}(?:,\d{3})+\b|\b\d{4,}\b|\b[A-Z]\d{3}\b/g)].map((m) => m[0])).size;
  const contentLinks = p.links.filter((h) => linkFreq.get(h) / N < 0.8).length;
  const path = p.url.replace('https://getmindy.ai', '');
  const parent = p.url.match(/^(https:\/\/getmindy\.ai\/contractors\/[^/]+)\/.+/)?.[1];
  const pl = parent ? parentLinks.get(parent) : null;
  const linkedFromParent = parent ? (pl?.status === 200 ? pl.links.has(path) : `parent_${pl?.status}`) : 'n/a (root)';
  const selfCanonical = !!p.canonical && p.canonical.replace(/\/+$/, '') === p.url.replace(/\/+$/, '');
  const indexable = p.status === 200 && !/noindex/i.test(p.robots);
  let cls;
  if (p.status !== 200) cls = 'not_200_now';
  else if (p.tableRows <= 0 && p.emptyState) cls = 'C_empty_state_no_rows';
  else if (p.tableRows >= 5) cls = 'A_real_dataset_5plus_rows';
  else if (p.tableRows >= 1) cls = 'B_small_dataset_1to4_rows';
  else cls = 'C_no_rows_no_empty_message';
  const headerNonzero = /[1-9]/.test(p.headerClaim || '');
  return { url: path, status: p.status, class: cls, table_rows: Math.max(0, p.tableRows), header_claim: p.headerClaim || '', header_contradicts_table: headerNonzero && p.tableRows <= 0, unique_data_points: dataPoints, unique_text_chars: uniqueText.length, empty_state_text: p.emptyState, h1: p.h1.slice(0, 90), title: p.title.slice(0, 90), self_canonical: selfCanonical, indexable, robots: p.robots || '(none)', content_links: contentLinks, linked_from_parent: linkedFromParent };
});
rows.sort((a, b) => a.class.localeCompare(b.class) || a.unique_data_points - b.unique_data_points);
const cols = Object.keys(rows[0]);
const esc = (v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
writeFileSync(out, [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n');
const tally = (f) => rows.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m; }, {});
const shape = (u) => u.replace(/\/contractors\/[^/]+/, '/c/{slug}');
console.log(JSON.stringify({
  pages: N, parents_fetched: parents.length,
  by_class: tally((r) => r.class),
  by_class_and_shape: tally((r) => `${r.class} ${shape(r.url)}`),
  h1_present: rows.filter((r) => r.h1).length, self_canonical: rows.filter((r) => r.self_canonical).length,
  indexable: rows.filter((r) => r.indexable).length, empty_state: rows.filter((r) => r.empty_state_text).length,
  header_contradicts_table: rows.filter((r) => r.header_contradicts_table).length,
  table_rows_distribution: tally((r) => String(r.table_rows)),
  linked_from_parent: tally((r) => String(r.linked_from_parent)),
  median_data_points: rows.map((r) => r.unique_data_points).sort((a, b) => a - b)[Math.floor(N / 2)],
  median_content_links: rows.map((r) => r.content_links).sort((a, b) => a - b)[Math.floor(N / 2)],
}, null, 1));
