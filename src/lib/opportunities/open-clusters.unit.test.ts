/**
 * Open zoomed-out aggregation (Eric 2026-07-28, PR2). Unlike recompete (SQL RPC), Open REUSES
 * applyMapFilters + JS aggregation (Open is small ~9k; duplicating its complex filter set into SQL
 * would drift). These tests pin: same pop_state||office-state derivation as the pins, NULL/unknown
 * surfaced (never dropped), pagination past the 1000 cap, and count conservation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// A fake PostgREST builder that returns a fixed page of rows, records .range() paging, and is
// chainable/thenable. applyMapFilters just chains .eq/.or/.gt — all no-ops here.
let pages: Array<Array<Record<string, unknown>>> = [];
let pageIdx = 0; // SHARED across builders — each page loop calls .from() anew, so the counter must persist
function makeBuilder() {
  const b: Record<string, unknown> = {};
  for (const m of ['select','not','gte','lte','eq','or','gt','in','ilike','lt']) b[m] = () => b;
  b.range = () => b;
  b.then = (resolve: (v: unknown) => unknown) => {
    const data = pages[pageIdx] ?? [];
    pageIdx += 1;
    return Promise.resolve({ data, error: null }).then(resolve);
  };
  return b;
}
vi.mock('@/lib/supabase/server-clients', () => ({ getReadClient: () => ({ from: () => makeBuilder() }) }));

import { fetchOpenStateClusters } from './open-clusters';
import { parseMapFilters } from './map-filters';

const f = parseMapFilters((k) => ({ status: 'active' } as Record<string, string>)[k] || '', {});
const bbox = { south: 24, north: 50, west: -125, east: -66 };

describe('fetchOpenStateClusters', () => {
  beforeEach(() => { pageIdx = 0; });
  it('derives state as pop_state, falling back to office_address.state (mirrors the pins)', async () => {
    pages = [[
      { pop_state: 'PA' }, { pop_state: 'PA' }, { pop_state: null, office_address: { state: 'OH' } },
      { pop_state: '', office_address: { state: 'oh' } }, // normalizes to OH too
    ]];
    const r = await fetchOpenStateClusters(bbox, f);
    const pa = r.clusters.find((c) => c.state === 'PA');
    const oh = r.clusters.find((c) => c.state === 'OH');
    expect(pa?.count).toBe(2);
    expect(oh?.count).toBe(2); // office-state fallback + case-normalized
    expect(typeof pa?.lat).toBe('number');
  });
  it('routes no-state / unrecognized rows to the unknown bucket (never a fabricated pin)', async () => {
    pages = [[{ pop_state: null, office_address: null }, { pop_state: 'ZZ' }, { pop_state: 'VA' }]];
    const r = await fetchOpenStateClusters(bbox, f);
    expect(r.unknownCount).toBe(2); // null + ZZ (no centroid)
    expect(r.clusters.map((c) => c.state)).toEqual(['VA']);
  });
  it('paginates past the 1000 cap (a full page triggers another fetch)', async () => {
    const full = Array.from({ length: 1000 }, () => ({ pop_state: 'TX' }));
    pages = [full, [{ pop_state: 'TX' }]]; // page 1 full (1000) → page 2 has 1 more
    const r = await fetchOpenStateClusters(bbox, f);
    expect(r.clusters.find((c) => c.state === 'TX')?.count).toBe(1001);
  });
  it('COUNT CONSERVATION — clusters + unknown == total', async () => {
    pages = [[{ pop_state: 'PA' }, { pop_state: 'PA' }, { pop_state: null }, { pop_state: 'VA' }]];
    const r = await fetchOpenStateClusters(bbox, f);
    const sum = r.clusters.reduce((s, c) => s + c.count, 0) + r.unknownCount;
    expect(sum).toBe(r.total);
    expect(r.total).toBe(4);
  });
});
