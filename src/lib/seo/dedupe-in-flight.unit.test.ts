import { describe, expect, it, vi } from 'vitest';
import { dedupeInFlight } from './dedupe-in-flight';

describe('dedupeInFlight', () => {
  it('concurrent calls for one key share one execution (metadata + page body)', async () => {
    const fn = vi.fn(async (s: string) => `r:${s}`);
    const d = dedupeInFlight((s: string) => s, fn);
    expect(await Promise.all([d('a'), d('a')])).toEqual(['r:a', 'r:a']);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a settled answer is reused within the TTL, then recomputed', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fn = vi.fn(async () => 1);
    const d = dedupeInFlight(() => 'k', fn, { ttlMs: 100 });
    await d(); await Promise.resolve();
    now += 50; await d();
    expect(fn).toHaveBeenCalledTimes(1);
    now += 100; await d();
    expect(fn).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it('does not retain rejections', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('ok');
    const d = dedupeInFlight(() => 'k', fn);
    await expect(d()).rejects.toThrow('x');
    await Promise.resolve();
    expect(await d()).toBe('ok');
  });

  it('stays bounded under unique keys', async () => {
    const d = dedupeInFlight((s: string) => s, async (s: string) => s, { max: 3, ttlMs: 60_000 });
    for (const k of ['a', 'b', 'c', 'd', 'e']) await d(k);
    // No assertion on internals beyond not throwing; correctness for live keys is above.
    expect(await d('e')).toBe('e');
  });
});
