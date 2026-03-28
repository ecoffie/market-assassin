/**
 * Shared SAM.gov API Utilities
 *
 * Rate limiting, caching, error handling for all SAM APIs
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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

// Constants
export const SAM_API_CONFIGS: Record<string, SAMAPIConfig> = {
  opportunities: {
    apiType: 'opportunities',
    baseUrl: 'https://api.sam.gov/opportunities/v2',
    apiKey: process.env.SAM_API_KEY || '',
    cacheTTLHours: 1
  },
  awards: {
    apiType: 'awards',
    baseUrl: 'https://api.sam.gov/contract-awards/v1',
    apiKey: process.env.SAM_CONTRACT_AWARDS_API_KEY || process.env.SAM_API_KEY || '',
    cacheTTLHours: 24
  },
  entity: {
    apiType: 'entity',
    baseUrl: 'https://api.sam.gov/entity-information/v3',
    apiKey: process.env.SAM_ENTITY_API_KEY || process.env.SAM_API_KEY || '',
    cacheTTLHours: 24
  },
  subaward: {
    apiType: 'subaward',
    baseUrl: 'https://api.sam.gov/prod/subaward/v1',
    apiKey: process.env.SAM_SUBAWARD_API_KEY || process.env.SAM_API_KEY || '',
    cacheTTLHours: 24
  },
  hierarchy: {
    apiType: 'hierarchy',
    baseUrl: 'https://api.sam.gov/prod/federalorganizations/v1',
    apiKey: process.env.SAM_HIERARCHY_API_KEY || process.env.SAM_API_KEY || '',
    cacheTTLHours: 168 // 7 days
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
    const { data, error } = await supabase
      .from('sam_api_cache')
      .select('response_data, expires_at, hit_count')
      .eq('cache_key', cacheKey)
      .single();

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

  return {
    status,
    message,
    retryable: status === 429 || status >= 500,
    fallbackAvailable: status === 429 || status >= 500
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

  // 3. Build URL
  const url = new URL(`${config.baseUrl}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.append(key, String(value));
    }
  });

  // 4. Make request
  try {
    console.log(`[SAM API Request] ${config.apiType}: ${url.pathname}`);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
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
