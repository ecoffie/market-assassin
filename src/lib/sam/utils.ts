/**
 * Shared SAM.gov API Utilities
 *
 * Rate limiting, caching, error handling for all SAM APIs
 * Includes API key rotation for rate limit management
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// ============================================
// API KEY ROTATION SYSTEM
// ============================================

/**
 * Get all available SAM API keys from environment
 * Supports: SAM_API_KEY, SAM_API_KEY_1, SAM_API_KEY_2, etc.
 */
export function getAvailableSAMKeys(): string[] {
  const keys: string[] = [];

  // Check numbered keys first (SAM_API_KEY_1, SAM_API_KEY_2, etc.)
  for (let i = 1; i <= 10; i++) {
    const key = process.env[`SAM_API_KEY_${i}`];
    if (key && key.trim()) {
      keys.push(key.trim());
    }
  }

  // If no numbered keys, fall back to single key
  if (keys.length === 0) {
    const singleKey = process.env.SAM_API_KEY;
    if (singleKey && singleKey.trim()) {
      keys.push(singleKey.trim());
    }
  }

  return keys;
}

/**
 * Get ALL distinct SAM API keys from env, deduped — across every naming
 * convention: SAM_API_KEY, SAM_API_KEY_1..10, SAM_API_KEY_BACKUP. Order:
 * numbered first, then base, then backup. Used for 429 fail-over (try each key
 * until one isn't throttled) — better than day-rotation, which still dies when
 * the day's single key hits its 1,000/day quota mid-day.
 */
export function getAllDistinctSAMKeys(): string[] {
  const raw: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const k = process.env[`SAM_API_KEY_${i}`];
    if (k && k.trim()) raw.push(k.trim());
  }
  const base = process.env.SAM_API_KEY;
  if (base && base.trim()) raw.push(base.trim());
  const backup = process.env.SAM_API_KEY_BACKUP;
  if (backup && backup.trim()) raw.push(backup.trim());
  // Dedupe, preserve order.
  return [...new Set(raw)];
}

/**
 * Keys for the SOW backfill — DELIBERATELY SEPARATE from the shared rotation.
 *
 * The SOW catalog job fires 96×/day and each record costs one authenticated SAM fetch
 * per attachment (to read the content-disposition filename) plus another to download
 * the winning document. That is thousands of calls a day. It used to draw from
 * getAllDistinctSAMKeys() — the same pool daily-alerts and sync-sam-opportunities rely
 * on — which is how a background backfill starved the paths users actually notice.
 *
 * Reads SOW_DRAIN_KEY and SOW_DRAIN_KEY_1..10 (Eric has 10 keys → ~10,000 calls/day of
 * isolated quota). Returns the shared rotation ONLY when none are set, so pulling the
 * env vars after the backlog drains restores the previous behaviour instead of
 * breaking the job.
 *
 * Mirrors SAM_ATTACHMENT_DRAIN_KEY in backfill-sam-attachments — same problem, same
 * shape of answer.
 */
/** SOW_DRAIN_KEY_1..N slots scanned. Numbered slots + the unsuffixed base = N+1 keys. */
export const SOW_DRAIN_KEY_SLOTS = 10;

export function getSowDrainKeys(): string[] {
  const raw: string[] = [];
  const base = process.env.SOW_DRAIN_KEY;
  if (base && base.trim()) raw.push(base.trim());
  for (let i = 1; i <= SOW_DRAIN_KEY_SLOTS; i++) {
    const k = process.env[`SOW_DRAIN_KEY_${i}`];
    if (k && k.trim()) raw.push(k.trim());
  }
  const dedicated = [...new Set(raw)];
  // Fall back to the shared pool only when no drain key is configured at all.
  return dedicated.length > 0 ? dedicated : getAllDistinctSAMKeys();
}

/**
 * Keys for the ATTACHMENT backfill — same isolation, and it may borrow the SOW pool.
 *
 * Why they share: the SOW catalog finished its checkable backlog on 2026-08-04 (793
 * records in ~2 minutes), leaving 9 dedicated keys almost idle. The real remaining work
 * is upstream — 14,660 active rows with no attachment URLs, which is what BLOCKS the
 * 6,118 rows the SOW job still cannot check. Fixing SOW throughput could never unblock
 * those; attachments are stage one of a two-stage pipeline.
 *
 * Order: ATTACHMENT_DRAIN keys first (if someone sets dedicated ones later they win),
 * then the SOW drain pool, then the legacy single SAM_ATTACHMENT_DRAIN_KEY. Falls back
 * to the shared rotation only when nothing dedicated exists.
 *
 * Both drains borrowing the same pool is safe: SAM's quota is per key per day, and 429
 * fail-over moves to the next key. Worst case they interleave through the same 9 keys
 * instead of one job monopolising them.
 */
