/**
 * Respond early: an early-stage Open notice tells a beginner what it is and what to do.
 * Regression basis: live FIND 2026-11-23 ("landscaping", VA) returned two Sources Sought
 * notices with nothing explaining them. HERMETIC.
 */
import { describe, it, expect } from 'vitest';
import { respondEarlyFor, respondEarlySummary, HOST_RULES_RESPOND_EARLY } from './respond-early';
import { findOpportunities } from './find-opportunities';

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

const futureIso = (days: number) => new Date(Date.now() + days * 86400_000).toISOString();
const notice = (id: string, notice_type: string, title: string): Row => ({
  notice_id: id, title, department: 'VETERANS AFFAIRS, DEPARTMENT OF', sub_tier: 'VETERANS AFFAIRS, DEPARTMENT OF',
  naics_code: '561730', psc_code: 'S208', description: `${title}. Landscaping and grounds maintenance.`,
  set_aside_code: null, set_aside_description: null, notice_type, response_deadline: futureIso(10),
  ui_link: `https://sam.gov/opp/${id}/view`, solicitation_number: `SOL-${id}`, pop_state: 'WV', pop_city: 'Martinsburg',
  office_address: null, map_lat: null, updated_at: new Date().toISOString(), active: true,
});

describe('respondEarlyFor (structured notice_type only)', () => {
  it.each([
    ['Sources Sought', 'sources_sought'],
    ['Request for Information', 'request_for_information'],
    ['Presolicitation', 'presolicitation'],
  ])('%s → %s', (t, kind) => {
    expect(respondEarlyFor(t)?.kind).toBe(kind);
  });

  it.each(['Solicitation', 'Combined Synopsis/Solicitation', 'Award Notice', '', null, undefined])('%s → null', (t) => {
    expect(respondEarlyFor(t)).toBeNull();
  });

  it('sources sought says it is not a proposal and what to send', () => {
    const r = respondEarlyFor('Sources Sought')!;
    expect(r.what_it_means).toMatch(/not a request for proposals/i);
    expect(r.action).toMatch(/capability response/i);
  });

  it('summary counts returned items only', () => {
    expect(respondEarlySummary([{ notice_id: 'a', respond_early: {} }, { notice_id: 'b' }])).toEqual({ returned_count: 1, notice_ids: ['a'] });
  });

  it('host rule says returned-only and never market-wide', () => {
    expect(HOST_RULES_RESPOND_EARLY.join(' ')).toMatch(/returned items only/);
  });
});

describe('find_opportunities wiring', () => {
  it('tags early notices, summarizes them, and adds the host rule', async () => {
    const res = await findOpportunities(
      { query: 'landscaping', agency: 'VA' },
      {
        client: fakeClient({
          sam_opportunities: [
            notice('ss1', 'Sources Sought', 'Landscaping tree removal VAMC'),
            notice('sol1', 'Solicitation', 'Landscaping grounds maintenance'),
          ],
          recompete_opportunities: [],
          agency_forecasts: [],
        }),
      },
    );
    const items = res.horizons.open_now.items;
    const ss = items.find((i) => i.notice_id === 'ss1');
    const sol = items.find((i) => i.notice_id === 'sol1');
    expect(ss?.respond_early?.kind).toBe('sources_sought');
    expect(sol?.respond_early).toBeUndefined();
    expect(res.summary.respond_early).toEqual({ returned_count: 1, notice_ids: ['ss1'] });
    expect(res.presentation.host_rules.join('\n')).toMatch(/RESPOND EARLY/);
  });

  it('no early notices → no rule (no noise for the host)', async () => {
    const res = await findOpportunities(
      { query: 'landscaping', agency: 'VA' },
      { client: fakeClient({ sam_opportunities: [notice('sol1', 'Solicitation', 'Landscaping grounds maintenance')], recompete_opportunities: [], agency_forecasts: [] }) },
    );
    expect(res.summary.respond_early.returned_count).toBe(0);
    expect(res.presentation.host_rules.join('\n')).not.toMatch(/RESPOND EARLY/);
  });
});
