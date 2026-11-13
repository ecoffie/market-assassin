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
import { WARM_PRIORITY_KEY } from '@/lib/seo/warm-priority';

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
  return new Set((await getServeableProfiles(slugs)).profiles.keys());
}

export interface ServeableProfiles {
  /** slug → the cached record's last_action_date (a DATA date: the latest award action). */
  profiles: Map<string, { lastActionDate: string | null }>;
  /** KV batches that could not be read. Non-zero means "unknown", not "not serveable". */
  failedBatches: number;
}

/**
 * Same KV read as getServeableSlugs, also returning what the sitemap needs for lastmod and what a
 * caller needs to tell "not serveable" apart from "could not check". Zero extra reads: the
 * profile record is already in hand.
 */
export async function getServeableProfiles(slugs: string[]): Promise<ServeableProfiles> {
  const profiles = new Map<string, { lastActionDate: string | null }>();
  let failedBatches = 0;
  for (let i = 0; i < slugs.length; i += KEYS_PER_MGET) {
    const part = slugs.slice(i, i + KEYS_PER_MGET);
    try {
      const vals = await kv.mget<unknown[]>(...part.map(profileKey));
      part.forEach((slug, j) => {
        const v = vals[j];
        // queryCached stores an ARRAY of rows. An empty array is a cached
        // "no rows" — real knowledge, but not a renderable page, so it does
        // not count as serveable.
        const row = Array.isArray(v) ? v[0] : v;
        if (row == null) return;
        const last = (row as { last_action_date?: unknown }).last_action_date;
        profiles.set(slug, { lastActionDate: typeof last === 'string' ? last : null });
      });
    } catch (err) {
      failedBatches++;
      console.error(
        `[served-slugs] KV mget failed at offset ${i} — omitting this batch:`,
        err instanceof Error ? err.message : err,
      );
      // fail closed: omit, never assume serveable
    }
  }
  return { profiles, failedBatches };
}

/**
 * Record a slug whose page cache missed, so the hourly warm cron
 * (/api/cron/warm-contractor-pages) drains it into KV. Every 5xx a contractor page
 * answers for cold data queues its slug here; the drain is what makes that 5xx
 * temporary. A synchronous BigQuery read on a public request is allowed only under
 * the fail-closed daily budget in src/lib/seo/seo-unavailable.ts.
 *
 * Best-effort and non-blocking by contract: a failure here must never change
 * what the page returns to the visitor.
 */
export const WARM_QUEUE_KEY = 'seo:warm:queue:contractor-slugs';

export async function recordWarmMiss(slug: string): Promise<void> {
  try {
    await kv.sadd(WARM_QUEUE_KEY, slug);
    // Request frequency feeds the priority queue: each miss adds 1 to the slug's score
    // (src/lib/seo/warm-priority.ts). Thin contractors get filtered out when the warm resolves them.
    await kv.zincrby(WARM_PRIORITY_KEY, 1, slug);
  } catch {
    // Intentionally silent. The queue is an optimization, not a guarantee;
    // GSC and the sitemap diff both rediscover misses independently.
  }
}