export function getAttachmentDrainKeys(): string[] {
  const raw: string[] = [];
  const base = process.env.ATTACHMENT_DRAIN_KEY;
  if (base && base.trim()) raw.push(base.trim());
  for (let i = 1; i <= SOW_DRAIN_KEY_SLOTS; i++) {
    const k = process.env[`ATTACHMENT_DRAIN_KEY_${i}`];
    if (k && k.trim()) raw.push(k.trim());
  }
  // Borrow the SOW pool — dedicated, isolated from alerts/sync, and now idle.
  // Guard on hasDedicatedSowKeys(): getSowDrainKeys() FALLS BACK to the shared rotation
  // when no SOW key is set, so calling it unguarded would quietly pull alert/sync keys
  // in here under the banner of "dedicated" — the exact leak this whole change removes.
  if (hasDedicatedSowKeys()) {
    for (const k of getSowDrainKeys()) if (!raw.includes(k)) raw.push(k);
  }
  const legacy = process.env.SAM_ATTACHMENT_DRAIN_KEY;
  if (legacy && legacy.trim() && !raw.includes(legacy.trim())) raw.push(legacy.trim());
  const dedicated = [...new Set(raw)];
  return dedicated.length > 0 ? dedicated : getAllDistinctSAMKeys();
}

/** True when the SOW job is running on its own quota rather than the shared pool. */
export function hasDedicatedSowKeys(): boolean {
  if (process.env.SOW_DRAIN_KEY?.trim()) return true;
  for (let i = 1; i <= SOW_DRAIN_KEY_SLOTS; i++) if (process.env[`SOW_DRAIN_KEY_${i}`]?.trim()) return true;
  return false;
}

/**
 * Get the rotated SAM API key for today
 * Rotates based on day of year to spread load across keys
 */
export function getRotatedSAMKey(): string {
  const keys = getAvailableSAMKeys();

  if (keys.length === 0) {
    console.warn('[SAM Key Rotation] No SAM API keys configured');
    return '';
  }

  if (keys.length === 1) {
    return keys[0];
  }

  // Get day of year (1-366)
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));

  // Rotate based on day
  const keyIndex = dayOfYear % keys.length;
  const selectedKey = keys[keyIndex];

  console.log(`[SAM Key Rotation] Day ${dayOfYear}, using key ${keyIndex + 1} of ${keys.length}`);

  return selectedKey;
}

/**
 * Get key rotation status for monitoring
 */
export function getKeyRotationStatus(): {
  totalKeys: number;
  currentKeyIndex: number;
  dayOfYear: number;
  nextRotation: string;
} {
  const keys = getAvailableSAMKeys();
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));

  // Calculate next rotation (midnight)
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  return {
    totalKeys: keys.length,
    currentKeyIndex: keys.length > 0 ? (dayOfYear % keys.length) + 1 : 0,
    dayOfYear,
    nextRotation: tomorrow.toISOString()
  };
}

// Types
export interface SAMAPIConfig {
  apiType: 'opportunities' | 'awards' | 'entity' | 'subaward' | 'hierarchy';
  baseUrl: string;
  apiKey: string;
  cacheTTLHours: number;
}

export interface CacheEntry {
  id: string;
  cache_key: string;
  api_type: string;
  query_params: Record<string, unknown>;
  response_data: unknown;
  fetched_at: string;
  expires_at: string;
  hit_count: number;
}

export interface SAMError {
  status: number;
  message: string;
  retryable: boolean;
  fallbackAvailable: boolean;
}

