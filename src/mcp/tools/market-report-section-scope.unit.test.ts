/**
 * Market report record sections must describe the requested market (2026-11-07).
 *
 * Prod report "risk management framework" (Pe6bpStvuJyrDmI66PrLAg):
 *   Recompetes: "Showing 3 of 19,067 found" — the keyword's NAICS coverage set (all of IT
 *     services), soonest first: NPS CAD warranty maintenance, an IRS return-viewer editor.
 *   Who to call: "6 of 6,551" generic Navy contracting staff (NAVSUP FLT LOG CTR Puget Sound),
 *     the top agency's entire roster, not people buying RMF work.
 * Market size, agencies and competitors were keyword-scoped; these two were not.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/market/keyword-coverage', () => ({
  marketKeywords: (k: string) => (k === 'drones' ? ['drones', 'unmanned aircraft', 'UAS'] : [k]),
}));

import { planRecompetes } from './market-report';
import { keywordContacts, keywordEvidenceTerms, noticeTextOrExpression } from '@/lib/market/keyword-evidence';
import { descriptionTermsOrExpression, sanitizeDescriptionTerms } from '@/lib/recompete/query';
import { renderMarketReportHtml } from '@/lib/market/market-report-html';

describe('recompetes: keyword evidence, not the NAICS coverage set', () => {
  const RMF = 'risk management framework';

  it('the RMF report filters recompetes on the description phrase, never the IT coverage set', () => {
    const plan = planRecompetes({ keyword: RMF, naicsCodes: [], evidenceTerms: keywordEvidenceTerms(RMF) });
    expect(plan.basis).toEqual({ kind: 'description_terms', terms: [RMF] });
    expect(plan.query?.description_terms).toEqual([RMF]);
    expect(plan.query?.naicsCodes).toBeUndefined();
    expect(plan.query?.naics).toBeUndefined();
  });

  it('agency and state filters reach the recompete query', () => {
    const plan = planRecompetes({ keyword: RMF, naicsCodes: [], evidenceTerms: [RMF], agency: 'Department of the Navy', state: 'VA' });
    expect(plan.query).toMatchObject({ agency: 'Department of the Navy', state: 'VA', description_terms: [RMF] });
  });

  it('a keyword with no usable phrase withholds the section instead of querying broadly', () => {
    const plan = planRecompetes({ keyword: 'IT', naicsCodes: [], evidenceTerms: keywordEvidenceTerms('IT') });
    expect(plan.query).toBeNull();
    expect(plan.withheld).toBe('no_subject_terms');
  });

  it('an explicit NAICS axis keeps its code list (unchanged)', () => {
    const plan = planRecompetes({ keyword: RMF, naicsCodes: ['541512', '541519'], evidenceTerms: [RMF] });
    expect(plan.basis).toEqual({ kind: 'naics', codes: ['541512', '541519'] });
    expect(plan.query?.naicsCodes).toEqual(['541512', '541519']);
    expect(plan.query?.description_terms).toBeUndefined();
  });

  it('no keyword and no NAICS withholds (RC-2 stays locked)', () => {
    expect(planRecompetes({ naicsCodes: [], evidenceTerms: [] }).withheld).toBe('no_subject_naics');
  });

  it('curated synonyms count as evidence; short acronyms do not', () => {
    expect(keywordEvidenceTerms('drones')).toEqual(['drones', 'unmanned aircraft']);
    expect(sanitizeDescriptionTerms(['RMF', 'IT', 'UAS'])).toEqual([]);
  });

  it('terms are made safe for the PostgREST or() grammar', () => {
    expect(sanitizeDescriptionTerms(['risk, management (framework)%_*'])).toEqual(['risk management framework']);
    expect(descriptionTermsOrExpression(['risk management framework', 'authority to operate']))
      .toBe('description.ilike.%risk management framework%,description.ilike.%authority to operate%');
    expect(descriptionTermsOrExpression(['IT'])).toBe('');
  });
});

/** A tiny recording stand-in for the Supabase query builder. */
function fakeDb(tables: Record<string, unknown[]>) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  const from = (table: string) => {
    const rec = (op: string, ...args: unknown[]) => { calls.push({ table, op, args }); return chain; };
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'or', 'not', 'neq', 'order', 'limit', 'in', 'like', 'eq']) chain[op] = (...a: unknown[]) => rec(op, ...a);
    chain.then = (resolve: (v: unknown) => unknown) => {
      const ins = calls.filter((c) => c.table === table && c.op === 'in').pop();
      let rows = tables[table] || [];
      if (ins) rows = rows.filter((r) => (ins.args[1] as string[]).includes((r as { solicitation_number: string }).solicitation_number));
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    };
    return chain;
  };
  return { db: { from }, calls };
}

