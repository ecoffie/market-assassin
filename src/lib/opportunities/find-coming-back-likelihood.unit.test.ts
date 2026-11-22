/**
 * find_opportunities Coming back must carry the read-time likelihood correction (annotate.ts):
 * 36C24825C0020 (VA NCO 8, RENOVATE 5 WEST, PSC Y1DA, definitive) is stored 'high' by the DB trigger
 * but is a one-time construction project → not_recurring with a basis (#2328).
 */
import { describe, it, expect } from 'vitest';
import { findOpportunities } from './find-opportunities';

type Row = Record<string, unknown>;
function fakeClient(tables: Record<string, Row[]>) {
  const make = (table: string) => {
    let head = false;
    const rows = tables[table] || [];
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of ['select', 'or', 'eq', 'is', 'gt', 'lt', 'gte', 'lte', 'ilike', 'like', 'in', 'not', 'order', 'limit', 'range', 'neq', 'filter', 'contains', 'overlaps', 'match', 'textSearch']) {
      builder[m] = (...args: unknown[]) => {
        if (m === 'select' && (args[1] as { head?: boolean } | undefined)?.head) head = true;
        return chain();
      };
    }
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve(head ? { data: null, count: rows.length, error: null } : { data: rows, count: rows.length, error: null });
    return builder;
  };
  return { from: (t: string) => make(t) } as never;
}

const base = {
  incumbent_uei: 'WRV2FR811M24', awarding_agency: 'Department of Veterans Affairs', awarding_sub_agency: 'Department of Veterans Affairs',
  naics_code: '236220', naics_description: 'Commercial and Institutional Building Construction', psc_description: null,
  total_obligation: 8442784, potential_total_value: 8442784, period_of_performance_current_end: '2027-06-23',
  place_of_performance_state: 'FL', place_of_performance_city: null, set_aside_type: 'SDVOSB', map_lat: 28.5,
  last_synced_at: '2026-11-21T21:25:47.038Z', recompete_likelihood: 'high',
};
const RENOVATE = { ...base, contract_id: 'CONT_AWD_36C24825C0020_3600_-NONE-_-NONE-', piid: '36C24825C0020', incumbent_name: 'BLUE CORD DESIGN AND CONSTRUCTION, LLC', psc_code: 'Y1DA', description: 'RENOVATE 5 WEST hospital renovation construction', contract_type: 'DEFINITIVE CONTRACT' };
const SERVICES = { ...base, contract_id: 'CONT_AWD_36C24825C0099_3600_-NONE-_-NONE-', piid: '36C24825C0099', incumbent_name: 'EXAMPLE FACILITY SERVICES', naics_code: '561210', psc_code: 'S216', description: 'hospital renovation construction support services', contract_type: 'DEFINITIVE CONTRACT' };

describe('Coming back carries the one-time-construction likelihood correction', () => {
  it('36C24825C0020 reads not_recurring with a basis; a services contract keeps its stored value', async () => {
    const res = await findOpportunities(
      { query: 'hospital renovation construction', agency: 'Department of Veterans Affairs', limit_per_horizon: 25 },
      { client: fakeClient({ sam_opportunities: [], recompete_opportunities: [RENOVATE, SERVICES], agency_forecasts: [] }) },
    );
    const items = res.horizons.coming_back.items as Array<Record<string, unknown>>;
    const renovate = items.find((i) => i.piid === '36C24825C0020');
    expect(renovate).toBeDefined();
    expect(renovate!.recompete_likelihood).toBe('not_recurring');
    expect(String(renovate!.recompete_likelihood_basis)).toMatch(/One-time construction/);
    const services = items.find((i) => i.piid === '36C24825C0099');
    if (services) {
      expect(services.recompete_likelihood).toBe('high');
      expect('recompete_likelihood_basis' in services).toBe(false);
    }
  });
});