// Constants - Use getter to get fresh rotated key on each call
export function getSAMAPIConfig(apiType: string): SAMAPIConfig {
  const rotatedKey = getRotatedSAMKey();

  const configs: Record<string, SAMAPIConfig> = {
    opportunities: {
      apiType: 'opportunities',
      baseUrl: 'https://api.sam.gov/opportunities/v2',
      apiKey: rotatedKey,
      cacheTTLHours: 1
    },
    awards: {
      apiType: 'awards',
      baseUrl: 'https://api.sam.gov/contract-awards/v1',
      apiKey: process.env.SAM_CONTRACT_AWARDS_API_KEY || rotatedKey,
      cacheTTLHours: 24
    },
    entity: {
      apiType: 'entity',
      baseUrl: 'https://api.sam.gov/entity-information/v3',
      apiKey: process.env.SAM_ENTITY_API_KEY || rotatedKey,
      // 30 DAYS, not 24 hours (Eric 2026-08-21: "UEI don't change that often they may expire
      // but still"). He is right, and the 24h TTL was actively harmful: an entity's SAM
      // registration — legal name, UEI, CAGE, address, business types — is stable for months,
      // yet we threw the answer away nightly and spent quota re-fetching it. There are already
      // 10,712 cached entity rows; at 24h essentially all of them expire before they are reused.
      //
      // That waste is what exhausts the 1,000/day-per-key limit: measured 2026-08-21, TWO of the
      // four production keys were returning 429, which is why UEI lookups failed twice in a week.
      //
      // 30 days is the right trade for data that changes on a registration cycle. A registration
      // that lapses mid-window is the ONE staleness risk, and 'registrationStatus' rides in the
      // cached payload, so a caller can still see Active vs Expired — it is simply up to 30 days
      // old rather than up to 1 day old.
      cacheTTLHours: 720
    },
    subaward: {
      apiType: 'subaward',
      baseUrl: 'https://api.sam.gov/prod/subaward/v1',
      apiKey: process.env.SAM_SUBAWARD_API_KEY || rotatedKey,
      cacheTTLHours: 24
    },
    hierarchy: {
      apiType: 'hierarchy',
      baseUrl: 'https://api.sam.gov/prod/federalorganizations/v1',
      apiKey: process.env.SAM_HIERARCHY_API_KEY || rotatedKey,
      cacheTTLHours: 168 // 7 days
    }
  };

  return configs[apiType] || configs.opportunities;
}

// Legacy constant for backward compatibility (uses rotated key)
export const SAM_API_CONFIGS: Record<string, SAMAPIConfig> = {
  opportunities: {
    apiType: 'opportunities',
    baseUrl: 'https://api.sam.gov/opportunities/v2',
    apiKey: '', // Will be set dynamically
    cacheTTLHours: 1
  },
  awards: {
    apiType: 'awards',
    baseUrl: 'https://api.sam.gov/contract-awards/v1',
    apiKey: '',
    cacheTTLHours: 24
  },
  entity: {
    apiType: 'entity',
    baseUrl: 'https://api.sam.gov/entity-information/v3',
    apiKey: '',
    cacheTTLHours: 24
  },
  subaward: {
    apiType: 'subaward',
    baseUrl: 'https://api.sam.gov/prod/subaward/v1',
    apiKey: '',
    cacheTTLHours: 24
  },
  hierarchy: {
    apiType: 'hierarchy',
    baseUrl: 'https://api.sam.gov/prod/federalorganizations/v1',
    apiKey: '',
    cacheTTLHours: 168
  }
};

// Rate limit tracking (in-memory for now, could be Redis/KV)
const rateLimitState: Record<string, { count: number; resetAt: number }> = {};

const RATE_LIMIT = {
  requestsPerDay: 1000,
  requestsPerMinute: 10,
  windowMs: 24 * 60 * 60 * 1000 // 24 hours
};

// Supabase client for caching
function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.warn('Supabase not configured for SAM API caching');
    return null;
  }

  return createClient(url, key);
}

/**
 * Generate cache key from API type and query params
 */
export function generateCacheKey(apiType: string, params: Record<string, unknown>): string {
  const sortedParams = JSON.stringify(params, Object.keys(params).sort());
  return crypto.createHash('md5').update(`${apiType}:${sortedParams}`).digest('hex');
}

/**
 * Check rate limit before making request
 */
export function checkRateLimit(apiType: string): { allowed: boolean; remaining: number; resetIn: number } {
  const key = `sam_${apiType}`;
  const now = Date.now();

  if (!rateLimitState[key] || rateLimitState[key].resetAt < now) {
    rateLimitState[key] = {
      count: 0,
      resetAt: now + RATE_LIMIT.windowMs
    };
  }

  const state = rateLimitState[key];
  const remaining = RATE_LIMIT.requestsPerDay - state.count;
  const resetIn = Math.max(0, state.resetAt - now);

  return {
    allowed: remaining > 0,
    remaining,
    resetIn
  };
}

/**
 * Increment rate limit counter
 */
export function incrementRateLimit(apiType: string): void {
  const key = `sam_${apiType}`;
  if (rateLimitState[key]) {
    rateLimitState[key].count++;
  }
}

