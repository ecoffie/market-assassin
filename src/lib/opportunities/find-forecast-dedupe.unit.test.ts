/**
 * FIND coming_soon uses the SAME forecast identity as generate_market_report (forecast-identity.ts):
 * a gateway listing `GW-L:<X>` and its legacy-ingest twin `<X>` (separators `_` vs `-`) are one forecast.
 * Real pairs from production report m0MvDRsue6YHm0q9Xkx4mA (NAICS 237310 / VA, 2026-11-23).
 */
import { describe, it, expect } from 'vitest';
import { findOpportunities } from './find-opportunities';

type Row = Record<string, unknown>;

function client(tables: Record<string, Row[]>) {
  const make = (table: string) => {
    let head = false;
    const rows = tables[table] || [];
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'or', 'eq', 'is', 'gt', 'lt', 'gte', 'lte', 'ilike', 'like', 'in', 'not', 'order', 'limit', 'range', 'neq', 'filter', 'contains', 'overlaps', 'match', 'textSearch']) {
      b[m] = (...args: unknown[]) => {
        if (m === 'select' && (args[1] as { head?: boolean } | undefined)?.head) head = true;
        return b;
      };
    }
    b.then = (resolve: (v: unknown) => unknown) => resolve(head ? { data: null, count: 0, error: null } : { data: rows, count: rows.length, error: null });
    return b;
  };
  return { from: (t: string) => make(t) } as never;
}

const FAR = '2099-01-01T00:00:00+00:00';
const fc = (id: string, external_id: string | null, source_agency: string, title: string, source_url: string | null, last_synced_at: string): Row => ({
  id, external_id, title, description: `${title} road maintenance`, department: source_agency, source_agency, naics_code: '237310',
  naics_description: 'HIGHWAY, STREET, AND BRIDGE CONSTRUCTION', set_aside_type: null, estimated_value_min: null, estimated_value_max: null,
  estimated_value_range: null, anticipated_quarter: null, fiscal_year: 2099, anticipated_award_date: null, solicitation_date: null,
  pop_state: 'VA', pop_city: null, map_lat: 1, status: 'active', last_synced_at, updated_at: FAR, source_url, contracting_office: null, incumbent_name: null,
});
const GW = 'https://acquisitiongateway.gov/forecast';
const FHWA_LEGACY = fc('f1', 'FHWA_2026_167', 'DOT', 'VA ST FB KNGMN-WLKR GTS', null, '2026-08-01T00:00:00Z');
const FHWA_GW = fc('f2', 'GW-L:FHWA-2026-167', 'DOT', 'VA ST FB KNGMN-WLKR GTS', GW, '2026-11-20T00:00:00Z');
const GWJ_GW = fc('f3', 'GW-L:FY26-010880', 'USDA', 'George Washington and Jefferson National Forests Road Maintenance IDIQ Forest-Wide', GW, '2026-11-20T00:00:00Z');
const GWJ_LEGACY = fc('f4', 'FY26_010880', 'USDA', 'George Washington and Jefferson National Forests Road Maintenance IDIQ Forest-Wide', null, '2026-08-01T00:00:00Z');
const NO_ID_A = fc('f5', null, 'USDA', 'Untracked road maintenance job', null, FAR);
const NO_ID_B = { ...NO_ID_A, id: 'f6', pop_state: 'WV' };

describe('find_opportunities coming_soon — gateway/legacy forecast twins', () => {
  it('shows each real pair once (the gateway listing row) and reports the removed copies', async () => {
    const res = await findOpportunities({ query: 'road maintenance', limit_per_horizon: 25 }, {
      client: client({ sam_opportunities: [], recompete_opportunities: [], agency_forecasts: [FHWA_LEGACY, FHWA_GW, GWJ_GW, GWJ_LEGACY, NO_ID_A, NO_ID_B] }),
    });
    const soon = res.horizons.coming_soon;
    const ids = soon.items.map((i) => String(i.forecast_id)).sort();
    expect(ids).toEqual(['f2', 'f3', 'f5', 'f6']);
    expect(soon.duplicates_removed).toBe(2);
    // count (6 rows) minus the 2 cross-listed copies; never below what is shown.
    expect(soon.matched_count).toBe(4);
    expect(soon.window_size).toBe(4);
  });
});
