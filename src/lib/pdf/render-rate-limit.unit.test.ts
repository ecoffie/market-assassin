import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkBrowserRateLimits, resetFallbackWindows, type KvLike } from './render-rate-limit';

/** Rate limiting for browser-launching routes never fails open (owner condition on #2307, 2026-11-22). */
function fakeKv(): KvLike & { counts: Map<string, number>; down: boolean } {
  const counts = new Map<string, number>();
  const self = {
    counts,
    down: false,
    incr: vi.fn(async (k: string) => { if (self.down) throw new Error('down'); const n = (counts.get(k) ?? 0) + 1; counts.set(k, n); return n; }),
    expire: vi.fn(async () => { if (self.down) throw new Error('down'); return 1; }),
    ttl: vi.fn(async () => { if (self.down) throw new Error('down'); return 120; }),
  };
  return self;
}
const spec = { key: 'k', limit: 3, fallbackLimit: 1, windowSeconds: 60 };
const global = { key: 'g', limit: 2, windowSeconds: 60 };

beforeEach(() => resetFallbackWindows());

describe('checkBrowserRateLimits', () => {
  it('KV healthy: same behaviour as the shared limiter (rl: keys, INCR+EXPIRE once, TTL reset)', async () => {
    const kv = fakeKv();
    const now = () => 1_000_000_000;
    for (let i = 0; i < 3; i++) expect((await checkBrowserRateLimits([spec], global, { kv, now })).allowed).toBe(true);
    const r = await checkBrowserRateLimits([spec], global, { kv, now });
    expect(r).toMatchObject({ allowed: false, source: 'kv', retryAfter: 120 });
    expect(kv.counts.get('rl:k')).toBe(4);
    expect(kv.expire).toHaveBeenCalledTimes(1);
    expect(kv.counts.has('rl:g')).toBe(false); // the degraded global cap is not used while KV is healthy
  });

  it('KV throwing: the fallback limit decides and blocks, with a Retry-After', async () => {
    const kv = fakeKv(); kv.down = true;
    let t = 1_000_000_000;
    const now = () => t;
    expect(await checkBrowserRateLimits([spec], global, { kv, now })).toMatchObject({ allowed: true, source: 'fallback' });
    const r = await checkBrowserRateLimits([spec], global, { kv, now });
    expect(r.allowed).toBe(false);
    expect(r.retryAfter).toBe(60);
    t += 61_000; // the window rolls over
    expect((await checkBrowserRateLimits([spec], global, { kv, now })).allowed).toBe(true);
  });

  it('KV throwing: the degraded global cap applies across keys', async () => {
    const kv = fakeKv(); kv.down = true;
    const now = () => 1_000_000_000;
    const a = await checkBrowserRateLimits([{ ...spec, key: 'a' }], global, { kv, now });
    const b = await checkBrowserRateLimits([{ ...spec, key: 'b' }], global, { kv, now });
    const c = await checkBrowserRateLimits([{ ...spec, key: 'c' }], global, { kv, now });
    expect([a.allowed, b.allowed, c.allowed]).toEqual([true, true, false]);
  });

  it('one spec failing on KV puts every spec on the fallback (no half-checked request)', async () => {
    const kv = fakeKv();
    let calls = 0;
    kv.incr = vi.fn(async () => { if (++calls === 2) throw new Error('down'); return 1; });
    const r = await checkBrowserRateLimits([{ ...spec, key: 'x' }, { ...spec, key: 'y' }], global, { kv, now: () => 1 });
    expect(r.source).toBe('fallback');
    expect(r.results.every((x) => x.source === 'fallback')).toBe(true);
  });
});
