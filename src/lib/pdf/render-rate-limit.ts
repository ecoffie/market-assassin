/**
 * Rate limiting for public routes that start a headless browser (e.g. GET /reports/<id>/pdf).
 *
 * The shared limiter (src/lib/rate-limit.ts checkRateLimit) FAILS OPEN: when Vercel KV errors it allows
 * every request. That is a reasonable trade for a cheap route, but not for one where every request starts
 * Chromium. Here a KV failure falls back to an in-process, per-instance fixed window with conservative caps,
 * plus one per-instance cap across all keys while degraded. So an outage can never mean "no effective limit"
 * (owner decision on ecoffie/market-assassin#2307, 2026-11-22).
 *
 * The in-process window is per serverless instance, so it is approximate. That's acceptable for a fallback:
 * its job is to cap a single instance's Chromium launches during an outage. Normal behaviour (KV healthy)
 * is identical to checkRateLimit: same `rl:` key namespace, INCR + EXPIRE, TTL-based reset.
 */
import { kv as vercelKv } from '@vercel/kv';

export interface BrowserRateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  /** Unix seconds. */
  resetAt: number;
  /** 'kv' normally; 'fallback' when KV could not be reached and the in-process window decided. */
  source: 'kv' | 'fallback';
}

export interface KvLike {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
}

export interface LimitSpec {
  key: string;
  /** Limit while KV is healthy. */
  limit: number;
  /** Conservative limit for the in-process fallback (per instance). */
  fallbackLimit: number;
  windowSeconds: number;
}

type Window = { count: number; resetAtMs: number };
const windows = new Map<string, Window>();
const MAX_KEYS = 5000;

/** In-process fixed window. Exported for tests via resetFallbackWindows. */
function hitFallback(key: string, limit: number, windowSeconds: number, nowMs: number): BrowserRateLimitResult {
  let w = windows.get(key);
  if (!w || nowMs >= w.resetAtMs) {
    if (!w && windows.size >= MAX_KEYS) {
      // Drop expired windows first; if still full, drop the oldest insertion.
      for (const [k, v] of windows) if (nowMs >= v.resetAtMs) windows.delete(k);
      if (windows.size >= MAX_KEYS) windows.delete(windows.keys().next().value as string);
    }
    w = { count: 0, resetAtMs: nowMs + windowSeconds * 1000 };
    windows.set(key, w);
  }
  w.count += 1;
  return {
    allowed: w.count <= limit,
    remaining: Math.max(0, limit - w.count),
    limit,
    resetAt: Math.ceil(w.resetAtMs / 1000),
    source: 'fallback',
  };
}

export function resetFallbackWindows(): void {
  windows.clear();
}

async function hitKv(kv: KvLike, spec: LimitSpec, nowMs: number): Promise<BrowserRateLimitResult> {
  const kvKey = `rl:${spec.key}`;
  const count = await kv.incr(kvKey);
  if (count === 1) await kv.expire(kvKey, spec.windowSeconds);
  const ttl = await kv.ttl(kvKey);
  return {
    allowed: count <= spec.limit,
    remaining: Math.max(0, spec.limit - count),
    limit: spec.limit,
    resetAt: Math.floor(nowMs / 1000) + (ttl > 0 ? ttl : spec.windowSeconds),
    source: 'kv',
  };
}

/**
 * Check every spec. If KV fails for ANY of them, all specs are decided by the in-process fallback (with their
 * fallback limits), plus the degraded-mode global cap. Never "allow because the limiter is down".
 */
export async function checkBrowserRateLimits(
  specs: LimitSpec[],
  degradedGlobal: { key: string; limit: number; windowSeconds: number },
  deps: { kv?: KvLike; now?: () => number } = {},
): Promise<{ allowed: boolean; retryAfter: number; source: 'kv' | 'fallback'; results: BrowserRateLimitResult[] }> {
  const kv = deps.kv ?? (vercelKv as unknown as KvLike);
  const nowMs = (deps.now ?? Date.now)();
  let results: BrowserRateLimitResult[];
  try {
    results = await Promise.all(specs.map((s) => hitKv(kv, s, nowMs)));
  } catch (err) {
    console.warn('[browser-rate-limit] KV unavailable; using the in-process fallback limits', (err as Error)?.message);
    results = specs.map((s) => hitFallback(s.key, s.fallbackLimit, s.windowSeconds, nowMs));
    results.push(hitFallback(degradedGlobal.key, degradedGlobal.limit, degradedGlobal.windowSeconds, nowMs));
  }
  const blocked = results.filter((r) => !r.allowed);
  const nowSec = Math.floor(nowMs / 1000);
  const retryAfter = blocked.length ? Math.max(1, Math.max(...blocked.map((r) => r.resetAt)) - nowSec) : 0;
  return { allowed: blocked.length === 0, retryAfter, source: results[0]?.source ?? 'kv', results };
}
