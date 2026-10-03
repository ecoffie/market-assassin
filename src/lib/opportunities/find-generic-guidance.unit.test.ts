/**
 * find_opportunities generic guidance must not carry a fixed vertical/agency example. HERMETIC.
 *
 * Seen live 2026-10-02: a "janitorial services" + Navy + VA FIND returned host_rules and
 * claim_hygiene that talked about cybersecurity and SOCOM, which were hardcoded examples from the
 * cyber acceptance case, not facts from the query or the returned data. Any domain word in the
 * guidance now has to come from the query (or the rows). This test walks every NON-item string the
 * FIND result emits (presentation, summary, presentation_note, _next, horizon notes) for an
 * unrelated query and asserts none of the old fixed examples leak; then checks a cyber query still
 * names its own capability, derived from the query.
 */
import { describe, it, expect } from 'vitest';
import {
  buildFindPresentation,
  findOpportunities,
  HOST_RULES_FIND_FIRST_VALUE,
  HOST_RULES_COMPANY_ANCHORED,
  HOST_RULES_STAGE,
  HOST_RULES_REGION,
  type FindOpportunitiesResult,
} from './find-opportunities';

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

/** Every string the FIND result emits OUTSIDE the returned records (records are data, not guidance). */
function guidanceStrings(r: FindOpportunitiesResult): string[] {
  const out: string[] = [];
  const walk = (o: unknown) => {
    if (typeof o === 'string') out.push(o);
    else if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') Object.values(o).forEach(walk);
  };
  walk(r.presentation);
  walk(r.summary);
  walk(r.presentation_note);
  walk(r._next.map((n) => n.prompt));
  for (const h of Object.values(r.horizons)) {
    const { items: _items, ...rest } = h as unknown as Record<string, unknown>;
    walk(rest);
  }
  return out;
}

const VERTICAL_EXAMPLES = /cyber|socom|special operations|machining|\bIT[- ]services\b/i;
/** Static rules must not name an agency either; dynamic text may (e.g. "Navy … not all of DoD" is derived from the buyer). */
const FIXED_EXAMPLES = new RegExp(`${VERTICAL_EXAMPLES.source}|\\ball of DoD\\b`, 'i');

const futureIso = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);

describe('find_opportunities guidance is domain-neutral', () => {
  it('static host rules (every variant) carry no fixed vertical or agency example', () => {
    const all = [
      ...HOST_RULES_FIND_FIRST_VALUE,
      ...HOST_RULES_COMPANY_ANCHORED,
      ...HOST_RULES_STAGE,
      ...HOST_RULES_REGION,
    ].join('\n');
    expect(all).not.toMatch(FIXED_EXAMPLES);
    const p = buildFindPresentation(true, { stage: true, regionUnresolved: true });
    expect(JSON.stringify(p)).not.toMatch(FIXED_EXAMPLES);
  });

  it('janitorial services + Navy + VA: no cyber / SOCOM text anywhere in the guidance', async () => {
    const recompete: Row = {
      contract_id: 'C1', piid: 'N0018925C0001', incumbent_name: 'ACME CLEANING LLC', incumbent_uei: 'ABCDEFGHIJK1',
      awarding_agency: 'Department of Defense', awarding_sub_agency: 'Department of the Navy',
      naics_code: '561720', naics_description: 'JANITORIAL SERVICES', psc_code: 'S201', psc_description: 'CUSTODIAL JANITORIAL SERVICES',
      description: 'JANITORIAL SERVICES AT NAVAL STATION NORFOLK', potential_total_value: 1_000_000, total_obligation: 500_000,
      period_of_performance_current_end: futureIso(200), place_of_performance_state: 'VA', place_of_performance_city: 'NORFOLK',
      set_aside_type: null, recompete_likelihood: 'high', map_lat: null, last_synced_at: new Date().toISOString(), contract_type: 'D',
    };
    const res = await findOpportunities(
      { query: 'janitorial services', agency: 'Navy', location: 'VA' },
      { client: fakeClient({ sam_opportunities: [], recompete_opportunities: [recompete], agency_forecasts: [] }) },
    );
    const text = guidanceStrings(res).join('\n');
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(VERTICAL_EXAMPLES);
    // The only DoD mention is derived from the resolved buyer (Navy is a DoD component), not a fixed example.
    expect(res.presentation_note).toMatch(/Department of the Navy/);
    expect(res.summary.claim_hygiene).toMatch(/“janitorial services” demand/);
  });

  it('cybersecurity query: the domain word still appears, derived from the query', async () => {
    const res = await findOpportunities(
      { query: 'cybersecurity' },
      { client: fakeClient({ sam_opportunities: [], recompete_opportunities: [], agency_forecasts: [] }) },
    );
    expect(res.summary.claim_hygiene).toMatch(/confirmed “cybersecurity” demand/);
    // The fixed agency example is gone even on the cyber path: SOCOM only appears if the user named it.
    expect(guidanceStrings(res).join('\n')).not.toMatch(/socom|special operations/i);
  });
});
