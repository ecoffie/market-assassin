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

/**
 * Revocation across instances. Each Vercel instance has its OWN in-memory stale store, so
 * "instance" = a separate module load (vi.resetModules). KV itself is one shared map.
 *
 * Guarantees pinned here:
 *   - a revocation that an instance OBSERVES (healthy miss) is never resurrected by a later outage;
 *   - a COLD instance (nothing observed) never invents access during an outage;
 *   - a revocation made while KV is healthy is seen by every instance on its next healthy read.
 * Known, documented bound (pinned so it cannot silently widen):
 *   - a WARM instance that last saw the grant BEFORE the revocation and then hits a KV outage before
 *     its next healthy read keeps serving the grant until its 24h stale entry expires or the instance
 *     recycles. It can never exceed 24h from that instance's last healthy read.
 */
describe('revocation across warm and cold instances', () => {
  const store = new Map<string, string>();
  let kvDown = false;
  const loadInstance = async () => {
    vi.resetModules();
    return (await import('./kv-resilience')).hasBriefingsAccessResilient;
  };
  beforeEach(() => {
    store.clear();
    kvDown = false;
    kvMock.get.mockImplementation(async (k: string) => {
      if (kvDown) throw new Error('ERR max requests limit exceeded');
      return store.has(k) ? store.get(k)! : null;
    });
  });

  it('revoked while KV healthy → every instance (warm A, warm B, cold C) denies on its next read', async () => {
    store.set('briefings:u@x.com', 'true');
    const A = await loadInstance();
    const B = await loadInstance();
    expect(await A('u@x.com')).toBe(true);
    expect(await B('u@x.com')).toBe(true);

    store.delete('briefings:u@x.com'); // revocation (webhook / admin)
    vi.advanceTimersByTime(31_000); // past the pre-existing 30s access cache
    expect(await A('u@x.com')).toBe(false);
    expect(await B('u@x.com')).toBe(false);
    const C = await loadInstance();
    expect(await C('u@x.com')).toBe(false);

    // A later outage resurrects nothing on any instance that observed the revocation, nor on a cold one.
    kvDown = true;
    vi.advanceTimersByTime(31_000);
    expect(await A('u@x.com')).toBe(false);
    expect(await B('u@x.com')).toBe(false);
    expect(await (await loadInstance())('u@x.com')).toBe(false);
  });

  it('cold instance during an outage never grants, even for a key that exists in KV', async () => {
    store.set('briefings:paid@x.com', 'true');
    kvDown = true;
    const cold = await loadInstance();
    expect(await cold('paid@x.com')).toBe(false); // resilient path is KV-only; nothing observed → deny
  });

  it('DOCUMENTED BOUND: warm instance that never observed the revocation serves the stale grant during an outage, at most 24h from its last healthy read', async () => {
    store.set('briefings:late@x.com', 'true');
    const A = await loadInstance();
    expect(await A('late@x.com')).toBe(true); // last healthy read at t0

    store.delete('briefings:late@x.com'); // revoked in KV
    kvDown = true; // outage begins before A reads again
    vi.advanceTimersByTime(31_000);
    expect(await A('late@x.com')).toBe(true); // the bound: A cannot see the revocation

    vi.advanceTimersByTime(24 * 3600 * 1000); // > 24h since A's last healthy read
    expect(await A('late@x.com')).toBe(false); // bound enforced

    kvDown = false; // and once KV is healthy, the revocation applies immediately
    expect(await A('late@x.com')).toBe(false);
  });
});
