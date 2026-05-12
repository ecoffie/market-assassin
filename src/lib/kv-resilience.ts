/**
 * KV Resilience Layer
 *
 * Enterprise-grade resilience for Vercel KV operations:
 * 1. In-memory LRU cache to reduce KV calls by 80-90%
 * 2. Circuit breaker to prevent cascading failures
 * 3. Supabase fallback for access entitlements
 * 4. Usage monitoring and alerting
 *
 * @module kv-resilience
 */

import { kv } from '@vercel/kv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ============================================
// LRU Cache Implementation
// ============================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private readonly maxSize: number;
  private readonly defaultTTL: number;

  constructor(maxSize: number = 1000, defaultTTLSeconds: number = 60) {
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTLSeconds * 1000;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlSeconds?: number): void {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlSeconds ? ttlSeconds * 1000 : this.defaultTTL),
    });
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  // Get cache stats for monitoring
  stats(): { size: number; maxSize: number; hitRate: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: cacheMetrics.hits / (cacheMetrics.hits + cacheMetrics.misses) || 0,
    };
  }
}

// Global cache instances with different TTLs
export const accessCache = new LRUCache<unknown>(2000, 30); // Access checks: 30s TTL
export const rateLimitCache = new LRUCache<number>(5000, 5); // Rate limits: 5s TTL
export const abuseCache = new LRUCache<unknown>(1000, 60); // Abuse flags: 60s TTL

// Cache metrics for monitoring
const cacheMetrics = {
  hits: 0,
  misses: 0,
  kvCalls: 0,
  kvErrors: 0,
  circuitOpen: false,
  lastError: null as string | null,
};

// ============================================
// Circuit Breaker Implementation
// ============================================

interface CircuitBreakerConfig {
  failureThreshold: number;    // Number of failures before opening
  recoveryTimeout: number;     // Milliseconds to wait before half-open
  successThreshold: number;    // Successes needed to close from half-open
}

class CircuitBreaker {
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private readonly config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      recoveryTimeout: config.recoveryTimeout ?? 60000, // 1 minute
      successThreshold: config.successThreshold ?? 2,
    };
  }

  async execute<T>(operation: () => Promise<T>, fallback: () => T): Promise<T> {
    // Check if circuit should transition from open to half-open
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.config.recoveryTimeout) {
        this.state = 'half-open';
        console.log('[CircuitBreaker] Transitioning to half-open state');
      } else {
        // Circuit is open, use fallback
        cacheMetrics.circuitOpen = true;
        return fallback();
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      return fallback();
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.state = 'closed';
        this.failures = 0;
        this.successes = 0;
        cacheMetrics.circuitOpen = false;
        console.log('[CircuitBreaker] Circuit closed - KV recovered');
      }
    } else {
      this.failures = 0;
    }
  }

  private onFailure(error: unknown): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    cacheMetrics.kvErrors++;
    cacheMetrics.lastError = error instanceof Error ? error.message : String(error);

    if (this.state === 'half-open') {
      this.state = 'open';
      this.successes = 0;
      console.warn('[CircuitBreaker] Circuit re-opened after half-open failure');
    } else if (this.failures >= this.config.failureThreshold) {
      this.state = 'open';
      cacheMetrics.circuitOpen = true;
      console.warn(`[CircuitBreaker] Circuit opened after ${this.failures} failures`);
    }
  }

  getState(): 'closed' | 'open' | 'half-open' {
    return this.state;
  }
}

// Global circuit breaker for KV operations
const kvCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  recoveryTimeout: 60000, // 1 minute
  successThreshold: 2,
});

// ============================================
// Supabase Fallback Layer
// ============================================

let supabaseClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;

  supabaseClient = createClient(url, key, { auth: { persistSession: false } });
  return supabaseClient;
}

