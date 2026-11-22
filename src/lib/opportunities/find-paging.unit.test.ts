/**
 * find_opportunities paging (Ask Mindy Backend Spec: "default to a summary plus the top rows; page the rest").
 *   - offset_per_horizon pages EACH horizon inside its ranked window; page 2 continues page 1 exactly;
 *   - every horizon carries page { offset, limit, returned, window_size, has_more, next_offset };
 *   - a page past the end is grounded with no rows, never "no matching …";
 *   - SQL fetches are ordered with an id tie-break and sized for offset + limit.
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


const opens = Array.from({ length: 12 }, (_, i) => notice(`n${String(i).padStart(30, '0')}`, `Janitorial services building ${i}`, 'FL', 'Tampa', 'FL', 'TAMPA'));
const backs = Array.from({ length: 12 }, (_, i) => recompete(`70B02C23P0${String(i).padStart(7, '0')}`, 'FL', `CLEANING CO ${i} LLC`));
const fcs = Array.from({ length: 12 }, (_, i) => forecast(`fc-${String(i).padStart(2, '0')}`, 'FL'));
const run = (input: Record<string, unknown>, calls: Call[] = []) => findOpportunities({ query: 'janitorial services', ...input } as never, {
  client: recordingClient({ sam_opportunities: opens, recompete_opportunities: backs, agency_forecasts: fcs }, calls),
});
const ids = (h: { items: Array<{ identity: { id: string } }> }) => h.items.map((i) => i.identity.id);

describe('offset_per_horizon pages each horizon inside its ranked window', () => {
  it('page 1 → page 2 continues exactly, no repeats, in every horizon', async () => {
    const p1 = await run({ limit_per_horizon: 5 });
    const p2 = await run({ limit_per_horizon: 5, offset_per_horizon: 5 });
    for (const k of ['open_now', 'coming_back', 'coming_soon'] as const) {
      expect(p1.horizons[k].page).toEqual({ offset: 0, limit: 5, returned: 5, window_size: 12, has_more: true, next_offset: 5 });
      expect(p2.horizons[k].page).toMatchObject({ offset: 5, returned: 5, has_more: true, next_offset: 10 });
      const a = ids(p1.horizons[k]); const b = ids(p2.horizons[k]);
      expect(a.filter((x) => b.includes(x))).toEqual([]);
    }
  });

  it('the last page says so', async () => {
    const r = await run({ limit_per_horizon: 5, offset_per_horizon: 10 });
    for (const k of ['open_now', 'coming_back', 'coming_soon'] as const) {
      expect(r.horizons[k].page).toMatchObject({ offset: 10, returned: 2, has_more: false, next_offset: null });
    }
  });

  it('a page past the end is grounded with no rows, never "no matching …"', async () => {
    const r = await run({ limit_per_horizon: 5, offset_per_horizon: 50 });
    for (const k of ['open_now', 'coming_back', 'coming_soon'] as const) {
      const h = r.horizons[k];
      expect(h.status).toBe('grounded');
      expect(h.items).toEqual([]);
      expect(h.page).toMatchObject({ returned: 0, window_size: 12, has_more: false });
    }
  });

  it('pages 1..3 cover the whole window exactly once', async () => {
    const seen: Record<string, string[]> = { open_now: [], coming_back: [], coming_soon: [] };
    for (const off of [0, 5, 10]) {
      const r = await run({ limit_per_horizon: 5, offset_per_horizon: off });
      for (const k of Object.keys(seen) as Array<keyof typeof seen>) seen[k].push(...ids(r.horizons[k as 'open_now']));
    }
    for (const k of Object.keys(seen)) {
      expect(seen[k]).toHaveLength(12);
      expect(new Set(seen[k]).size).toBe(12);
    }
  });

  it('a negative or junk offset is 0', async () => {
    const r = await run({ limit_per_horizon: 5, offset_per_horizon: -3 });
    expect(r.horizons.open_now.page?.offset).toBe(0);
  });
});

describe('the SQL fetch supports stable paging', () => {
  it('orders with an id tie-break and fetches at least offset + limit rows', async () => {
    const calls: Call[] = [];
    await run({ limit_per_horizon: 25, offset_per_horizon: 400 }, calls);
    const orders = (table: string) => calls.filter((c) => c.table === table).flatMap((c) => c.ops.filter(([m]) => m === 'order').map(([, a]) => String(a[0])));
    const limits = (table: string) => calls.filter((c) => c.table === table).flatMap((c) => c.ops.filter(([m]) => m === 'limit').map(([, a]) => Number(a[0])));
    expect(orders('sam_opportunities')).toEqual(expect.arrayContaining(['response_deadline', 'notice_id']));
    expect(orders('recompete_opportunities')).toEqual(expect.arrayContaining(['period_of_performance_current_end', 'contract_id']));
    expect(orders('agency_forecasts')).toContain('id');
    for (const t of ['sam_opportunities', 'recompete_opportunities', 'agency_forecasts']) {
      expect(Math.max(...limits(t))).toBeGreaterThanOrEqual(425);
    }
  });
});
