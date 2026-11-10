/**
 * KV outage failsafe regressions (2026-11-10).
 *
 * (a) rate limiting must not become "unlimited" when KV throws
 * (b) a known paid holder must not drop to Free when KV errors after the 30s cache TTL
 * (c) a KV MISS after a previous grant still revokes (stale is only for ERRORS)
 * (d) the KV-failure ops signal is rate-limited per instance
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const kvMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  ttl: vi.fn(),
}));
const opsMock = vi.hoisted(() => ({ sendOpsAlert: vi.fn(async () => ({ ok: true })) }));

vi.mock('@vercel/kv', () => ({ kv: kvMock }));
vi.mock('@/lib/ops-alert', () => opsMock);

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
  for (const fn of Object.values(kvMock)) fn.mockReset();
  opsMock.sendOpsAlert.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('checkRateLimit when KV throws', () => {
  it('enforces the same limit per instance instead of allowing everything', async () => {
    kvMock.incr.mockRejectedValue(new Error('ERR max requests limit exceeded'));
    const { checkRateLimit } = await import('./rate-limit');

    const limit = 5;
    for (let i = 0; i < limit; i++) {
      const r = await checkRateLimit('test:a@b.com', limit, 3600);
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkRateLimit('test:a@b.com', limit, 3600);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.limit).toBe(limit);

    // a different key has its own window
    expect((await checkRateLimit('test:other@b.com', limit, 3600)).allowed).toBe(true);

    // window resets
    vi.advanceTimersByTime(3601 * 1000);
    expect((await checkRateLimit('test:a@b.com', limit, 3600)).allowed).toBe(true);
  });

  it('healthy KV path is unchanged', async () => {
    kvMock.incr.mockResolvedValue(3);
    kvMock.ttl.mockResolvedValue(100);
    const { checkRateLimit } = await import('./rate-limit');
    const r = await checkRateLimit('k', 5, 3600);
    expect(r).toMatchObject({ allowed: true, remaining: 2, limit: 5 });
    expect(kvMock.expire).not.toHaveBeenCalled();
  });
});

describe('hasBriefingsAccessResilient stale-if-error', () => {
  it('keeps a known paid holder on Pro when KV errors after the 30s TTL', async () => {
    const { hasBriefingsAccessResilient } = await import('./kv-resilience');
    kvMock.get.mockResolvedValueOnce('true');
    expect(await hasBriefingsAccessResilient('Paid@Example.com')).toBe(true);

    vi.advanceTimersByTime(31_000); // past the 30s LRU TTL
    kvMock.get.mockRejectedValue(new Error('ERR max requests limit exceeded'));
    // Supabase fallback is disabled (returns null => no grant) — "Supabase says no"
    expect(await hasBriefingsAccessResilient('paid@example.com')).toBe(true);
  });

  it('a KV MISS after a previous grant revokes (stale is only consulted on error)', async () => {
    const { hasBriefingsAccessResilient } = await import('./kv-resilience');
    kvMock.get.mockResolvedValueOnce('true');
    expect(await hasBriefingsAccessResilient('rev@example.com')).toBe(true);

    vi.advanceTimersByTime(31_000);
    kvMock.get.mockResolvedValueOnce(null); // healthy KV: key deleted
    expect(await hasBriefingsAccessResilient('rev@example.com')).toBe(false);

    // and a later outage must NOT resurrect the revoked grant
    vi.advanceTimersByTime(31_000);
    kvMock.get.mockRejectedValue(new Error('boom'));
    expect(await hasBriefingsAccessResilient('rev@example.com')).toBe(false);
  });

  it('stale value expires after 24h', async () => {
    const { hasBriefingsAccessResilient } = await import('./kv-resilience');
    kvMock.get.mockResolvedValueOnce('true');
    expect(await hasBriefingsAccessResilient('old@example.com')).toBe(true);
    vi.advanceTimersByTime(24 * 3600 * 1000 + 1000);
    kvMock.get.mockRejectedValue(new Error('boom'));
    expect(await hasBriefingsAccessResilient('old@example.com')).toBe(false);
  });

  it('cold instance with no last-known value still falls through to deny', async () => {
    const { hasBriefingsAccessResilient } = await import('./kv-resilience');
    kvMock.get.mockRejectedValue(new Error('boom'));
    expect(await hasBriefingsAccessResilient('cold@example.com')).toBe(false);
  });
});

describe('KV ops signal', () => {
  it('fires once per instance per interval on quota errors', async () => {
    const { signalKvFailure, KV_OPS_SIGNAL_INTERVAL_MS } = await import('./kv-ops-signal');
    expect(signalKvFailure('quota_exceeded', 'x')).toBe(true);
    expect(signalKvFailure('quota_exceeded', 'x')).toBe(false);
    expect(signalKvFailure('circuit_open', 'y')).toBe(false);
    expect(opsMock.sendOpsAlert).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(KV_OPS_SIGNAL_INTERVAL_MS + 1);
    expect(signalKvFailure('circuit_open', 'y')).toBe(true);
    expect(opsMock.sendOpsAlert).toHaveBeenCalledTimes(2);
  });

  it('many quota errors from rate limiting + access produce a single alert', async () => {
    kvMock.incr.mockRejectedValue(new Error('ERR max requests limit exceeded'));
    kvMock.get.mockRejectedValue(new Error('ERR max requests limit exceeded'));
    const { checkRateLimit } = await import('./rate-limit');
    const { hasBriefingsAccessResilient } = await import('./kv-resilience');
    for (let i = 0; i < 20; i++) {
      await checkRateLimit(`k${i}`, 5, 60);
      await hasBriefingsAccessResilient(`u${i}@x.com`);
    }
    expect(opsMock.sendOpsAlert).toHaveBeenCalledTimes(1);
  });
});