// Access entitlement types stored in Supabase
interface UserAccessEntitlements {
  email: string;
  market_assassin_tier?: string;
  market_assassin_expires?: string;
  content_generator_access?: boolean;
  contractor_db_access?: boolean;
  recompete_access?: boolean;
  briefings_access?: boolean;
  briefings_expires_at?: string;
  oh_pro_access?: boolean;
}

/**
 * Get user access entitlements from Supabase
 * This is the source of truth for access control
 */
async function getAccessFromSupabase(email: string): Promise<UserAccessEntitlements | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select(`
        email,
        market_assassin_tier,
        market_assassin_expires,
        access_content_generator,
        access_contractor_db,
        access_recompete,
        access_briefings,
        briefings_expires_at,
        access_oh_pro
      `)
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (error || !data) return null;

    return {
      email: data.email,
      market_assassin_tier: data.market_assassin_tier,
      market_assassin_expires: data.market_assassin_expires,
      content_generator_access: data.access_content_generator,
      contractor_db_access: data.access_contractor_db,
      recompete_access: data.access_recompete,
      briefings_access: data.access_briefings,
      briefings_expires_at: data.briefings_expires_at,
      oh_pro_access: data.access_oh_pro,
    };
  } catch (error) {
    console.warn('[Supabase Fallback] Failed to get access:', error);
    return null;
  }
}

// ============================================
// Resilient KV Operations
// ============================================

/**
 * Get a value from KV with caching and circuit breaker
 */
export async function resilientGet<T>(
  key: string,
  options: {
    cache?: LRUCache<unknown>;
    cacheTTL?: number;
    fallback?: () => T | null | Promise<T | null>;
  } = {}
): Promise<T | null> {
  const { cache = accessCache, cacheTTL, fallback } = options;

  // Check local cache first
  const cached = cache.get(key) as T | undefined;
  if (cached !== undefined) {
    cacheMetrics.hits++;
    return cached;
  }
  cacheMetrics.misses++;

  // Use circuit breaker for KV call
  const result = await kvCircuitBreaker.execute<T | null>(
    async () => {
      cacheMetrics.kvCalls++;
      const value = await kv.get<T>(key);
      if (value !== null) {
        cache.set(key, value, cacheTTL);
      }
      return value;
    },
    () => null
  );

  // If KV failed and we have a fallback, try it
  if (result === null && fallback) {
    const fallbackResult = await fallback();
    if (fallbackResult !== null) {
      cache.set(key, fallbackResult, cacheTTL);
    }
    return fallbackResult;
  }

  return result;
}

/**
 * Set a value in KV with cache invalidation
 */
export async function resilientSet<T>(
  key: string,
  value: T,
  options: {
    cache?: LRUCache<unknown>;
    exSeconds?: number;
  } = {}
): Promise<boolean> {
  const { cache = accessCache, exSeconds } = options;

  // Update local cache immediately
  cache.set(key, value, exSeconds);

  // Use circuit breaker for KV call
  return kvCircuitBreaker.execute(
    async () => {
      cacheMetrics.kvCalls++;
      if (exSeconds) {
        await kv.set(key, value, { ex: exSeconds });
      } else {
        await kv.set(key, value);
      }
      return true;
    },
    () => false // Return false if KV write fails, but cache is still updated
  );
}

/**
 * Delete a value from KV with cache invalidation
 */
export async function resilientDel(
  key: string,
  options: {
    cache?: LRUCache<unknown>;
  } = {}
): Promise<boolean> {
  const { cache = accessCache } = options;

  // Invalidate local cache immediately
  cache.delete(key);

  return kvCircuitBreaker.execute(
    async () => {
      cacheMetrics.kvCalls++;
      await kv.del(key);
      return true;
    },
    () => false
  );
}

/**
 * Increment a value in KV (for rate limiting)
 */
