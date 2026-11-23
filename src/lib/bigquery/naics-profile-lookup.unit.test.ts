/**
 * /naics/<code> outside NAICS_TOP_100 404'd on getmindy.ai (2026-11-22: 236210, 238220,
 * 561320 ... while /naics/236210/tx served 200). The profile read was cache-only with nothing
 * warming it, so a cold cache returned [] and the page called notFound() on "we don't know".
 *
 * Contract locked here:
 *   - a cold cache runs the (cheap, rollup) profile read live instead of answering [];
 *   - only a measured "no row" is `absent`; a failed read is `unavailable`, never absent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('@vercel/kv', () => ({
  kv: {
    get: vi.fn(async (k: string) => (store.has(k) ? store.get(k) : null)),
    set: vi.fn(async (k: string, v: unknown) => { store.set(k, v); return 'OK'; }),
  },
}));

const bqQuery = vi.fn();
vi.mock('./client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  bqQuery: (...args: unknown[]) => bqQuery(...args),
}));

import { lookupNaicsProfile, getNaicsProfile } from './naics';

const PROFILE = {
  naics_code: '236210',
  naics_description: 'Industrial Building Construction',
  total_obligated: 1_000_000,
  recipient_count: 12,
  agency_count: 3,
  transaction_count: 40,
};

beforeEach(() => {
  store.clear();
  bqQuery.mockReset();
});

describe('lookupNaicsProfile', () => {
  it('a cold cache runs the profile read live (it used to answer [] and 404)', async () => {
    bqQuery.mockResolvedValueOnce([PROFILE]);
    expect(await lookupNaicsProfile('236210')).toEqual({ kind: 'found', profile: PROFILE });
    expect(bqQuery).toHaveBeenCalledTimes(1);
    const opts = bqQuery.mock.calls[0][0] as { params: { code: string }; maximumBytesBilled?: string };
    expect(opts.params.code).toBe('236210');
    // Bounded: the read is a rollup lookup, never an awards scan.
    expect(Number(opts.maximumBytesBilled)).toBeLessThanOrEqual(100 * 1024 * 1024);
    expect(await getNaicsProfile('236210')).toEqual(PROFILE); // now served from cache
    expect(bqQuery).toHaveBeenCalledTimes(1);
  });

  it('a measured empty answer is absent (the only state that may 404)', async () => {
    bqQuery.mockResolvedValueOnce([]);
    expect(await lookupNaicsProfile('999999')).toEqual({ kind: 'absent' });
  });

  it('a failed read is unavailable, never absent', async () => {
    bqQuery.mockRejectedValueOnce(new Error('Quota exceeded: QueryUsagePerDay'));
    expect(await lookupNaicsProfile('238220')).toEqual({ kind: 'unavailable', reason: 'failed' });
  });

  it('a non-NAICS path segment is absent without any BigQuery read', async () => {
    expect(await lookupNaicsProfile('wp-login.php')).toEqual({ kind: 'absent' });
    expect(bqQuery).not.toHaveBeenCalled();
  });
});
