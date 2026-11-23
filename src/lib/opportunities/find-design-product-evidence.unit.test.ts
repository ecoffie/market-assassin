/**
 * Live FIND 2026-11-23 ("landscaping", VA) — two misleading DIRECT_MATCH rows. HERMETIC, real row shapes.
 *  1. A lab DESIGN contract (PSC C211 "ARCHITECT AND ENGINEERING- GENERAL: LANDSCAPING, INTERIOR LAYOUT,
 *     AND DESIGNING") matched only on the word in that PSC title → now RELATED_MARKET_CANDIDATE.
 *  2. "Landscaping Equipment" (PSC 3750) is a PRODUCT buy → still a match on its own words, but
 *     labelled purchase_type=product and says so.
 * Real grounds-maintenance work (PSC S208) stays DIRECT.
 */
import { describe, it, expect } from 'vitest';
import { findOpportunities } from './find-opportunities';
import { isDesignServicePsc, purchaseTypeFor } from './match-evidence';

type Row = Record<string, unknown>;

function fakeClient(tables: Record<string, Row[]>) {
  const make = (table: string) => {
    let head = false;
    const rows = tables[table] || [];
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'or', 'eq', 'is', 'gt', 'lt', 'gte', 'lte', 'ilike', 'like', 'in', 'not', 'order', 'limit', 'range', 'neq', 'filter', 'contains', 'overlaps', 'match', 'textSearch', 'maybeSingle', 'single']) {
      builder[m] = (...args: unknown[]) => {
        if (m === 'select' && (args[1] as { head?: boolean } | undefined)?.head) head = true;
        return builder;
      };
    }
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve(head ? { data: null, count: rows.length, error: null } : { data: rows, count: rows.length, error: null });
    return builder;
  };
  return { from: (t: string) => make(t), rpc: () => Promise.resolve({ data: null, error: null }) } as never;
}

const future = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
const recompete = (over: Row): Row => ({
  piid: 'X', incumbent_uei: 'ABCDEFGHJKLM', awarding_agency: 'Department of Veterans Affairs',
  awarding_sub_agency: 'Department of Veterans Affairs', naics_description: null, potential_total_value: null,
  total_obligation: 500000, period_of_performance_current_end: future(120), place_of_performance_state: 'IN',
  place_of_performance_city: null, set_aside_type: null, recompete_likelihood: 'medium', map_lat: null,
  last_synced_at: new Date().toISOString(), contract_type: 'C', ...over,
});

const DESIGN = recompete({
  contract_id: 'CONT_AWD_VA25516C0251', piid: 'VA25516C0251', incumbent_name: 'DESIGN-AIRE ENGINEERING, INC.', naics_code: '541310',
  psc_code: 'C211', psc_description: 'ARCHITECT AND ENGINEERING- GENERAL: LANDSCAPING, INTERIOR LAYOUT, AND DESIGNING',
  description: 'IGF::OT::IGF 657-502 - EXPAND BUILDING 42 FOR LABORATORY - DESIGN SERVICES FOR A NEW LABORATORY AT THE MARION VA MEDICAL CENTER, MARION, ILLINOIS.',
});
const GROUNDS = recompete({
  contract_id: 'CONT_AWD_36C26124C0043', piid: '36C26124C0043', incumbent_name: 'GROUNDS CO', naics_code: '561730',
  psc_code: 'S208', psc_description: 'HOUSEKEEPING- LANDSCAPING/GROUNDSKEEPING', description: 'GROUNDS MAINTENANCE SERVICES',
});
const EQUIPMENT: Row = {
  notice_id: 'eq1', title: '3750--VR&E Landscaping Equipment for Self-Employment;  Base; Award',
  department: 'VETERANS AFFAIRS, DEPARTMENT OF', sub_tier: 'VETERANS AFFAIRS, DEPARTMENT OF', naics_code: '333112',
  psc_code: '3750', description: 'Landscaping equipment for a veteran self-employment plan.', set_aside_code: null,
  set_aside_description: null, notice_type: 'Solicitation', response_deadline: new Date(Date.now() + 8 * 86400_000).toISOString(),
  ui_link: null, solicitation_number: '36C10D27Q0012', pop_state: null, pop_city: null, office_address: null, map_lat: null,
  updated_at: new Date().toISOString(), active: true,
};

async function run(query: string) {
  return findOpportunities(
    { query, agency: 'VA', limit_per_horizon: 25 },
    { client: fakeClient({ sam_opportunities: [EQUIPMENT], recompete_opportunities: [DESIGN, GROUNDS], agency_forecasts: [] }) },
  );
}

describe('design-services PSC and product buys are labelled as what they are', () => {
  it('lab design contract is a related-market candidate, not a direct landscaping match', async () => {
    const res = await run('landscaping');
    const back = res.horizons.coming_back.items;
    const design = back.find((i) => i.contract_id === 'CONT_AWD_VA25516C0251');
    const grounds = back.find((i) => i.contract_id === 'CONT_AWD_36C26124C0043');
    expect(design?.evidence_class).toBe('RELATED_MARKET_CANDIDATE');
    expect(design?.match_basis?.[0]).toBe('design_service_code');
    expect(design?.why_this_matched).toMatch(/design/i);
    expect(grounds?.evidence_class).toBe('DIRECT_MATCH');
    expect(res.summary.coming_back).toMatchObject({ direct_match: 1, related_market_candidate: 1 });
  });

  it('a customer who asked for design still gets the design contract as direct', async () => {
    const res = await run('landscape design');
    const design = res.horizons.coming_back.items.find((i) => i.contract_id === 'CONT_AWD_VA25516C0251');
    expect(design?.evidence_class).toBe('DIRECT_MATCH');
  });

  it('equipment notice says it is a product purchase', async () => {
    const res = await run('landscaping');
    const eq = res.horizons.open_now.items.find((i) => i.notice_id === 'eq1');
    expect(eq?.purchase_type).toBe('product');
    expect(eq?.why_this_matched).toMatch(/equipment or supplies \(a product\), not a service/);
  });

  it('helpers', () => {
    expect(isDesignServicePsc('C211')).toBe(true);
    expect(isDesignServicePsc('S208')).toBe(false);
    expect(purchaseTypeFor('3750')).toBe('product');
    expect(purchaseTypeFor('S208')).toBe('service');
    expect(purchaseTypeFor(null)).toBeNull();
  });
});
