/**
 * Resolve-time stand-in for `@vercel/kv` in the unit suite.
 *
 * Wired via vitest `resolve.alias` (not `vi.mock` in setupFiles — that mock did not
 * intercept the real client; measured 2026-11-21: metered units still dialed
 * equipped-boar-10517.upstash.io and hung to the 45s timeout).
 *
 * Instant hermetic responses. Tests that assert KV behavior (ambassadors/store)
 * may still `vi.mock('@vercel/kv', …)` and override this.
 */
import { vi } from 'vitest';

export const kv = {
  get: vi.fn(async () => null),
  set: vi.fn(async () => 'OK'),
  del: vi.fn(async () => 1),
  exists: vi.fn(async () => 0),
  expire: vi.fn(async () => 1),
  incr: vi.fn(async () => 1),
  decr: vi.fn(async () => 0),
  sadd: vi.fn(async () => 1),
  srem: vi.fn(async () => 1),
  smembers: vi.fn(async () => []),
  sismember: vi.fn(async () => 0),
  hget: vi.fn(async () => null),
  hset: vi.fn(async () => 1),
  hgetall: vi.fn(async () => ({})),
  mget: vi.fn(async () => []),
};

export default kv;
