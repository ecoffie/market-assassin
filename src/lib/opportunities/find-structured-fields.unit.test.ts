/**
 * find_opportunities rows carry the structured fields the shared fit scorer maps from (#2252 / #2274 contract):
 *   - place_of_performance_state on every horizon (office_state too on Open), null = not recorded;
 *   - Open: raw set_aside_code / set_aside_description, null = not published (never '' or a guess);
 *   - Coming soon: estimated_value_min / estimated_value_max as numbers, null when absent (never 0);
 *   - each horizon: window_size = rows ranked before the page cut, to compare with matched_count.
 */
import { describe, it, expect } from 'vitest';
import { findOpportunities } from './find-opportunities';

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

const SET_ASIDE = { ...MIAMI, notice_id: 'aaaa0000000000000000000000000003', title: 'Janitorial services Orlando SDVOSB', set_aside_code: 'SDVOSBC', set_aside_description: 'Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside (FAR 19.14)' };
const VALUED = { ...forecast('f-valued', 'FL'), estimated_value_min: '250000', estimated_value_max: 1000000 };
const BLANK = { ...forecast('f-blank', 'FL'), estimated_value_min: '', estimated_value_max: 'n/a' };

describe('find_opportunities structured fields for the fit scorer', () => {
  const run = (limit = 25) => findOpportunities({ query: 'janitorial services', limit_per_horizon: limit }, {
    client: recordingClient({
      sam_opportunities: [MIAMI, NO_POP, SET_ASIDE],
      recompete_opportunities: [GENCO_FL, recompete('70B02C23P00000555', null, 'NO POP LLC')],
      agency_forecasts: [VALUED, BLANK, forecast('f-null', null)],
    }, []),
  });

  it('Open rows: place of performance, office state and the raw set-aside fields (null = not published)', async () => {
    const res = await run();
    const byId = new Map(res.horizons.open_now.items.map((i) => [String(i.notice_id), i]));
    const all = [...byId.values()];
    expect(all.length).toBeGreaterThan(0);
    for (const it of all) {
      expect(it).toHaveProperty('place_of_performance_state');
      expect(it).toHaveProperty('office_state');
      expect(it).toHaveProperty('set_aside_code');
      expect(it).toHaveProperty('set_aside_description');
    }
    const sdvosb = byId.get(SET_ASIDE.notice_id as string);
    expect(sdvosb).toBeDefined();
    expect(sdvosb).toMatchObject({ set_aside_code: 'SDVOSBC', place_of_performance_state: 'FL', office_state: 'FL' });
    const noPop = byId.get(NO_POP.notice_id as string);
    expect(noPop).toBeDefined();
    expect(noPop).toMatchObject({ place_of_performance_state: null, office_state: 'FL', set_aside_code: null, set_aside_description: null });
  });

  it('Coming back rows: structured place of performance, null when USASpending reported none', async () => {
    const res = await run();
    const back = new Map(res.horizons.coming_back.items.map((i) => [String(i.piid), i]));
    expect(back.get('70B02C23P00000103')).toMatchObject({ place_of_performance_state: 'FL' });
    expect(back.has('70B02C23P00000555')).toBe(true);
    expect(back.get('70B02C23P00000555')).toMatchObject({ place_of_performance_state: null });
  });

  it('Coming soon rows: value bounds as numbers, null when absent or not a number (never 0)', async () => {
    const res = await run();
    const soon = new Map(res.horizons.coming_soon.items.map((i) => [String(i.identity?.id), i]));
    expect(soon.has('f-valued')).toBe(true);
    expect(soon.get('f-valued')).toMatchObject({ estimated_value_min: 250000, estimated_value_max: 1000000, place_of_performance_state: 'FL' });
    expect(soon.has('f-blank')).toBe(true);
    expect(soon.get('f-blank')).toMatchObject({ estimated_value_min: null, estimated_value_max: null });
    expect(soon.has('f-null')).toBe(true);
    expect(soon.get('f-null')).toMatchObject({ place_of_performance_state: null });
    expect(soon.size).toBeGreaterThan(0);
  });

  it('window_size reports the rows ranked before the page cut', async () => {
    const res = await run(2);
    const { open_now, coming_back, coming_soon } = res.horizons;
    expect(open_now.returned_count).toBeLessThanOrEqual(2);
    expect(open_now.window_size).toBeGreaterThanOrEqual(open_now.returned_count);
    expect(open_now.window_size).toBe(3);
    expect(coming_back.window_size).toBeGreaterThanOrEqual(coming_back.returned_count);
    expect(coming_soon.window_size).toBe(3);
    expect(coming_soon.returned_count).toBe(2);
  });
});
