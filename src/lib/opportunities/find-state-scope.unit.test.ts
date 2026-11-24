/**
 * A state-scoped FIND never shows work performed in another state or territory (Eric, 2026-11-16).
 *
 * Measured case: "What open opportunities are there for janitorial services in Florida?" listed
 * "Recruiting Station - Armed Forces Career Center - Guaynabo, PR" (notice 9ced517a…, pop_state PR,
 * buying office USACE Jacksonville FL) under Open now, because the old rule was "place of performance
 * OR buying-office state". Now place of performance decides whenever it is known; the buying office
 * stands in only when SAM recorded no place of performance.
 *
 * Shared code: MCP find_opportunities and Ask Mindy both call findOpportunities → applyOpenPlan.
 */
import { describe, it, expect } from 'vitest';
import { findOpportunities } from './find-opportunities';
import { stateOrExpr } from './map-filters';
import { placeOfPerformanceWinsExpr, performedOutsideRegion } from '@/lib/discovery';

type Row = Record<string, unknown>;
type Call = { table: string; ops: Array<[string, unknown[]]> };

/** Records the query chain; returns every row it holds (as if SQL admitted them) so the JS guard is exercised too. */
function recordingClient(tables: Record<string, Row[]>, calls: Call[]) {
  const make = (table: string) => {
    let head = false;
    const rec: Call = { table, ops: [] };
    calls.push(rec);
    const rows = tables[table] || [];
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'or', 'eq', 'is', 'gt', 'lt', 'gte', 'lte', 'ilike', 'like', 'in', 'not', 'order', 'limit', 'range', 'neq', 'filter', 'contains', 'overlaps', 'match', 'textSearch']) {
      b[m] = (...args: unknown[]) => {
        rec.ops.push([m, args]);
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
const notice = (id: string, title: string, pop_state: string | null, pop_city: string | null, officeState: string, officeCity: string): Row => ({
  notice_id: id, title, department: 'DEPT OF DEFENSE', sub_tier: 'DEPT OF THE ARMY', naics_code: '561720', psc_code: 'S201',
  description: 'Janitorial services', set_aside_code: null, set_aside_description: null, notice_type: 'Solicitation',
  response_deadline: FAR, ui_link: null, solicitation_number: id.toUpperCase(), pop_state, pop_city,
  office_address: { city: officeCity, state: officeState }, map_lat: 1, updated_at: FAR,
});
// The real Guaynabo notice (pop PR, office Jacksonville FL) + an in-state control + an office-only row.
const GUAYNABO = notice('9ced517a1125427bbe0052581dfd996d', 'Recruiting Station - Armed Forces Career Center - Guaynabo, PR janitorial services', 'PR', 'Guaynabo', 'FL', 'JACKSONVILLE');
const MIAMI = notice('aaaa0000000000000000000000000001', 'Janitorial services Miami Beach', 'FL', 'Miami Beach', 'FL', 'MIAMI');
const NO_POP = notice('aaaa0000000000000000000000000002', 'Janitorial services Tyndall', null, null, 'FL', 'TYNDALL AFB');

const recompete = (id: string, pos: string | null, holder: string): Row => ({
  contract_id: `CONT_AWD_${id}_7014_-NONE-_-NONE-`, piid: id, incumbent_name: holder, incumbent_uei: 'X', awarding_agency: 'Department of Homeland Security',
  awarding_sub_agency: 'U.S. Customs and Border Protection', naics_code: '561720', naics_description: 'JANITORIAL SERVICES', psc_code: 'S201',
  psc_description: 'JANITORIAL SERVICES', description: 'JANITORIAL SERVICES', potential_total_value: 1e6, total_obligation: 1e6,
  period_of_performance_current_end: '2027-03-31', place_of_performance_state: pos, place_of_performance_city: null, set_aside_type: null,
  recompete_likelihood: 'high', map_lat: 1, last_synced_at: FAR, contract_type: 'DEFINITIVE CONTRACT',
});
// Genco: a Puerto Rico company, but the contract is performed in FL (CBP National Marine Center) → stays.
const GENCO_FL = recompete('70B02C23P00000103', 'FL', 'GENCO GENERAL CONTRACTORS OF PUERTO RICO CORP.');
const SAN_JUAN = recompete('70B02C23P00000999', 'PR', 'SAN JUAN CLEANING LLC');

const forecast = (id: string, pop_state: string | null): Row => ({
  id, title: 'Janitorial services', description: 'Janitorial services', department: 'DHS', source_agency: 'DHS', naics_code: '561720',
  naics_description: 'JANITORIAL SERVICES', set_aside_type: null, estimated_value_min: null, estimated_value_max: null, estimated_value_range: null,
  anticipated_quarter: null, fiscal_year: 2099, anticipated_award_date: null, solicitation_date: null, pop_state, pop_city: null, map_lat: 1,
  status: 'active', last_synced_at: FAR, contracting_office: null, incumbent_name: null,
});

describe('placeOfPerformanceWinsExpr / performedOutsideRegion', () => {
  it('place of performance decides when known; office counts only when it is missing', () => {
    expect(placeOfPerformanceWinsExpr(['FL'])).toBe('pop_state.in.(FL),and(pop_state.is.null,or(pop_country.is.null,pop_country.eq.USA))');
    expect(placeOfPerformanceWinsExpr(['FL', 'GA'])).toBe('pop_state.in.(FL,GA),and(pop_state.is.null,or(pop_country.is.null,pop_country.eq.USA))');
    expect(placeOfPerformanceWinsExpr([])).toBeNull();
    expect(performedOutsideRegion('PR', ['FL'])).toBe(true);
    expect(performedOutsideRegion('fl', ['FL'])).toBe(false);
    expect(performedOutsideRegion(null, ['FL'])).toBe(false); // unknown location is kept, never guessed
    expect(performedOutsideRegion('', ['FL'])).toBe(false);
    expect(performedOutsideRegion('PR', [])).toBe(false); // no location asked → nothing dropped
  });

  it('a no-state notice stated to be ABROAD is outside a US region, whatever the buying office (2026-11-24)', () => {
    // MCC "ZAMBIA- Consultant Services ... Roads", bought by a DC office, matched a VA/MD/DC query.
    expect(performedOutsideRegion(null, ['VA', 'MD', 'DC'], 'ZMB')).toBe(true);
    expect(performedOutsideRegion('', ['VA', 'MD', 'DC'], 'zmb')).toBe(true);
    // Domestic or unstated country with no state: still kept (the buying office stands in).
    expect(performedOutsideRegion(null, ['VA', 'MD', 'DC'], 'USA')).toBe(false);
    expect(performedOutsideRegion(null, ['VA', 'MD', 'DC'], null)).toBe(false);
    expect(performedOutsideRegion(null, ['VA', 'MD', 'DC'])).toBe(false);
    // A known in-region state wins regardless of country; a known out-of-region state is still out.
    expect(performedOutsideRegion('VA', ['VA', 'MD', 'DC'], 'ZMB')).toBe(false);
    expect(performedOutsideRegion('PR', ['VA', 'MD', 'DC'], 'USA')).toBe(true);
    // No region asked → nothing dropped, even abroad.
    expect(performedOutsideRegion(null, [], 'ZMB')).toBe(false);
  });
});

describe('findOpportunities — Florida janitorial never shows Puerto Rico work', () => {
  const run = async (input: Parameters<typeof findOpportunities>[0], calls: Call[] = []) =>
    findOpportunities(input, {
      client: recordingClient({ sam_opportunities: [GUAYNABO, MIAMI, NO_POP], recompete_opportunities: [GENCO_FL, SAN_JUAN], agency_forecasts: [forecast('f-fl', 'FL'), forecast('f-pr', 'PR'), forecast('f-none', null)] }, calls),
    });

  it('the place-of-performance rule is IN every Open fetch, before the row cap (filter-before-limit)', async () => {
    const calls: Call[] = [];
    await run({ query: 'janitorial services', location: 'Florida', limit_per_horizon: 25 }, calls);
    const openFetches = calls.filter((c) => c.table === 'sam_opportunities' && c.ops.some(([m, a]) => m === 'select' && String(a[0]).includes('notice_type')));
    expect(openFetches.length).toBeGreaterThan(0);
    for (const c of openFetches) {
      const ors = c.ops.filter(([m]) => m === 'or').map(([, a]) => String(a[0]));
      expect(ors).toContain(stateOrExpr(['FL']));
      expect(ors).toContain(placeOfPerformanceWinsExpr(['FL']));
      const iPop = c.ops.findIndex(([m, a]) => m === 'or' && a[0] === placeOfPerformanceWinsExpr(['FL']));
      const iLimit = c.ops.findIndex(([m]) => m === 'limit');
      expect(iPop).toBeLessThan(iLimit);
    }
  });

  it('every horizon drops rows performed in PR; FL rows and rows with no recorded location stay', async () => {
    const res = await run({ query: 'janitorial services', location: 'Florida', limit_per_horizon: 25 });
    const open = res.horizons.open_now.items.map((i) => i.title);
    expect(open.some((t) => /Guaynabo/.test(t))).toBe(false);
    expect(open).toEqual(expect.arrayContaining(['Janitorial services Miami Beach', 'Janitorial services Tyndall']));

    const back = res.horizons.coming_back.items.map((i) => String(i.piid));
    expect(back).toContain('70B02C23P00000103'); // Genco — performed in FL, the company name is not a location
    expect(back).not.toContain('70B02C23P00000999');

    const soon = res.horizons.coming_soon.items.map((i) => String(i.identity?.id));
    expect(soon).not.toContain('f-pr');
    expect(soon).toEqual(expect.arrayContaining(['f-fl', 'f-none']));

    for (const h of Object.values(res.horizons)) for (const it of h.items) expect(String(it.location_label || '')).not.toMatch(/\bPR\b/);
  });

  it('no location asked → nothing is dropped and no place-of-performance predicate is added', async () => {
    const calls: Call[] = [];
    const res = await run({ query: 'janitorial services', limit_per_horizon: 25 }, calls);
    expect(res.horizons.open_now.items.some((i) => /Guaynabo/.test(i.title))).toBe(true);
    expect(calls.some((c) => c.ops.some(([m, a]) => m === 'or' && String(a[0]).startsWith('pop_state.is.null')))).toBe(false);
  });
});
