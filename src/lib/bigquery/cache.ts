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
 * TTL: 90 days default. USASpending data changes slowly and we now
 * refresh QUARTERLY (Eric, June 2026 — aligns with the curated-source
 * quarterly cadence; monthly was 12 cache-wipe storms/yr, quarterly is 4).
 * A 90d TTL keeps results warm across a full quarter so Googlebot crawls
 * the long tail without forcing cold-miss BQ scans.
 *
 * Failure mode: if KV is down, fall back to direct BQ. Page is
 * slower but doesn't break. Errors are logged, not thrown.
 */
import { kv } from '@vercel/kv';
import { bqQuery, type BqQueryParams } from './client';

// Bump this string whenever the source data is refreshed (QUARTERLY
// ingest, schema change, derived-table rebuild). All cached keys
// become unreachable immediately — no scan-and-delete needed.
//
// ⚠️ COST WARNING (June 2026 spike, $2,075 — tasks/bigquery-cost-spike-2026-06.md):
// Bumping this WIPES 100% of the cache at once. The public SEO long-tail
// (/awards/[id], /contractors/[slug], /top/*, /agencies/*) then re-crawls into a
// COLD cache → thousands of cold-miss BQ scans → a cost storm. BEFORE you bump:
// (1) do it in a low-traffic window, (2) PRE-WARM the heavy/long-tail keys, and
// (3) watch BQ cost for 24h. A hard GCP daily query quota is the backstop.
// Bumped 2026-05-31 to invalidate KV cache after Round 2 subaward
// ingest brought subawards from 903K → 1,001,345 rows and added
// 340 new primes + 8,765 new subawardees to the rollups.
// Bumped 2026-06-01 (v3) alongside the piid_lookup / award_detail_lookup
// clustered tables — invalidates the old full-table-scan KV entries for
// awards:by-piid:* and awards:detail:* so resolved redirects re-populate
// from the new cheap lookups.
const DATA_VERSION = 'v3-2026-06';

// 90 days. We refresh QUARTERLY and bump DATA_VERSION on each refresh
// (which invalidates every key instantly), so TTL only governs how long a
// STALE-but-same-version result lives within a quarter. Longer TTL = far
// fewer cold-miss BQ scans (the agency breakdown alone was 82% of daily
// scan and helped exhaust the daily quota → 5xx + the June 2026 $2K spike).
// 90d means a page's heavy query runs at most ~once/quarter, with no
// accuracy cost between quarterly ingests.
const DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

export interface QueryCacheOptions<T> extends BqQueryParams {
  cacheKey: string;
  ttlSeconds?: number;
  // If true, skip cache read (but still write). Useful for the
  // first request after a data refresh when caller knows the
  // cache is stale but DATA_VERSION wasn't bumped.
  forceRefresh?: boolean;
  // SEO-SAFE-BY-DEFAULT (June 2026, tasks/bigquery-cost-spike-2026-06.md):
  // When true (the DEFAULT), a cache MISS does NOT trigger a live BQ scan —
  // it returns [] (the same graceful empty path used on a BQ failure), so the
  // public SEO long-tail (/awards, /contractors, /agencies, /top) can NEVER
  // drive a cold-miss BQ cost storm from crawler traffic. Pages stay indexable
  // (render their empty/"updating" state on a cold miss, real data once warm).
  // Authenticated Mindy paths pass cacheOnly:false to opt INTO live BQ.
  // The dangerous direction (cold-scan) must be explicitly opted into.
  cacheOnly?: boolean;
}

function buildKey(cacheKey: string): string {
  return `bq:${DATA_VERSION}:${cacheKey}`;
}

/**
 * Keys whose most recent queryCached() call failed with no stale cache to cover it.
 * Bounded so a long-lived lambda cannot grow it without limit.
 */
const DEGRADED = new Map<string, string>();
const DEGRADED_MAX = 200;

function markDegraded(key: string, reason: string): void {
  if (DEGRADED.size >= DEGRADED_MAX) {
    const oldest = DEGRADED.keys().next().value;
    if (oldest !== undefined) DEGRADED.delete(oldest);
  }
  DEGRADED.set(key, reason);
}