export async function resilientIncr(
  key: string,
  options: {
    cache?: LRUCache<unknown>;
    fallbackValue?: number;
  } = {}
): Promise<number> {
  const { cache = rateLimitCache, fallbackValue = 0 } = options;

  return kvCircuitBreaker.execute(
    async () => {
      cacheMetrics.kvCalls++;
      const count = await kv.incr(key);
      cache.set(key, count, 5); // Short TTL for rate limits
      return count;
    },
    () => {
      // Fallback: get from cache or use fallback value
      const cached = cache.get(key) as number | undefined;
      return cached ?? fallbackValue;
    }
  );
}

// ============================================
// High-Level Access Check Functions
// ============================================

export interface MarketAssassinAccess {
  tier: 'standard' | 'premium';
  email: string;
  customerName?: string;
  grantedAt: string;
  expiresAt?: string;
}

/**
 * Check Market Assassin access with full resilience
 * Priority: Local Cache → KV → Supabase
 */
export async function getMarketAssassinAccessResilient(
  email: string
): Promise<MarketAssassinAccess | null> {
  const normalizedEmail = email.toLowerCase();
  const cacheKey = `ma:${normalizedEmail}`;

  return resilientGet<MarketAssassinAccess>(cacheKey, {
    cache: accessCache,
    cacheTTL: 30, // 30 seconds
    fallback: async () => {
      // Fallback to Supabase
      const supabaseAccess = await getAccessFromSupabase(normalizedEmail);
      if (!supabaseAccess?.market_assassin_tier) return null;

      // Check expiration
      if (supabaseAccess.market_assassin_expires) {
        const expiresAt = new Date(supabaseAccess.market_assassin_expires);
        if (expiresAt < new Date()) return null;
      }

      return {
        tier: supabaseAccess.market_assassin_tier as 'standard' | 'premium',
        email: normalizedEmail,
        grantedAt: new Date().toISOString(), // Unknown from Supabase
        expiresAt: supabaseAccess.market_assassin_expires,
      };
    },
  });
}

/**
 * Check if user has briefings access with full resilience
 */
export async function hasBriefingsAccessResilient(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase();
  const cacheKey = `briefings:${normalizedEmail}`;

  const result = await resilientGet<boolean | string>(cacheKey, {
    cache: accessCache,
    cacheTTL: 30,
    fallback: async () => {
      const supabaseAccess = await getAccessFromSupabase(normalizedEmail);
      if (!supabaseAccess?.briefings_access) return false;

      // Check expiration
      if (supabaseAccess.briefings_expires_at) {
        const expiresAt = new Date(supabaseAccess.briefings_expires_at);
        if (expiresAt < new Date()) return false;
      }

      return true;
    },
  });

  return !!result;
}

/**
 * Check if user has content generator access
 */
export async function hasContentGeneratorAccessResilient(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase();
  const cacheKey = `contentgen:${normalizedEmail}`;

  const result = await resilientGet<boolean | string>(cacheKey, {
    cache: accessCache,
    cacheTTL: 30,
    fallback: async () => {
      const supabaseAccess = await getAccessFromSupabase(normalizedEmail);
      return supabaseAccess?.content_generator_access ?? false;
    },
  });

  return !!result;
}

/**
 * Check if user has contractor database access
 */
export async function hasContractorDbAccessResilient(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase();
  const cacheKey = `dbaccess:${normalizedEmail}`;

  const result = await resilientGet<boolean | string>(cacheKey, {
    cache: accessCache,
    cacheTTL: 30,
    fallback: async () => {
      const supabaseAccess = await getAccessFromSupabase(normalizedEmail);
      return supabaseAccess?.contractor_db_access ?? false;
    },
  });

  return !!result;
}

/**
 * Check if user has recompete access
 */
export async function hasRecompeteAccessResilient(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase();
  const cacheKey = `recompete:${normalizedEmail}`;

  const result = await resilientGet<boolean | string>(cacheKey, {
    cache: accessCache,
    cacheTTL: 30,
    fallback: async () => {
      const supabaseAccess = await getAccessFromSupabase(normalizedEmail);
      return supabaseAccess?.recompete_access ?? false;
    },
  });

  return !!result;
}