/**
 * Check cache for existing response
 */
export async function checkCache(
  apiType: string,
  params: Record<string, unknown>
): Promise<unknown | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const cacheKey = generateCacheKey(apiType, params);

  try {
    // maybeSingle, NOT single: a cache MISS is the normal path, but .single()
    // turns "0 rows" into PGRST116 → HTTP 406, which the API gateway logs as a
    // warning. That was ~12.6k gateway warnings/day — one per miss, all noise.
    // maybeSingle returns {data: null, error: null} + 200 for the same miss.
    const { data, error } = await supabase
      .from('sam_api_cache')
      .select('response_data, expires_at, hit_count')
      .eq('cache_key', cacheKey)
      .maybeSingle();

    if (error || !data) return null;

    // Check if expired
    if (new Date(data.expires_at) < new Date()) {
      // Delete expired entry
      await supabase.from('sam_api_cache').delete().eq('cache_key', cacheKey);
      return null;
    }

    // Increment hit count
    await supabase
      .from('sam_api_cache')
      .update({ hit_count: (data.hit_count || 0) + 1 })
      .eq('cache_key', cacheKey);

    console.log(`[SAM Cache HIT] ${apiType}:${cacheKey}`);
    return data.response_data;
  } catch (err) {
    console.error('[SAM Cache Error]', err);
    return null;
  }
}

/**
 * Store response in cache
 */
export async function storeInCache(
  apiType: string,
  params: Record<string, unknown>,
  response: unknown,
  ttlHours: number
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const cacheKey = generateCacheKey(apiType, params);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  try {
    await supabase
      .from('sam_api_cache')
      .upsert({
        cache_key: cacheKey,
        api_type: apiType,
        query_params: params,
        response_data: response,
        fetched_at: new Date().toISOString(),
        expires_at: expiresAt,
        hit_count: 0
      }, { onConflict: 'cache_key' });

    console.log(`[SAM Cache STORE] ${apiType}:${cacheKey}, TTL: ${ttlHours}h`);
  } catch (err) {
    console.error('[SAM Cache Store Error]', err);
  }
}

/**
 * Parse SAM API error response
 */
export function parseSAMError(status: number, body: unknown): SAMError {
  const message = typeof body === 'object' && body !== null
    ? (body as Record<string, string>).message || JSON.stringify(body)
    : String(body);

  // ⚠️ 429 IS NOT THE ONLY UNUSABLE-KEY CONDITION (DEFECT-7, 2026-08-24). A key can also be
  // REJECTED — SAM returns API_KEY_INVALID as a 401 — and a rejected key is just as unusable
  // as an exhausted one. Marking 401/403 as `fallbackAvailable:false` told the caller "there
  // is nothing to fail over to" while three other keys sat unused, which is how a dead key
  // produced "this company is not registered in SAM".
  //
  // `retryable` deliberately stays NARROW: retrying the SAME rejected key is pointless, so a
  // 401/403 is fallback-able (try a DIFFERENT key) but not retryable (do not hammer this one).
  const keyUnusable = status === 429 || status === 401 || status === 403;
  return {
    status,
    message,
    retryable: status === 429 || status >= 500,
    fallbackAvailable: keyUnusable || status >= 500
  };
}

/**
 * Make SAM API request with rate limiting, caching, and error handling
 */
