import { describe, it, expect } from 'vitest';
import { renderMarketReportHtml } from './market-report-html';

/**
 * Reported 2026-11-22 (VA construction report): "small-business share 940%", "SDVOSB 880%" and
 * "WOSB / EDWOSB $-1,188,272". agency_detail shares are PERCENT units from getAgencySpendingDetail
 * (9.4 = 9.4%) and the page multiplied them by 100 again; amounts are net of de-obligations.
 * Values below are the real FY2026 VA payload from that run.
 */
const VA = {
  agency: 'Department of Veterans Affairs', fiscal_year: 2026, total_obligated: 90_611_196_127.75,
  small_business_share: 9.4, sub_agencies: [],
  set_aside_breakdown: [
    { label: 'Small Business (total set-aside)', amount: 536_760_447.19, pct_of_total: 0.6 },
    { label: '8(a)', amount: 4_968_126.4, pct_of_total: 0 },
    { label: 'SDVOSB', amount: 7_969_480_362.56, pct_of_total: 8.8 },
    { label: 'WOSB / EDWOSB', amount: -1_188_271.82, pct_of_total: 0 },
  ],
};

const render = (agency_detail: unknown) => renderMarketReportHtml({
  subject: 'hospital construction renovation', generated_at: '2026-11-22T00:00:00.000Z',
  sections: { market_size: null, top_agencies: [], competition: { contractors: [] }, recompetes: { contracts: [] }, forecasts: { forecasts: [] }, contacts: null, agency_detail, set_aside_gap: null },
  summary: { subject: 'hospital construction renovation', axis: 'keyword', total_market: 1_573_852_508, naics_count: 163, top_psc: null, buying_agencies: 0, top_contractors: 0, recompetes: 0, forecasts: 0, contacts: 0, size_tiers: null, undercount_note: null },
  _meta: { degraded: false, sections_grounded: 1, sections_total: 6 },
} as unknown as Parameters<typeof renderMarketReportHtml>[0]);

const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('agency deep-dive renders shares in their real units', () => {
  const t = text(render(VA));
  it('no share above 100% is ever printed', () => {
    expect(t).not.toMatch(/\b\d{3,}%/);
    expect(t).toContain('set-aside-code share 9.4%');
    expect(t).toMatch(/SDVOSB \$8\.0B 8\.8%/);
    expect(t).toMatch(/Small Business \(total set-aside\) \$536\.8M 0\.6%/);
  });
  it('a net de-obligation is shown signed and labelled, and has no share (not clamped, not zeroed)', () => {
    expect(t).toMatch(/WOSB \/ EDWOSB −\$1\.2M net n\/a \(net de-obligation\)/);
    expect(t).not.toContain('$-1');
  });
  it('the scope is stated: whole agency, all NAICS, the fiscal year, net obligations', () => {
    expect(t).toMatch(/Department of Veterans Affairs-wide, all NAICS, FY2026 — not limited to this market/);
    expect(t).toMatch(/net of de-obligations/);
    expect(t).toMatch(/not the SBA goaling figure/);
  });
  it('a missing share is unavailable, never 0%', () => {
    expect(text(render({ ...VA, small_business_share: null }))).toContain('set-aside-code share unavailable');
  });
});
