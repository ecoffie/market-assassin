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

/**
 * Opt-out for verification runs. `MCP_EXTERNAL_CACHE=off` makes every read miss
 * and every write a no-op, so an acceptance script can force a cold upstream
 * path WITHOUT deleting production rows. It exists because the alternative —
 * evicting the row first — is a production write inside a script presented as
 * read-only verification, and that actually happened (2026-09-22).
 * Read-only and reversible: it never touches stored data.
 */
function cacheDisabledByEnv(): boolean {
  return String(process.env.MCP_EXTERNAL_CACHE || '').toLowerCase() === 'off';
}

function getClient(): SupabaseClient | null {
  if (cacheDisabledByEnv()) return null;
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
// ── LAST-GOOD FALLBACK (Data Core 2026-11-17) ─────────────────────────────────────────────
// Eric: "if BQ is down we should have cache on these things that have errors (not everything),
// at least on the forecasts." Unlike withCache (serve-from-cache-first, TTL), this is LIVE-FIRST:
// the source answers whenever it can. A successful, non-empty answer is snapshotted; when the
// source ERRORS, the most recent snapshot is served instead — labelled with when it was taken,
// never presented as live. An error with no snapshot stays an error (unknown, never zero).

/** How long a snapshot stays usable as a fallback. Older than this → treat as no snapshot. */
export const LAST_GOOD_MAX_AGE_SECONDS = 30 * 24 * 3600;

export interface LastGood<T> {
  value: T;
  /** ISO time the snapshot was taken (when the source last answered successfully). */
  fetchedAt: string;
}

/** The most recent snapshot regardless of TTL, bounded by LAST_GOOD_MAX_AGE_SECONDS. Never throws. */
export async function getLastGood<T>(apiType: string, params: Record<string, unknown>): Promise<LastGood<T> | null> {
  const sb = getClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('mcp_external_cache')
      .select('response_data, fetched_at')
      .eq('cache_key', generateCacheKey(apiType, params))
      .maybeSingle();
    if (error || !data || !data.fetched_at) return null;
    if (Date.now() - new Date(data.fetched_at).getTime() > LAST_GOOD_MAX_AGE_SECONDS * 1000) return null;
    return { value: data.response_data as T, fetchedAt: data.fetched_at };
  } catch (err) {
    console.error('[mcp/cache] getLastGood failed (no fallback):', err);
    return null;
  }
}

export type LiveOrLastGood<T> =
  | { value: T; source: 'live' }
  | { value: T; source: 'last_good'; fetchedAt: string }
  | { value: T; source: 'error' };

/**
 * Live-first with a labelled last-good fallback.
 * @param fetcher returns `{ value, failed }` — `failed` means the SOURCE errored (not "no rows").
 * A live non-empty success is snapshotted (TTL = LAST_GOOD_MAX_AGE_SECONDS); a live EMPTY success is
 * returned as-is and never snapshotted (an empty answer is not evidence worth preserving).
 */
export async function liveWithLastGood<T>(
  apiType: string,
  params: Record<string, unknown>,
  fetcher: () => Promise<{ value: T; failed: boolean }>,
): Promise<LiveOrLastGood<T>> {
  let res: { value: T; failed: boolean };
  try {
    res = await fetcher();
  } catch (err) {
    console.error(`[mcp/cache] ${apiType} live fetch threw:`, err);
    res = { value: undefined as unknown as T, failed: true };
  }
  if (!res.failed) {
    if (!isEmptyResult(res.value)) await setCached(apiType, params, res.value, LAST_GOOD_MAX_AGE_SECONDS);
    return { value: res.value, source: 'live' };
  }
  const snap = await getLastGood<T>(apiType, params);
  if (snap) return { value: snap.value, source: 'last_good', fetchedAt: snap.fetchedAt };
  return { value: res.value, source: 'error' };
}
