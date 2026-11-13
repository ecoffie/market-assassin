/**
 * Verified link targets for the /contractors hub (2026-11-12, SEO recovery Phase 2).
 *
 * The hub renders names from the curated overlay (src/data/contractors.json), and their slugs
 * were never checked against what /contractors/<slug> can serve. A spot check of 40 of the 125
 * hub slugs absent from the sitemap found 11 returning 404 and 15 returning 308 — the site's
 * most-linked index page was spending its internal links on dead ends and redirect hops.
 *
 * For each slug:
 *   - its profile record is in KV          → link it as-is
 *   - else a cached alias points at a serveable canonical → link the CANONICAL (no 308 hop)
 *   - else                                 → no link (drop the entry)
 * Same KV records the page itself reads; no BigQuery.
 *
 * Returns null when KV cannot be read, so the hub can fall back to its unverified list rather
 * than render an empty directory.
 */
import { kv } from '@vercel/kv';
import { DATA_VERSION } from '@/lib/bigquery/cache';
import { getServeableProfiles } from '@/lib/seo/served-slugs';

/** Mirrors the cacheKey in resolveCanonicalSlug() (src/lib/bigquery/recipients.ts). */
function canonicalKey(slug: string): string {
  return `bq:${DATA_VERSION}:rollup:canonical-of:${slug}:v3-merged`;
}

const KEYS_PER_MGET = 200;

export async function resolveHubTargets(slugs: string[]): Promise<Map<string, string> | null> {
  const unique = [...new Set(slugs.filter(Boolean))];
  const direct = await getServeableProfiles(unique);
  if (direct.failedBatches > 0) return null;

  const targets = new Map<string, string>();
  const unresolved: string[] = [];
  for (const s of unique) {
    if (direct.profiles.has(s)) targets.set(s, s);
    else unresolved.push(s);
  }
  if (unresolved.length === 0) return targets;

  // Aliases: canonical-of records written by the resolver / warm job.
  const aliasOf = new Map<string, string>();
  try {
    for (let i = 0; i < unresolved.length; i += KEYS_PER_MGET) {
      const part = unresolved.slice(i, i + KEYS_PER_MGET);
      const vals = await kv.mget<unknown[]>(...part.map(canonicalKey));
      part.forEach((s, j) => {
        const row = Array.isArray(vals[j]) ? (vals[j] as Array<{ canonical_slug?: string }>)[0] : null;
        const c = row?.canonical_slug;
        if (c && c !== s) aliasOf.set(s, c);
      });
    }
  } catch {
    return null;
  }
  if (aliasOf.size === 0) return targets;

  // Only redirect-free links: the canonical itself must serve.
  const canon = await getServeableProfiles([...new Set(aliasOf.values())]);
  if (canon.failedBatches > 0) return null;
  for (const [s, c] of aliasOf) if (canon.profiles.has(c)) targets.set(s, c);
  return targets;
}