/**
 * Check if user has OH Pro access
 */
export async function hasOHProAccessResilient(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase();
  const cacheKey = `ospro:${normalizedEmail}`;

  const result = await resilientGet<boolean | string>(cacheKey, {
    cache: accessCache,
    cacheTTL: 30,
    fallback: async () => {
      const supabaseAccess = await getAccessFromSupabase(normalizedEmail);
      return supabaseAccess?.oh_pro_access ?? false;
    },
  });

  return !!result;
}

// ============================================
// Monitoring & Alerting
// ============================================

export interface KVHealthMetrics {
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  kvCalls: number;
  kvErrors: number;
  kvErrorRate: number;
  circuitState: 'closed' | 'open' | 'half-open';
  circuitOpen: boolean;
  lastError: string | null;
  cacheStats: {
    access: { size: number; maxSize: number };
    rateLimit: { size: number; maxSize: number };
    abuse: { size: number; maxSize: number };
  };
}

/**
 * Get current KV health metrics for monitoring
 */
export function getKVHealthMetrics(): KVHealthMetrics {
  const totalRequests = cacheMetrics.hits + cacheMetrics.misses;

  return {
    cacheHits: cacheMetrics.hits,
    cacheMisses: cacheMetrics.misses,
    cacheHitRate: totalRequests > 0 ? cacheMetrics.hits / totalRequests : 0,
    kvCalls: cacheMetrics.kvCalls,
    kvErrors: cacheMetrics.kvErrors,
    kvErrorRate: cacheMetrics.kvCalls > 0 ? cacheMetrics.kvErrors / cacheMetrics.kvCalls : 0,
    circuitState: kvCircuitBreaker.getState(),
    circuitOpen: cacheMetrics.circuitOpen,
    lastError: cacheMetrics.lastError,
    cacheStats: {
      access: { size: accessCache.size(), maxSize: 2000 },
      rateLimit: { size: rateLimitCache.size(), maxSize: 5000 },
      abuse: { size: abuseCache.size(), maxSize: 1000 },
    },
  };
}

/**
 * Reset metrics (useful for testing or after alerts)
 */
export function resetKVMetrics(): void {
  cacheMetrics.hits = 0;
  cacheMetrics.misses = 0;
  cacheMetrics.kvCalls = 0;
  cacheMetrics.kvErrors = 0;
  cacheMetrics.lastError = null;
}

/**
 * Check if KV health is degraded (for alerting)
 */
export function isKVHealthDegraded(): {
  degraded: boolean;
  reasons: string[];
} {
  const metrics = getKVHealthMetrics();
  const reasons: string[] = [];

  // Circuit breaker is open
  if (metrics.circuitOpen) {
    reasons.push('Circuit breaker is open - KV is failing');
  }

  // High error rate (> 10%)
  if (metrics.kvErrorRate > 0.1 && metrics.kvCalls > 10) {
    reasons.push(`High KV error rate: ${(metrics.kvErrorRate * 100).toFixed(1)}%`);
  }

  // Low cache hit rate (< 50% after warmup)
  if (metrics.cacheHitRate < 0.5 && (metrics.cacheHits + metrics.cacheMisses) > 100) {
    reasons.push(`Low cache hit rate: ${(metrics.cacheHitRate * 100).toFixed(1)}%`);
  }

  return {
    degraded: reasons.length > 0,
    reasons,
  };
}

// ============================================
// Warm-up Functions
// ============================================

/**
 * Pre-warm cache for a batch of users (call during low-traffic periods)
 */
export async function warmCacheForUsers(emails: string[]): Promise<{
  warmed: number;
  failed: number;
}> {
  let warmed = 0;
  let failed = 0;

  for (const email of emails) {
    try {
      // Pre-fetch common access checks
      await getMarketAssassinAccessResilient(email);
      await hasBriefingsAccessResilient(email);
      warmed++;
    } catch {
      failed++;
    }
  }

  return { warmed, failed };
}