describe('contacts: people on notices that name the keyword', () => {
  const notices = [
    { solicitation_number: 'W91-RMF-1', department: 'DEPT OF DEFENSE', sub_tier: 'DEPT OF THE ARMY', office: null },
    { solicitation_number: 'W91-RMF-2', department: 'DEPT OF DEFENSE', sub_tier: 'DEPT OF THE ARMY', office: null },
    { solicitation_number: '36C-RMF-3', department: 'VETERANS AFFAIRS, DEPARTMENT OF', sub_tier: 'VETERANS AFFAIRS', office: null },
  ];
  const contacts = [
    { contact_fullname: 'Todd Strasavich', contact_title: 'Contracting Officer', contact_email: 'todd@army.mil', role_category: 'contracting', solicitation_number: 'W91-RMF-1' },
    { contact_fullname: 'Todd Strasavich', contact_title: 'Contracting Officer', contact_email: 'todd@army.mil', role_category: 'contracting', solicitation_number: 'W91-RMF-2' },
    { contact_fullname: 'Gina Crank', contact_title: 'Primary Contact', contact_email: 'gina@va.gov', role_category: 'contracting', solicitation_number: '36C-RMF-3' },
    // A Navy POC on a notice that does NOT mention the keyword must never appear.
    { contact_fullname: 'Ashley Rollin', contact_title: 'Contract Specialist', contact_email: 'ashley@navy.mil', role_category: 'contracting', solicitation_number: 'N00-OTHER' },
  ];

  it('ranks people by how many keyword notices list them; off-subject POCs never appear', async () => {
    const { db, calls } = fakeDb({ sam_opportunities: notices, federal_contacts: contacts });
    const r = await keywordContacts({ terms: ['risk management framework'] }, { db });
    expect(r.people.map((p) => [p.email, p.notices])).toEqual([['todd@army.mil', 2], ['gina@va.gov', 1]]);
    expect(r.total).toBe(2);
    expect(r.notices_scanned).toBe(3);
    expect(r.people.some((p) => p.email === 'ashley@navy.mil')).toBe(false);
    expect(r.people[0]).toMatchObject({ role: 'Contracting Officer', office: 'DEPT OF THE ARMY' });
    const textOr = calls.find((c) => c.table === 'sam_opportunities' && c.op === 'or');
    expect(textOr?.args[0]).toBe(noticeTextOrExpression(['risk management framework']));
  });

  it('agency and state filters are applied to the notices', async () => {
    const { db, calls } = fakeDb({ sam_opportunities: notices, federal_contacts: contacts });
    await keywordContacts({ terms: ['risk management framework'], agency: 'Department of Veterans Affairs', state: 'va' }, { db });
    const ors = calls.filter((c) => c.table === 'sam_opportunities' && c.op === 'or').map((c) => c.args[0]);
    expect(ors).toContain('department.ilike.%VETERANS AFFAIRS%,sub_tier.ilike.%VETERANS AFFAIRS%');
    expect(ors).toContain('pop_state.eq.VA,office_address->>state.eq.VA');
  });

  it('no matching notices → no people (never a broad roster)', async () => {
    const { db } = fakeDb({ sam_opportunities: [], federal_contacts: contacts });
    const r = await keywordContacts({ terms: ['risk management framework'] }, { db });
    expect(r.people).toEqual([]);
    expect(r.total).toBe(0);
  });

  it('no usable terms → no query at all', async () => {
    const { db, calls } = fakeDb({ sam_opportunities: notices, federal_contacts: contacts });
    const r = await keywordContacts({ terms: ['IT'] }, { db });
    expect(r.people).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('rendered report says what each section was matched on', () => {
  const base = {
    subject: 'risk management framework',
    summary: {
      subject: 'risk management framework', axis: 'keyword', total_market: 79_746_235, naics_count: 13, top_psc: null,
      buying_agencies: 0, top_contractors: 0, recompetes: 1, forecasts: 0, contacts: 1, recompetes_total: 1,
      size_tiers: null, undercount_note: null,
    },
    sections: {
      market_size: null, top_agencies: [], competition: { contractors: [] }, forecasts: { forecasts: [] },
      agency_detail: null, set_aside_gap: null,
      recompetes: {
        basis: { kind: 'description_terms' as const, terms: ['risk management framework'] },
        contracts: [{ incumbent_name: 'ACME CYBER', piid: 'W91X', description: 'RISK MANAGEMENT FRAMEWORK SUPPORT', awarding_agency: 'Department of Defense', naics_code: '541519', total_obligation: 1_000_000, period_of_performance_current_end: '2027-03-01', recompete_likelihood: 'high' }],
      },
      contacts: {
        agency: 'notices that mention this keyword', office: null, total: 1,
        basis: { kind: 'keyword_notices' as const, terms: ['risk management framework'], notices_scanned: 85 },
        people: [{ name: 'Todd Strasavich', role: 'Contracting Officer', email: 'todd@army.mil', office: 'DEPT OF THE ARMY', notices: 3 }],
      },
    },
    _meta: { degraded: false, sections_grounded: 3, sections_total: 7 },
  };

  it('recompetes name the description phrase and do not print a broad population count', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const html = renderMarketReportHtml(base as any, { date: 'November 7, 2026' });
    expect(html).toContain('description mentions &quot;risk management framework&quot;');
    expect(html).not.toContain('19,067');
  });

  it('contacts say they come from keyword notices and show the notice count', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const html = renderMarketReportHtml(base as any, { date: 'November 7, 2026' });
    expect(html).toContain('SAM notices that mention');
    expect(html).toContain('<th>Notices</th>');
    expect(html).not.toContain('Real points of contact at notices');
  });
});
