/**
 * Cache layer for BigQuery query results.
 *
 * Pattern: SEO pages call queryCached() with a cache key + TTL.
 * - Hit: return cached JSON, no BQ call. ~30ms read.
 * - Miss: run BQ query, write to KV, return. ~500ms.
 *
 * Cache key strategy: include a DATA_VERSION constant. Bumping
 * DATA_VERSION after a fresh USASpending ingest invalidates every
 * cached entry without manual deletion or scan-and-delete.
 *
 * TTL: 7 days default. USASpending publishes new data monthly,
 * so 7d keeps us within one update cycle while giving Googlebot
 * a stable URL to crawl.
 *
 * Failure mode: if KV is down, fall back to direct BQ. Page is
 * slower but doesn't break. Errors are logged, not thrown.
 */
import { kv } from '@vercel/kv';
import { bqQuery, type BqQueryParams } from './client';

// Bump this string whenever the source data is refreshed (monthly
// ingest, schema change, derived-table rebuild). All cached keys
// become unreachable immediately — no scan-and-delete needed.
// Bumped 2026-05-31 to invalidate KV cache after Round 2 subaward
// ingest brought subawards from 903K → 1,001,345 rows and added
// 340 new primes + 8,765 new subawardees to the rollups.
const DATA_VERSION = 'v2-2026-05';

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface QueryCacheOptions<T> extends BqQueryParams {
  cacheKey: string;
  ttlSeconds?: number;
  // If true, skip cache read (but still write). Useful for the
  // first request after a data refresh when caller knows the
  // cache is stale but DATA_VERSION wasn't bumped.
  forceRefresh?: boolean;
}

function buildKey(cacheKey: string): string {
  return `bq:${DATA_VERSION}:${cacheKey}`;
}

export async function queryCached<T = Record<string, unknown>>(
  opts: QueryCacheOptions<T>,
): Promise<T[]> {
  const key = buildKey(opts.cacheKey);
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  if (!opts.forceRefresh) {
    try {
      const cached = await kv.get<T[]>(key);
      if (cached !== null && cached !== undefined) {
        return cached;
      }
    } catch (err) {
      // KV failure shouldn't crash the page — just log and fall through to BQ
      console.warn(`[bq-cache] KV read failed for ${key}:`, err);
    }
  }

  // Log only MISS+BQ events so we have visibility into cost-bearing
  // queries without spamming logs on every cache HIT (which is the
  // overwhelming majority on warm contractor pages).
  const tBq = Date.now();
  const rows = await bqQuery<T>(opts);
  console.log(`[bq-miss] ${key}  (${Date.now() - tBq}ms, ${Array.isArray(rows) ? rows.length : '?'} rows)`);

  try {
    await kv.set(key, rows, { ex: ttl });
  } catch (err) {
    console.warn(`[bq-cache] KV write failed for ${key}:`, err);
  }

  return rows;
}