export async function makeSAMRequest<T>(
  config: SAMAPIConfig,
  endpoint: string,
  params: Record<string, string | number | boolean>,
  options: {
    useCache?: boolean;
    bypassRateLimit?: boolean;
  } = {}
): Promise<{ data: T | null; error: SAMError | null; fromCache: boolean }> {
  const { useCache = true, bypassRateLimit = false } = options;

  // 1. Check cache first
  if (useCache) {
    const cached = await checkCache(config.apiType, params);
    if (cached) {
      return { data: cached as T, error: null, fromCache: true };
    }
  }

  // 2. Check rate limit
  if (!bypassRateLimit) {
    const rateLimit = checkRateLimit(config.apiType);
    if (!rateLimit.allowed) {
      return {
        data: null,
        error: {
          status: 429,
          message: `Rate limit exceeded. Resets in ${Math.ceil(rateLimit.resetIn / 1000 / 60)} minutes`,
          retryable: true,
          fallbackAvailable: true
        },
        fromCache: false
      };
    }
  }

  // 3. Build URL — SAM uses query-param auth (?api_key=...), NOT
  // Bearer header. Bug fixed 2026-05-26: was sending Bearer which
  // returned 404 on Entity API for valid UEIs.
  const url = new URL(`${config.baseUrl}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.append(key, String(value));
    }
  });
  if (config.apiKey) {
    url.searchParams.append('api_key', config.apiKey);
  }

  // 4. Make request
  try {
    console.log(`[SAM API Request] ${config.apiType}: ${url.pathname}`);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    // Increment rate limit counter
    incrementRateLimit(config.apiType);

    if (!response.ok) {
      const errorBody = await response.text();
      let parsed;
      try {
        parsed = JSON.parse(errorBody);
      } catch {
        parsed = errorBody;
      }

      return {
        data: null,
        error: parseSAMError(response.status, parsed),
        fromCache: false
      };
    }

    const data = await response.json();

    // 5. Store in cache
    if (useCache) {
      await storeInCache(config.apiType, params, data, config.cacheTTLHours);
    }

    return { data: data as T, error: null, fromCache: false };

  } catch (err) {
    console.error(`[SAM API Error] ${config.apiType}:`, err);
    return {
      data: null,
      error: {
        status: 500,
        message: err instanceof Error ? err.message : 'Network error',
        retryable: true,
        fallbackAvailable: true
      },
      fromCache: false
    };
  }
}

/**
 * Exponential backoff retry
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(`[SAM Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

/**
 * Clean expired cache entries (run periodically)
 */
export async function cleanExpiredCache(): Promise<number> {
  const supabase = getSupabaseClient();
  if (!supabase) return 0;

  try {
    const { data, error } = await supabase
      .from('sam_api_cache')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('id');

    if (error) throw error;

    const count = data?.length || 0;
    console.log(`[SAM Cache Cleanup] Removed ${count} expired entries`);
    return count;
  } catch (err) {
    console.error('[SAM Cache Cleanup Error]', err);
    return 0;
  }
}

/**
 * Validate that a notice_id looks like something SAM.gov could
 * actually resolve. Rejects garbage like 'deadline-140R6026Q0068'
 * that's been polluting user_pipeline because React render keys
 * (deadline-{id}) accidentally got passed through URL query params
 * into our /api/actions/add-to-pipeline endpoint, which stored
 * them without validation.
 *
 * Accepts:
 *   - SAM internal UUIDs: 32 hex chars (e.g., 2ef4599dadd34556b6adcc241de579d9)
 *   - Solicitation numbers: agency-prefixed format like FA8773-24-R-0001,
 *     140R6026Q0068, N6274223F4007, etc. We allow a broad mix of letters
 *     digits and hyphens (4-30 chars) since formats vary across agencies.
 *
 * Rejects:
 *   - Anything starting with 'deadline-' (React render key leakage)
 *   - Empty / whitespace
 *   - Too short (<4 chars) or too long (>50 chars)
 *
 * Returns true if the value is plausibly a real SAM identifier.
 * Caller decides whether to null-out (preferred) or hard-reject when false.
 */
export function isValidSamNoticeId(noticeId: string | null | undefined): boolean {
  if (!noticeId || typeof noticeId !== 'string') return false;
  const trimmed = noticeId.trim();
  if (trimmed.length < 4 || trimmed.length > 50) return false;

  // Known bad prefixes that came from React render keys
  if (/^(deadline|alert|brief|opp|item)-/i.test(trimmed)) return false;

  // SAM internal UUID: exactly 32 hex chars
  if (/^[a-f0-9]{32}$/i.test(trimmed)) return true;

  // Solicitation number / contract number — broad format match.
  // Agencies use wildly different schemes (FA8773-24-R-0001,
  // 140R6026Q0068, N6274223F4007, W912PL19C0015, SP4701-24-R-0001).
  // We allow letters + digits + hyphens, must have at least one digit.
  if (/^[A-Z0-9-]{4,50}$/i.test(trimmed) && /\d/.test(trimmed)) return true;

  return false;
}

/**
 * Get rate limit status for all APIs
 */
export function getRateLimitStatus(): Record<string, { remaining: number; resetIn: string }> {
  const status: Record<string, { remaining: number; resetIn: string }> = {};

  for (const apiType of Object.keys(SAM_API_CONFIGS)) {
    const { remaining, resetIn } = checkRateLimit(apiType);
    status[apiType] = {
      remaining,
      resetIn: `${Math.ceil(resetIn / 1000 / 60)} minutes`
    };
  }

  return status;
}
