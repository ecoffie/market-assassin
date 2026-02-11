import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number; // Unix timestamp in seconds
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
}

/** 50 report generations per day per email */
export function checkReportRateLimit(email: string): Promise<RateLimitResult> {
  return checkRateLimit(`report:${email.toLowerCase()}`, 50, 86400);
}

/** 10 content generations per day per email (max 300 posts at 30/request) */
export function checkContentRateLimit(email: string): Promise<RateLimitResult> {
  return checkRateLimit(`content:${email.toLowerCase()}`, 10, 86400);
}

/** 30 requests per hour per IP (unauthenticated fallback) */
export function checkIPRateLimit(ip: string): Promise<RateLimitResult> {
  return checkRateLimit(`ip:${ip}`, 30, 3600);
}

/** 5 attempts per minute per IP (admin brute-force protection) */
export function checkAdminRateLimit(ip: string): Promise<RateLimitResult> {
  return checkRateLimit(`admin:${ip}`, 5, 60);
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
