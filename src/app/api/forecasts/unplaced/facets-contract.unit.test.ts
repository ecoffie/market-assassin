/**
 * Behavioral contract for GET /api/forecasts/unplaced agency facets.
 *
 * Page size and facet intent are SEPARATE. The Map boot probe asks for limit=1 and
 * only needs `total`; a browse caller may ask for limit=1 AND still want byAgency.
 * Coupling them (`limit > 1`) either reintroduces the ~11k-row walk on a total-only
 * probe or silently strips facets from a legitimate limit=1 consumer.
 *
 * Contract: facets run on offset===0 by default; ONLY includeFacets=false opts out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Tracker = {
  facetSelects: number;
  facetRanges: number;
  rowRanges: number;
};

const tracker: Tracker = { facetSelects: 0, facetRanges: 0, rowRanges: 0 };

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      // First from() is the row query; any later from() is the facet tally.
      // Distinguish by whether select('source_agency') is used — see select().
      let kind: 'rows' | 'facets' = 'rows';
      const api: Record<string, unknown> = {};
      const self = () => api;
      api.select = (cols: string) => {
        if (cols === 'source_agency') {
          kind = 'facets';
          tracker.facetSelects += 1;
        }
        return self();
      };
      api.is = self;
      api.or = self;
      api.order = self;
      api.range = (from: number, to: number) => {
        if (kind === 'facets') {
          tracker.facetRanges += 1;
          return Promise.resolve({
            data: from === 0 ? [{ source_agency: 'Department of Energy' }] : [],
            error: null,
          });
        }
        tracker.rowRanges += 1;
        void to;
        return Promise.resolve({
          data: [{
            external_id: 'F-1',
            title: 'Unplaced forecast',
            source_agency: 'Department of Energy',
            contracting_office: null,
            naics_code: '541512',
            naics_description: null,
            set_aside_type: null,
            fiscal_year: '2027',
            anticipated_quarter: null,
            estimated_value_min: null,
            estimated_value_max: 1000000,
            estimated_value_range: null,
            pop_state: null,
            pop_city: null,
          }],
          count: 11371,
          error: null,
        });
      };
      return api;
    },
  }),
}));

vi.mock('@/lib/opportunities/map-data', () => ({
  applyForecastFilters: (q: unknown) => q,
}));

vi.mock('@/lib/forecasts/query', () => ({
  currentFiscalYear: () => 2026,
}));

import { GET, shouldTallyAgencyFacets } from './route';

function req(qs: string) {
  return {
    nextUrl: new URL(`https://x.test/api/forecasts/unplaced${qs ? `?${qs}` : ''}`),
  } as unknown as import('next/server').NextRequest;
}

beforeEach(() => {
  tracker.facetSelects = 0;
  tracker.facetRanges = 0;
  tracker.rowRanges = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
});

describe('shouldTallyAgencyFacets — page size ≠ facet intent', () => {
  it('defaults ON when the param is absent (backward compatible)', () => {
    expect(shouldTallyAgencyFacets(null, 0)).toBe(true);
    expect(shouldTallyAgencyFacets(undefined, 0)).toBe(true);
  });

  it('only an explicit false opts out', () => {
    expect(shouldTallyAgencyFacets('false', 0)).toBe(false);
    expect(shouldTallyAgencyFacets('true', 0)).toBe(true);
    expect(shouldTallyAgencyFacets('0', 0)).toBe(true);
    expect(shouldTallyAgencyFacets('', 0)).toBe(true);
  });

  it('still respects offset paging (facets only on the first page)', () => {
    expect(shouldTallyAgencyFacets(null, 50)).toBe(false);
    expect(shouldTallyAgencyFacets('false', 50)).toBe(false);
  });
});

describe('GET /api/forecasts/unplaced facet walk', () => {
  it('default request executes the facet pagination walk and returns byAgency', async () => {
    const res = await GET(req('limit=50'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.total).toBe(11371);
    expect(body.forecasts).toHaveLength(1);
    expect(tracker.facetSelects).toBeGreaterThan(0);
    expect(tracker.facetRanges).toBeGreaterThan(0);
    expect(body.byAgency.length).toBeGreaterThan(0);
  });

  it('limit=1 without includeFacets still tallies facets — page size is not intent', async () => {
    // RED against the limit>1 heuristic: that gate skipped facets here and broke a
    // legitimate limit=1 + facets consumer.
    const res = await GET(req('limit=1'));
    const body = await res.json();
    expect(body.total).toBe(11371);
    expect(body.forecasts).toHaveLength(1);
    expect(tracker.facetRanges).toBeGreaterThan(0);
    expect(body.byAgency.length).toBeGreaterThan(0);
  });

  it('includeFacets=false does not execute the facet pagination walk', async () => {
    // RED against limit>1: limit=50 still walked facets even when the caller opted out.
    const res = await GET(req('limit=50&includeFacets=false'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.total).toBe(11371);
    expect(body.forecasts).toHaveLength(1);
    expect(body.forecasts[0].id).toBe('F-1');
    expect(tracker.facetSelects).toBe(0);
    expect(tracker.facetRanges).toBe(0);
    expect(body.byAgency).toEqual([]);
  });

  it('includeFacets=false with limit=1 still returns the correct total and row', async () => {
    const res = await GET(req('limit=1&includeFacets=false'));
    const body = await res.json();
    expect(body.total).toBe(11371);
    expect(body.forecasts).toHaveLength(1);
    expect(tracker.rowRanges).toBe(1);
    expect(tracker.facetRanges).toBe(0);
    expect(body.byAgency).toEqual([]);
  });
});
