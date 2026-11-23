/**
 * VA's Veteran-Owned (VOSB) set-aside codes are their own VA-only category (open.gsa.gov SAM set-aside table:
 * VSA "Veteran-Owned Small Business Set-Aside (specific to Department of Veterans Affairs)", VSS its sole source).
 * Live get_agency_spending_detail(VA, FY2026) had no VOSB row at all. Measured on api.usaspending.gov
 * (spending_by_category/awarding_agency, VA, A/B/C/D, FY2026): VSA $33,153,515 · VSS −$2,350,278 (net) ·
 * SDVOSBC+SDVOSBS $7,969,480,363 · total $90,611,196,128. Independently confirmed by Agent 4.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SET_ASIDE_BUCKETS, VA_VOSB_BUCKET, setAsideBucketsFor } from './agency-spending-detail';
import { setAsideNote } from '@/mcp/tools/agency-spending-detail';
import { renderMarketReportHtml } from '@/lib/market/market-report-html';

const TOTAL = 90_611_196_128;
const AMOUNTS: Record<string, number> = {
  VSA: 33_153_515, VSS: -2_350_278, SDVOSBC: 7_000_000_000, SDVOSBS: 969_480_363,
  SBA: 500_000_000, SBP: 0, '8A': 100_000_000, '8AN': 0, WOSB: 50_000_000, WOSBSS: 0, EDWOSB: 0, EDWOSBSS: 0, HZC: 10_000_000, HZS: 0,
};

const agencies = vi.hoisted(() => ({
  list: [
    { name: 'Department of Veterans Affairs', toptierCode: '036', abbreviation: 'VA' },
    { name: 'Department of Homeland Security', toptierCode: '070', abbreviation: 'DHS' },
  ],
}));
vi.mock('@/lib/utils/agency-list-builder', () => ({ fetchAllUSASpendingAgencies: vi.fn(async () => agencies.list) }));

const queried: string[][] = [];
function stubUsaspending(agencyName: string) {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { filters: { set_aside_type_codes?: string[] } };
    const codes = body.filters.set_aside_type_codes;
    if (codes) queried.push(codes);
    const amount = codes ? codes.reduce((s, c) => s + (AMOUNTS[c] ?? 0), 0) : TOTAL;
    return new Response(JSON.stringify({ results: [{ name: agencyName, amount }] }), { status: 200 });
  }));
}

describe('bucket selection', () => {
  it('VOSB (VA only) is VSA/VSS, distinct from SDVOSB, and only for VA', () => {
    expect(VA_VOSB_BUCKET).toEqual({ label: 'VOSB (VA only)', codes: ['VSA', 'VSS'] });
    expect(SET_ASIDE_BUCKETS.find((b) => b.label === 'SDVOSB')!.codes).toEqual(['SDVOSBC', 'SDVOSBS']);
    expect(setAsideBucketsFor('036')).toContainEqual(VA_VOSB_BUCKET);
    expect(setAsideBucketsFor('070')).not.toContainEqual(VA_VOSB_BUCKET);
    expect(setAsideBucketsFor('097', 'Department of the Navy')).not.toContainEqual(VA_VOSB_BUCKET);
    const all = setAsideBucketsFor('036').flatMap((b) => b.codes);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('getAgencySpendingDetail', () => {
  afterEach(() => { vi.unstubAllGlobals(); queried.length = 0; });

  it('VA: VOSB row present at the signed net; SDVOSB unchanged; set_aside_share includes VOSB', async () => {
    stubUsaspending('Department of Veterans Affairs');
    const { getAgencySpendingDetail } = await import('./agency-spending-detail');
    const r = await getAgencySpendingDetail({ agency: 'Department of Veterans Affairs', fiscalYear: 2026 });
    const vosb = r.set_aside_breakdown.find((b) => b.label === 'VOSB (VA only)')!;
    expect(vosb.amount).toBe(30_803_237); // VSA + VSS, net — never the gross 35.5M, never clamped
    expect(vosb.pct_of_total).toBe(0.03); // two decimals for a small nonzero share, not "0.0"
    const sd = r.set_aside_breakdown.find((b) => b.label === 'SDVOSB')!;
    expect(sd.amount).toBe(7_969_480_363);
    expect(sd.codes).toEqual(['SDVOSBC', 'SDVOSBS']);
    const sum = r.set_aside_breakdown.reduce((s, b) => s + (b.amount ?? 0), 0);
    expect(r.set_aside_share).toBe(Math.round((sum / TOTAL) * 1000) / 10);
    const withoutVosb = sum - 30_803_237;
    expect(sum).toBeGreaterThan(withoutVosb);
  });

  it('DHS: no VOSB row (omitted, not $0) and VSA/VSS are never queried', async () => {
    stubUsaspending('Department of Homeland Security');
    const { getAgencySpendingDetail } = await import('./agency-spending-detail');
    const r = await getAgencySpendingDetail({ agency: 'Department of Homeland Security', fiscalYear: 2026 });
    expect(r.set_aside_breakdown.some((b) => /VOSB \(VA only\)/.test(b.label))).toBe(false);
    expect(queried.flat()).not.toContain('VSA');
    expect(r.set_aside_breakdown.find((b) => b.label === 'SDVOSB')!.amount).toBe(7_969_480_363);
  });

  it('VA: a failed VOSB lookup is unknown — row null and set_aside_share null', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const codes = (JSON.parse(init.body) as { filters: { set_aside_type_codes?: string[] } }).filters.set_aside_type_codes;
      if (codes?.includes('VSA')) return new Response('upstream error', { status: 500 });
      const amount = codes ? codes.reduce((s, c) => s + (AMOUNTS[c] ?? 0), 0) : TOTAL;
      return new Response(JSON.stringify({ results: [{ name: 'Department of Veterans Affairs', amount }] }), { status: 200 });
    }));
    const { getAgencySpendingDetail } = await import('./agency-spending-detail');
    const r = await getAgencySpendingDetail({ agency: 'Department of Veterans Affairs', fiscalYear: 2026 });
    expect(r.set_aside_breakdown.find((b) => b.label === 'VOSB (VA only)')!.amount).toBeNull();
    expect(r.set_aside_share).toBeNull();
  });
});

describe('set_aside_note (MCP) and the report render', () => {
  const vaRows = [
    { label: 'SDVOSB', codes: ['SDVOSBC', 'SDVOSBS'], amount: 7_969_480_363, pct_of_total: 8.8 },
    { label: 'VOSB (VA only)', codes: ['VSA', 'VSS'], amount: 30_803_237, pct_of_total: 0.03 },
  ];

  it('VA: the factual sentence from the rows', () => {
    expect(setAsideNote({ fiscal_year: 2026, set_aside_breakdown: vaRows })).toBe(
      "VOSB set-asides are a small share of VA contract dollars ($30.8M net, 0.03% in FY2026); VA's veteran set-aside dollars go mostly to SDVOSB ($7.97B, 8.8%).",
    );
  });
  it('a negative net stays negative; comparatives only when the data makes them true', () => {
    const neg = setAsideNote({ fiscal_year: 2025, set_aside_breakdown: [vaRows[0], { ...vaRows[1], amount: -2_350_278, pct_of_total: -0.01 }] });
    expect(neg).toContain('−$2.4M net');
    const big = setAsideNote({ fiscal_year: 2026, set_aside_breakdown: [{ ...vaRows[0], amount: 1e6, pct_of_total: 0.01 }, { ...vaRows[1], amount: 5e9, pct_of_total: 5.5 }] });
    expect(big).not.toMatch(/small share|mostly/);
    expect(big).toBe('VOSB (VA only) set-asides: $5.00B net, 5.5% in FY2026. SDVOSB: $1.0M, 0.01%.');
  });
  it('no VOSB row (any other agency) → no note; a failed VOSB lookup → unknown, not $0', () => {
    expect(setAsideNote({ fiscal_year: 2026, set_aside_breakdown: [vaRows[0]] })).toBeNull();
    expect(setAsideNote({ fiscal_year: 2026, set_aside_breakdown: [vaRows[0], { ...vaRows[1], amount: null, pct_of_total: null }] }))
      .toMatch(/unknown, not \$0/);
  });

  it('report: VOSB row renders with its net amount and share, and the note sits under the table', () => {
    const note = setAsideNote({ fiscal_year: 2026, set_aside_breakdown: vaRows })!;
    const html = renderMarketReportHtml({
      subject: 'VA construction', generated_at: '2026-11-22T00:00:00.000Z',
      sections: {
        market_size: null, top_agencies: [], competition: { contractors: [] }, recompetes: { contracts: [] }, forecasts: { forecasts: [] },
        contacts: null, set_aside_gap: null,
        agency_detail: { agency: 'Department of Veterans Affairs', fiscal_year: 2026, total_obligated: TOTAL, small_business_share: 9.4, sub_agencies: [], set_aside_breakdown: vaRows, set_aside_note: note },
      },
      summary: { subject: 'VA construction', axis: 'keyword', total_market: 1, naics_count: 1, top_psc: null, buying_agencies: 0, top_contractors: 0, recompetes: 0, forecasts: 0, contacts: 0, size_tiers: null, undercount_note: null },
      _meta: { degraded: false, sections_grounded: 1, sections_total: 6 },
    } as unknown as Parameters<typeof renderMarketReportHtml>[0]);
    expect(html).toContain('VOSB (VA only)');
    expect(html).toContain('$30.8M');
    expect(html).toMatch(/VOSB \(VA only\)<\/td><td>\$30\.8M<\/td><td><0\.1%<\/td>/); // not "0.0%" for a real nonzero share
    expect(html).toContain('go mostly to SDVOSB ($7.97B, 8.8%)');
  });
});
