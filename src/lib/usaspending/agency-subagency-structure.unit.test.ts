/**
 * Live VA report (Ej6xCaGHX…, 2026-11-22): "Top sub-agencies: No rows available" beside a $90.6B total.
 * Confirmed at the source (api.usaspending.gov spending_by_category/awarding_subagency, VA FY2026 contracts):
 * ONE row, "Department of Veterans Affairs", $90.61B — VA files every award under a single self-named
 * sub-agency. A failed fetch must read as unknown, never as none.
 */
import { describe, it, expect, vi } from 'vitest';
import { classifySubAgencies } from './agency-spending-detail';

const pct = (n: number) => Math.round((n / 90_611_196_127.75) * 1000) / 10;

describe('classifySubAgencies', () => {
  it('VA: the only row is the department itself → single_self_named, not an empty breakdown', () => {
    expect(classifySubAgencies([{ name: 'Department of Veterans Affairs', amount: 90_611_196_127.75 }], 'Department of Veterans Affairs', false, pct))
      .toEqual({ sub_agencies: [], sub_agency_structure: 'single_self_named' });
  });
  it('DHS: components listed (the self row, if any, still dropped)', () => {
    const r = classifySubAgencies([
      { name: 'U.S. Customs and Border Protection', amount: 39e9 },
      { name: 'U.S. Coast Guard', amount: 13e9 },
      { name: 'Department of Homeland Security', amount: 1e6 },
    ], 'Department of Homeland Security', false, pct);
    expect(r.sub_agency_structure).toBe('breakdown');
    expect(r.sub_agencies!.map((s) => s.name)).toEqual(['U.S. Customs and Border Protection', 'U.S. Coast Guard']);
  });
  it('a failed fetch is unknown (null), never none', () => {
    expect(classifySubAgencies(null, 'Department of Veterans Affairs', false, pct)).toEqual({ sub_agencies: null, sub_agency_structure: 'unavailable' });
  });
  it('a genuinely empty successful response is none; the parent-service path is not_applicable', () => {
    expect(classifySubAgencies([], 'X', false, pct)).toEqual({ sub_agencies: [], sub_agency_structure: 'none' });
    expect(classifySubAgencies(null, 'X', true, pct)).toEqual({ sub_agencies: [], sub_agency_structure: 'not_applicable' });
  });
});

const lib = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/lib/usaspending/agency-spending-detail', async (orig) => ({
  ...(await orig<object>()),
  getAgencySpendingDetail: vi.fn(async () => lib.value),
}));

const base = {
  agency: 'Department of Veterans Affairs', toptier_code: '036', fiscal_year: 2026, total_obligated: 90_611_196_127.75,
  set_aside_breakdown: [], small_business_share: 9.4, set_aside_share: 9.4, recipient_small_business_amount: 1, recipient_small_business_share: 15.6,
  requested_identity: { command: 'VA', service: null, parent: 'Department of Veterans Affairs' },
  spending: { scope: 'REQUESTED', scope_name: 'Department of Veterans Affairs', total: 90_611_196_127.75 },
  command_spending: { status: 'NOT_APPLICABLE' }, degraded: false, trace: [],
};

describe('get_agency_spending_detail (MCP) — one fix, every surface', () => {
  it('VA: says plainly there is one self-named sub-agency; count 0, not a missing breakdown', async () => {
    lib.value = { ...base, sub_agencies: [], sub_agency_structure: 'single_self_named' };
    const { getAgencySpendingDetailTool } = await import('@/mcp/tools/agency-spending-detail');
    const r = await getAgencySpendingDetailTool({ agency: 'VA' });
    expect(r.sub_agency_structure).toBe('single_self_named');
    expect(r.sub_agency_note).toMatch(/records all of its contract awards under a single sub-agency/);
    expect(r.sub_agency_note).toMatch(/splits by contracting office/);
    expect(r._meta.sub_agency_count).toBe(0);
  });
  it('DHS: breakdown unchanged, no note', async () => {
    lib.value = { ...base, agency: 'Department of Homeland Security', sub_agencies: [{ name: 'U.S. Customs and Border Protection', amount: 39e9, pct_of_total: 53.5 }], sub_agency_structure: 'breakdown' };
    const { getAgencySpendingDetailTool } = await import('@/mcp/tools/agency-spending-detail');
    const r = await getAgencySpendingDetailTool({ agency: 'DHS' });
    expect(r.sub_agencies).toHaveLength(1);
    expect(r.sub_agency_note).toBeUndefined();
    expect(r._meta.sub_agency_count).toBe(1);
  });
  it('failed fetch: sub_agencies null, count null, note says unknown', async () => {
    lib.value = { ...base, sub_agencies: null, sub_agency_structure: 'unavailable' };
    const { getAgencySpendingDetailTool } = await import('@/mcp/tools/agency-spending-detail');
    const r = await getAgencySpendingDetailTool({ agency: 'VA' });
    expect(r.sub_agencies).toBeNull();
    expect(r._meta.sub_agency_count).toBeNull();
    expect(r.sub_agency_note).toMatch(/unknown, not none/);
  });
});

describe('the report renders the note, not "No rows"', () => {
  it('VA deep-dive shows the single-sub-agency sentence', async () => {
    const { renderMarketReportHtml } = await import('@/lib/market/market-report-html');
    const html = renderMarketReportHtml({
      subject: 'x', generated_at: '2026-11-22T00:00:00Z',
      summary: { subject: 'x', axis: 'keyword', total_market: 1, naics_count: 1, top_psc: null, buying_agencies: 0, top_contractors: 0, recompetes: 0, forecasts: 0, contacts: 0, size_tiers: null, undercount_note: null },
      sections: { market_size: null, top_agencies: [], competition: { contractors: [] }, recompetes: { contracts: [] }, forecasts: { forecasts: [] }, contacts: null, set_aside_gap: null,
        agency_detail: { ...base, sub_agencies: [], sub_agency_structure: 'single_self_named', sub_agency_note: 'Department of Veterans Affairs records all of its contract awards under a single sub-agency (Department of Veterans Affairs) in USASpending, so there is no sub-agency breakdown; its spending splits by contracting office instead.' } },
      _meta: { degraded: false, sections_grounded: 1, sections_total: 6 },
    } as never);
    const top = html.slice(html.indexOf('Top sub-agencies'), html.indexOf('Set-aside breakdown'));
    expect(top).toMatch(/records all of its contract awards under a single sub-agency/);
    expect(top).not.toMatch(/No rows available/);
  });
});
