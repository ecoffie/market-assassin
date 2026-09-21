/**
 * Only redirect to a canonical contractor slug we can actually serve.
 *
 * THE DEFECT THIS FIXES
 * ---------------------
 * `resolveCanonicalSlug()` answers "which slug owns this name?" from the alias
 * cache. It does NOT answer "can the page for that slug render?" — those are
 * different questions backed by different cache keys, and the contractor routes
 * were treating the first as though it settled the second.
 *
 * Measured on production 2026-09-21, crawling all 250 alias URLs: every one
 * issued a correct single-hop 308, but **7 of the 177 distinct targets returned
 * 404** — carpenter-technology-corporation, enterra-holdings-ltd,
 * leeward-construction-corp, huron-consulting-group-inc,
 * magnolia-river-services-inc, trident-services-inc, translogic-corporation.
 * A 308 into a 404 is strictly worse than a 404: it spends a crawl, asserts a
 * canonical that does not exist, and tells a visitor the page moved somewhere
 * it did not.
 *
 * Those seven profiles could not be reconstructed without BigQuery — verified
 * against every existing artifact: no per-slug profile key, no per-slug
 * recipient key, absent from the 12,000-row sitemap cache, and
 * `awards_serving_pages` is keyed by `recipient_uei` with no name column, so
 * there is no zero-BigQuery path from a slug to a UEI. So the honest outcome is
 * a direct 404 until a warm materializes them.
 *
 * COST: one KV read (cache-only). It CANNOT reach BigQuery — `getRollupBySlug`
 * defaults to `liveBq=false`, and a public request path must never scan.
 */
import { getRollupBySlug } from '@/lib/bigquery/recipients';

/**
 * Given the canonical slug an alias resolved to, return it only if its profile
 * is actually serveable; otherwise null, so the caller falls through to 404.
 *
 * Returning null is the SAFE direction: a missing redirect self-heals the next
 * time the target is warmed, whereas a redirect to a dead page persists in
 * Google's index as a broken canonical.
 */
export async function serveableCanonical(canonical: string | null): Promise<string | null> {
  if (!canonical) return null;
  try {
    const target = await getRollupBySlug(canonical);
    return target ? canonical : null;
  } catch {
    // Unknown → do not assert a redirect we cannot stand behind.
    return null;
  }
}
