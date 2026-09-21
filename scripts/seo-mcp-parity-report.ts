/**
 * SEO ↔ MCP contractor-resolution reconciliation.
 *
 * WHAT THIS ANSWERS
 * -----------------
 * "Where exactly does a contractor request diverge between the MCP path and the
 * public SEO page?" For each fixture slug it reports, side by side:
 *
 *   MCP resolution      — what the canonical resolver returns with liveBq=true,
 *                         i.e. exactly what `uniqueBySlug()` in
 *                         src/lib/contractor/name-resolution.ts does for the
 *                         MCP contractor tools.
 *   canonical UEI/parent— rollup_uei + rollup_name + child_count (parent identity)
 *   SEO resolution      — what the same resolver returns with the public page's
 *                         settings (cache-only, because seoLiveBqEnabled() is OFF)
 *   cache presence      — whether the KV key the public page reads is populated
 *   sitemap inclusion   — whether the URL is advertised in sitemap.xml
 *   live HTTP           — what getmindy.ai actually returns right now
 *
 * THE FINDING THIS WAS BUILT TO PROVE (2026-09-21)
 * ------------------------------------------------
 * There is no second contractor system. Both callers go through the SAME
 * function, `getRollupOrSingleBySlug()` in src/lib/bigquery/recipients.ts:
 *
 *   MCP  (name-resolution.ts:152)         getRollupOrSingleBySlug(slug, true)
 *   SEO  (contractors/[slug]/page.tsx)    getRollupOrSingleBySlug(slug, seoLiveBqEnabled())
 *
 * One boolean apart. The SEO page is not missing a resolver; it is denied the
 * cold read, by design, because crawler cold-scans exhausted the BigQuery daily
 * quota. So every divergence this report finds is a CACHE/ADAPTER boundary
 * failure, not a resolution failure — and the fix belongs at that boundary
 * (warm the cache), never in a second slug-resolution implementation.
 *
 * Run:  npx tsx scripts/seo-mcp-parity-report.ts [slug ...]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { kv } from '@vercel/kv';
import {
  getRollupBySlug,
  getRollupOrSingleBySlug,
  resolveCanonicalSlug,
} from '../src/lib/bigquery/recipients';
import { DATA_VERSION } from '../src/lib/bigquery/cache';

const SITE = 'https://getmindy.ai';

/** The failing fixtures named in the investigation, plus two that rank but do not index. */
const DEFAULT_FIXTURES = [
  'caci-inc-federal',
  'iqvia-government-solutions-inc',
  'cbre-inc',
  'two-six-labs-llc',
  'ses-sa',
  'senture-llc',
  'industries-for-the-blind-and-visually-impaired-inc',
  'morphosis-architects',
];

interface Row {
  slug: string;
  mcp: string;
  uei: string;
  parent: string;
  seo: string;
  cache: string;
  sitemap: string;
  live: string;
  diverges: string;
}

async function httpStatus(url: string): Promise<string> {
  try {
    const res = await fetch(url, { redirect: 'manual' });
    const loc = res.headers.get('location');
    return loc ? `${res.status}→${loc.replace(SITE, '')}` : String(res.status);
  } catch {
    return 'ERR';
  }
}

let sitemapPaths: Set<string> | null = null;
async function inSitemap(slug: string): Promise<string> {
  if (!sitemapPaths) {
    try {
      const xml = await fetch(`${SITE}/sitemap.xml`).then((r) => r.text());
      sitemapPaths = new Set(
        [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(SITE, '')),
      );
    } catch {
      sitemapPaths = new Set();
    }
  }
  return sitemapPaths.has(`/contractors/${slug}`) ? 'yes' : 'no';
}

async function cachePresent(slug: string): Promise<string> {
  const profileKey = `bq:${DATA_VERSION}:rollup:by-slug:${slug}:v2-merged`;
  const aliasKey = `bq:${DATA_VERSION}:rollup:canonical-of:${slug}:v3-merged`;
  try {
    const [p, a] = await Promise.all([kv.get(profileKey), kv.get(aliasKey)]);
    const bits: string[] = [];
    if (Array.isArray(p) && p.length) bits.push('profile');
    if (Array.isArray(a) && a.length) bits.push('alias');
    return bits.length ? bits.join('+') : 'MISS';
  } catch (e) {
    return `ERR ${e instanceof Error ? e.message.slice(0, 20) : ''}`;
  }
}

async function reconcile(slug: string): Promise<Row> {
  // MCP path: liveBq = true (name-resolution.ts:152)
  const mcpProfile = await getRollupOrSingleBySlug(slug, true).catch(() => null);
  const canonical = await resolveCanonicalSlug(slug, true).catch(() => null);

  // SEO path: cache-only, exactly what contractors/[slug]/page.tsx does first
  const seoProfile = await getRollupBySlug(slug).catch(() => null);

  const [cache, sitemap, live] = await Promise.all([
    cachePresent(slug),
    inSitemap(slug),
    httpStatus(`${SITE}/contractors/${slug}`),
  ]);

  const mcp = mcpProfile
    ? `resolves${canonical ? ` (→${canonical})` : ''}`
    : canonical
      ? `alias→${canonical}`
      : 'NO RESOLVE';
  const seo = seoProfile ? 'resolves' : 'cache MISS';

  let diverges = '—';
  if (mcpProfile && !seoProfile) diverges = 'CACHE boundary';
  if (!mcpProfile && !canonical) diverges = 'source data (honest 404)';
  if (mcpProfile && seoProfile && live.startsWith('404')) diverges = 'ISR (stale 404 cached)';

  return {
    slug,
    mcp,
    uei: mcpProfile?.rollup_uei ?? '—',
    parent: mcpProfile
      ? `${mcpProfile.rollup_name} (${mcpProfile.child_count ?? 1} UEI)`
      : '—',
    seo,
    cache,
    sitemap,
    live,
    diverges,
  };
}

function pad(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);
}

async function main() {
  const fixtures = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FIXTURES;
  const rows: Row[] = [];
  for (const f of fixtures) rows.push(await reconcile(f));

  console.log('\nSEO ↔ MCP CONTRACTOR RECONCILIATION');
  console.log('Both paths call getRollupOrSingleBySlug() in src/lib/bigquery/recipients.ts.');
  console.log('MCP passes liveBq=true; the SEO page passes seoLiveBqEnabled() (OFF).\n');

  const H = ['slug', 'MCP resolve', 'canonical UEI', 'SEO (cache-only)', 'cache', 'sitemap', 'live', 'diverges at'];
  const W = [40, 26, 14, 16, 14, 8, 22, 26];
  console.log(H.map((h, i) => pad(h, W[i])).join(' '));
  console.log(W.map((w) => '-'.repeat(w)).join(' '));
  for (const r of rows) {
    console.log(
      [r.slug, r.mcp, r.uei, r.seo, r.cache, r.sitemap, r.live, r.diverges]
        .map((c, i) => pad(String(c), W[i]))
        .join(' '),
    );
  }

  console.log('\nparent identity:');
  for (const r of rows) console.log(`  ${pad(r.slug, 42)} ${r.parent}`);
  console.log();
}

main().catch((e) => {
  console.error('parity report failed:', e);
  process.exit(1);
});