/**
 * Did the last queryCached() for this key return [] because BQ FAILED, rather than because
 * the market is genuinely empty?
 *
 * Call it immediately after the await. A true means: do not render a zero, do not persist
 * this as a snapshot, do not conclude "Rule of Two not met". Say the data is unavailable.
 *
 *   const rows = await queryCached<Row>({ key, sql, ... });
 *   if (bqDegraded(key)) return { available: false };   // never a fabricated 0
 */
export function bqDegraded(key: string): boolean {
  return DEGRADED.has(key);
}

/** Why it degraded, for logs and error surfaces. */
export function bqDegradedReason(key: string): string | undefined {
  return DEGRADED.get(key);
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

  // Cache MISS. SEO-safe default: unless the caller explicitly opted into live
  // BQ (cacheOnly === false), do NOT cold-scan — return the graceful empty path.
  // This is what stops crawler-driven cold misses from costing BQ money.
  const cacheOnly = opts.cacheOnly ?? true;
  if (cacheOnly) {
    return [];
  }

  // ── DEGRADED SIGNAL ────────────────────────────────────────────────────────────────
  // Set when a BQ query failed AND no stale cache could cover it, so the [] being returned
  // is an ABSENCE OF KNOWLEDGE, not a measured zero. Deliberately a side-channel: changing
  // the T[] return type would touch 14 call sites, and a partial migration would leave the
  // dangerous ones silently unconverted — the same failure that left the 5-digit NAICS fix
  // on 1 of 3 lines earlier today.
  //
  // Request-scoped by key so a caller can ask about exactly the query it just ran.
  // Read it IMMEDIATELY after the await; it is not durable state.
  // ──────────────────────────────────────────────────────────────────────────────────
  // Log only MISS+BQ events so we have visibility into cost-bearing
  // queries without spamming logs on every cache HIT (which is the
  // overwhelming majority on warm contractor pages).
  const tBq = Date.now();
  let rows: T[];
  try {
    rows = await bqQuery<T>(opts);
  } catch (err) {
    // BQ can fail hard — most importantly "Custom quota exceeded"
    // (daily QueryUsagePerDay cap), which previously 500'd every
    // contractor page once the quota was hit. Degrade gracefully:
    //   1. Serve a stale/long-lived cached copy if one exists.
    //   2. Otherwise return [] so the page can render its empty/
    //      "temporarily unavailable" state instead of crashing.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bq-cache] BQ query failed for ${key}: ${msg}`);
    try {
      const stale = await kv.get<T[]>(key);
      if (stale !== null && stale !== undefined) {
        console.warn(`[bq-cache] serving STALE cache for ${key} after BQ failure`);
        return stale;
      }
    } catch { /* KV also down — fall through to empty */ }
    // DEGRADED, not empty. `[]` here is indistinguishable from "this market really has no
    // rows", and callers have rendered it as fact: market-research scores every firm
    // registered_only -> capableDepth 0 -> ruleOfTwoMet:false (a set-aside determination made
    // on a quota error), and market-scanner has persisted an all-zero payload as its
    // LAST-GOOD snapshot, later served under an "as of {time}" banner.
    //
    // The 2 TiB/day custom quota makes this a project-wide, day-long failure mode, not a
    // rare blip — client.ts documents that exhausting it makes EVERY query fail instantly.
    //
    // Return type stays T[] so all 14 callers keep working unchanged. Callers that must not
    // fabricate a zero read the side-channel below.
    markDegraded(key, msg);
    return [];
  }
  console.log(`[bq-miss] ${key}  (${Date.now() - tBq}ms, ${Array.isArray(rows) ? rows.length : '?'} rows)`);

  DEGRADED.delete(key);   // a successful run clears any prior degraded mark

  try {
    await kv.set(key, rows, { ex: ttl });
  } catch (err) {
    console.warn(`[bq-cache] KV write failed for ${key}:`, err);
  }

  return rows;
}
