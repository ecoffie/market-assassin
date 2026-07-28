/**
 * Zoomed-out map aggregation (Eric 2026-07-28). When a view holds >= threshold contracts, return
 * per-state COUNT BUBBLES (100% coverage) instead of a truncated 1000-pin wall. These tests pin the
 * lib's contract with a mocked RPC: centroids attached, NULL/unknown state surfaced (never dropped),
 * and COUNT CONSERVATION (sum of bubbles + unknown == total — the header must reconcile).
 */
import { describe, it, expect, vi } from 'vitest';

const rpcRows: Array<{ state_code: string | null; cnt: number }> = [
  { state_code: 'VA', cnt: 17213 },
  { state_code: 'CA', cnt: 10103 },
  { state_code: 'TX', cnt: 6705 },
  { state_code: null, cnt: 107 },      // NULL state → the honest "unknown" bucket
  { state_code: 'ZZ', cnt: 40 },       // unrecognized code → also unknown (no centroid)
];
vi.mock('@/lib/supabase/server-clients', () => ({
  getReadClient: () => ({ rpc: async () => ({ data: rpcRows, error: null }) }),
}));

import { fetchRecompeteStateClusters } from './recompete-clusters';

describe('fetchRecompeteStateClusters', () => {
  const bbox = { south: 24, north: 50, west: -125, east: -66 };

  it('attaches a real centroid to each known state, biggest first', async () => {
    const r = await fetchRecompeteStateClusters(bbox, {});
    expect(r.clusters.map((c) => c.state)).toEqual(['VA', 'CA', 'TX']); // sorted desc, unknowns excluded
    expect(typeof r.clusters[0].lat).toBe('number');
    expect(typeof r.clusters[0].lng).toBe('number');
  });
  it('routes NULL and unrecognized states to the unknown bucket (never a fabricated pin)', async () => {
    const r = await fetchRecompeteStateClusters(bbox, {});
    expect(r.unknownCount).toBe(147); // 107 (null) + 40 (ZZ, no centroid)
    expect(r.clusters.find((c) => c.state === 'ZZ')).toBeUndefined();
  });
  it('COUNT CONSERVATION — clusters + unknown == total (the header reconciles)', async () => {
    const r = await fetchRecompeteStateClusters(bbox, {});
    const sum = r.clusters.reduce((s, c) => s + c.count, 0) + r.unknownCount;
    expect(sum).toBe(r.total);
    expect(r.total).toBe(17213 + 10103 + 6705 + 107 + 40);
  });
});
