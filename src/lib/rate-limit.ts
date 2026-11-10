import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';
import { isKvQuotaError, signalKvFailure } from '@/lib/kv-ops-signal';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number; // Unix timestamp in seconds
}

// ============================================
// Per-instance fallback limiter (KV failure only)
// ============================================
// When KV errors (outage / Upstash quota), rate limiting used to disappear
// entirely (`allowed: true`). Now each instance keeps its own fixed window with
// the SAME limit/window per key. Weaker than global limiting (N instances ⇒ up to
// N× the limit) but never "unlimited". Bounded: oldest key evicted past the cap.
const LOCAL_WINDOW_MAX_KEYS = 5000;
const localWindows = new Map<string, { count: number; resetAtMs: number }>();

function checkLocalRateLimit(kvKey: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  let entry = localWindows.get(kvKey);
  if (!entry || now >= entry.resetAtMs) {
    entry = { count: 0, resetAtMs: now + windowSeconds * 1000 };
  }
  entry.count += 1;
  // refresh LRU position
  localWindows.delete(kvKey);
  localWindows.set(kvKey, entry);
  if (localWindows.size > LOCAL_WINDOW_MAX_KEYS) {
    const oldest = localWindows.keys().next().value;
    if (oldest !== undefined) localWindows.delete(oldest);
  }
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    limit,
    resetAt: Math.floor(entry.resetAtMs / 1000),
  };
}

/**
 * Fixed-window rate limiter using Vercel KV.
 * Uses atomic INCR + EXPIRE for race-safe counting.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const kvKey = `rl:${key}`;
  try {
    const count = await kv.incr(kvKey);

    // Set TTL on first hit only
    if (count === 1) {
      await kv.expire(kvKey, windowSeconds);
    }

    const ttl = await kv.ttl(kvKey);
    const resetAt = Math.floor(Date.now() / 1000) + (ttl > 0 ? ttl : windowSeconds);

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      limit,
      resetAt,
    };
  } catch (error) {
    console.warn(`[RateLimit] KV unavailable for ${kvKey}; using per-instance fallback limiter`, error);
    signalKvFailure(
      isKvQuotaError(error) ? 'quota_exceeded' : 'kv_error',
      `rate-limit KV call failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return checkLocalRateLimit(kvKey, limit, windowSeconds);
  }
}

/** 50 report generations per day per email */
export function checkReportRateLimit(email: string): Promise<RateLimitResult> {
  return checkRateLimit(`report:${email.toLowerCase()}`, 50, 86400);
}

/** 10 content generations per day per email (max 300 posts at 30/request) */
export function checkContentRateLimit(email: string): Promise<RateLimitResult> {
  return checkRateLimit(`content:${email.toLowerCase()}`, 10, 86400);
}

/** 30 requests per hour per IP (authenticated fallback) */
export function checkIPRateLimit(ip: string): Promise<RateLimitResult> {
  return checkRateLimit(`ip:${ip}`, 30, 3600);
}

/** 5 requests per hour per IP (unauthenticated users - stricter) */
export function checkUnauthenticatedIPRateLimit(ip: string): Promise<RateLimitResult> {
  return checkRateLimit(`ip:unauth:${ip}`, 5, 3600);
}

/** Get current usage count without incrementing (for usage endpoint) */
export async function getUsageCount(key: string): Promise<number> {
  const kvKey = `rl:${key}`;
  try {
    const count = await kv.get<number>(kvKey);
    return count ?? 0;
  } catch (error) {
    console.warn(`[RateLimit] Could not read usage count for ${kvKey}`, error);
    return 0;
  }
}

/** Get report usage for a user */
export async function getReportUsage(email: string): Promise<{ used: number; limit: number; remaining: number; resetAt: number }> {
  const key = `rl:report:${email.toLowerCase()}`;
  const limit = 50;
  let count = 0;
  let resetAt = Math.floor(Date.now() / 1000) + 86400;

  try {
    count = await kv.get<number>(key) ?? 0;
    const ttl = await kv.ttl(key);
    resetAt = ttl > 0 ? Math.floor(Date.now() / 1000) + ttl : resetAt;
  } catch (error) {
    console.warn(`[RateLimit] Could not read report usage for ${key}`, error);
  }

  return {
    used: count,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
  };
}

/** Get content generation usage for a user */
export async function getContentUsage(email: string): Promise<{ used: number; limit: number; remaining: number; resetAt: number }> {
  const key = `rl:content:${email.toLowerCase()}`;
  const limit = 10;
  let count = 0;
  let resetAt = Math.floor(Date.now() / 1000) + 86400;

  try {
    count = await kv.get<number>(key) ?? 0;
    const ttl = await kv.ttl(key);
    resetAt = ttl > 0 ? Math.floor(Date.now() / 1000) + ttl : resetAt;
  } catch (error) {
    console.warn(`[RateLimit] Could not read content usage for ${key}`, error);
  }

  return {
    used: count,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
  };
}

/** 30 requests per minute per IP (admin endpoints are password-protected) */
export function checkAdminRateLimit(ip: string): Promise<RateLimitResult> {
  return checkRateLimit(`admin:${ip}`, 30, 60);
}

/** Extract client IP from request headers */
export function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return '127.0.0.1';
}

/** Build a 429 response with standard rate-limit headers */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests. Please try again later.' },
    {
      status: 429,
      headers: {
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(result.resetAt),
        'Retry-After': String(result.resetAt - Math.floor(Date.now() / 1000)),
      },
    }
  );
}
