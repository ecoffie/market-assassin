/**
 * Short-TTL response cache for the keyless external APIs called by the Mindy
 * MCP server (EDGAR, Federal Register, CALC). Backed by the shared
 * `mcp_external_cache` Supabase table (migration 20260712_mcp_external_cache.sql).
 *
 * Why a cache at all: CALC alone fires 20-180 upstream calls per fetchPricingIntel
 * (paginated). A warm cache skips that entirely. EDGAR companyfacts and Federal
 * Register documents change at most daily, so a 1-24h TTL loses nothing and saves
 * repeated outbound calls + latency for the agent.
 *
 * Defensive by design — a tool MUST still work without the cache. If Supabase is
 * misconfigured, the table is missing, or any error occurs, this module degrades
 * to "no cache": reads return null (caller hits upstream), writes are skipped.
 * Cache failure NEVER fails a tool. (Mirrors the KV-fails-open rule in
 * src/lib/rate-limit.ts and the SAM cache pattern in src/lib/sam/utils.ts.)
 *
 * This file is used by the standalone stdio MCP server (tsx), so it creates its
 * own service-role client from env rather than depending on Next runtime helpers.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

let _client: SupabaseClient | null = null;
let _disabled = false;

function getClient(): SupabaseClient | null {
  if (_disabled) return null;
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Not configured (e.g. running the tool without env) — disable once, stay quiet.
    _disabled = true;
    return null;
  }
  _client = createClient(url, key);
  return _client;
}

/** md5(api_type + sorted-params) — same shape as src/lib/sam/utils.ts generateCacheKey. */
export function generateCacheKey(apiType: string, params: Record<string, unknown>): string {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  return createHash('md5').update(`${apiType}:${sorted}`).digest('hex');
}

/**
 * Returns the cached payload if present and unexpired, else null. Never throws.
 * A Supabase error or missing table degrades to a cache miss (caller hits upstream).
 */
export async function getCached<T>(
  apiType: string,
  params: Record<string, unknown>,
): Promise<T | null> {
  const sb = getClient();
  if (!sb) return null;
  try {
    const cacheKey = generateCacheKey(apiType, params);
    const { data, error } = await sb
      .from('mcp_external_cache')
      .select('response_data, expires_at')
      .eq('cache_key', cacheKey)
      .maybeSingle();
    if (error || !data) return null;
    if (new Date(data.expires_at).getTime() < Date.now()) return null; // expired → miss
    return data.response_data as T;
  } catch (err) {
    console.error('[mcp/cache] getCached failed (degrading to miss):', err);
    return null;
  }
}

/**
 * Stores a payload with a per-row TTL (seconds). Never throws; a write failure
 * just means the next call re-fetches upstream. Upserts on cache_key so a refresh
 * replaces the prior payload.
 */
export async function setCached(
  apiType: string,
  params: Record<string, unknown>,
  data: unknown,
  ttlSeconds: number,
): Promise<void> {
  const sb = getClient();
  if (!sb) return;
  try {
    const cacheKey = generateCacheKey(apiType, params);
    const now = Date.now();
    await sb.from('mcp_external_cache').upsert(
      {
        cache_key: cacheKey,
        api_type: apiType,
        query_params: params as Record<string, unknown>,
        response_data: data,
        fetched_at: new Date(now).toISOString(),
        expires_at: new Date(now + ttlSeconds * 1000).toISOString(),
        hit_count: 0, // reset on refresh; analytics bump-on-read is a Phase-1 follow-up
      },
      { onConflict: 'cache_key' },
    );
  } catch (err) {
    console.error('[mcp/cache] setCached failed (cache will miss next time):', err);
  }
}

/** Cache-aware fetch result — `fromCache` lets a tool surface hit/miss in `_meta`. */
export interface WithCacheResult<T> {
  value: T;
  fromCache: boolean;
}

/**
 * Cache-aware fetch. On a live hit, returns the cached payload (fromCache=true).
 * On a miss, calls `fetcher`, caches the result for ttlSeconds, returns it
 * (fromCache=false).
 *
 * ⚠️ EMPTY RESULTS ARE NOT CACHED (silent-degrade guard). The prior comment claimed
 * "only truthy payloads are cached so a genuine empty refreshes," but the guard was
 * `fresh !== null && fresh !== undefined` — an empty array `[]` is truthy, so it slipped
 * through and got cached for the full TTL. That is exactly how the recompete task-order
 * cache got POISONED during the 2026-07-26 BigQuery quota outage: a degraded lookup that
 * returned `[]` was cached for 7 days, so the re-drain read the cached empty instead of
 * re-querying BQ and never recovered the real city. An empty result is CHEAP to recompute
 * and is the exact shape a transient upstream failure produces, so we never cache it —
 * the next call re-fetches. A genuinely-empty upstream just re-confirms empty cheaply;
 * a recovered upstream now returns real rows. (See CLAUDE.md silent-failure gate + the
 * fail-loud fix in src/lib/recompete/task-orders.ts.)
 */
function isEmptyResult(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

export async function withCache<T>(
  apiType: string,
  params: Record<string, unknown>,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<WithCacheResult<T>> {
  const hit = await getCached<T>(apiType, params);
  if (hit !== null) return { value: hit, fromCache: true };
  const fresh = await fetcher();
  // Only cache a NON-empty payload — see the silent-degrade guard note above.
  if (!isEmptyResult(fresh)) {
    await setCached(apiType, params, fresh, ttlSeconds);
  }
  return { value: fresh, fromCache: false };
}