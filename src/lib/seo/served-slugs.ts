/**
 * Which contractor slugs the PUBLIC renderer can actually serve, right now.
 *
 * THE ELIGIBILITY MISMATCH THIS CLOSES
 * ------------------------------------
 * The sitemap decided what to advertise from one population (the top-N rollup
 * list from BigQuery) while the page rendered from a different one (the
 * per-slug KV cache). Nothing guaranteed the two agreed, and they did not: on
 * 2026-09-21, 861 contractor slugs that Google had indexed returned 404,
 * because the sitemap's eligibility test never asked the question the page
 * actually answers — "is there a cached record for this slug?"
 *
 * A sitemap entry is an assertion that a URL is worth indexing. This makes the
 * assertion checkable: a contractor enters the sitemap only after its cached
 * page record is verified present.
 *
 * COST: KV reads only. No BigQuery, ever. `mget` batches the lookups so
 * verifying ~12,000 slugs is ~60 round-trips, not 12,000. On any KV error it
 * fails CLOSED for that batch — an unverified slug is omitted rather than
 * asserted, because a missing sitemap entry self-heals on the next build and a
 * lying one costs crawl trust.
 */
import { kv } from '@vercel/kv';
import { DATA_VERSION } from '@/lib/bigquery/cache';

/** Mirrors the cacheKey in getRollupBySlug(). Keep them identical. */
function profileKey(slug: string): string {
  return `bq:${DATA_VERSION}:rollup:by-slug:${slug}:v2-merged`;
}

const KEYS_PER_MGET = 200;

/**
 * Filter `slugs` down to those with a populated profile cache entry.
 * Order is not preserved; callers use the returned Set as a membership test.
 */
export async function getServeableSlugs(slugs: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < slugs.length; i += KEYS_PER_MGET) {
    const part = slugs.slice(i, i + KEYS_PER_MGET);
    try {
      const vals = await kv.mget<unknown[]>(...part.map(profileKey));
      part.forEach((slug, j) => {
        const v = vals[j];
        // queryCached stores an ARRAY of rows. An empty array is a cached
        // "no rows" — real knowledge, but not a renderable page, so it does
        // not count as serveable.
        if (Array.isArray(v) ? v.length > 0 : v != null) out.add(slug);
      });
    } catch (err) {
      console.error(
        `[served-slugs] KV mget failed at offset ${i} — omitting this batch:`,
        err instanceof Error ? err.message : err,
      );
      // fail closed: omit, never assume serveable
    }
  }
  return out;
}

/**
 * Record a slug whose page cache missed, so a later bounded warm job can pick
 * it up. This is the ONLY thing a cache miss is allowed to do — never a
 * synchronous BigQuery query on a public request path.
 *
 * Best-effort and non-blocking by contract: a failure here must never change
 * what the page returns to the visitor.
 */
export const WARM_QUEUE_KEY = 'seo:warm:queue:contractor-slugs';

export async function recordWarmMiss(slug: string): Promise<void> {
  try {
    await kv.sadd(WARM_QUEUE_KEY, slug);
  } catch {
    // Intentionally silent. The queue is an optimization, not a guarantee;
    // GSC and the sitemap diff both rediscover misses independently.
  }
}
