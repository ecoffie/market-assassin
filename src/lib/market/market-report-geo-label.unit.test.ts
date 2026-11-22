import { describe, it, expect } from 'vitest';
import { renderMarketReportHtml } from './market-report-html';

// VA construction report 2026-11-22: a national, all-agency $1.6B headline sat beside VA's $90.6B with nothing
// saying the headline ignored both the requested state (FL) and the requested agency (VA).
const render = (basis: Record<string, unknown>) => renderMarketReportHtml({
  subject: 'hospital construction renovation', generated_at: '2026-11-22T00:00:00.000Z',
  summary: { subject: 'x', axis: 'keyword', total_market: 1_573_852_508, naics_count: 163, top_psc: null, buying_agencies: 0, top_contractors: 0, recompetes: 0, forecasts: 0, contacts: 0, size_tiers: null, undercount_note: null,
    total_market_basis: { source: 'keyword_description_match', window: 'FY2026 (1 complete fiscal year · description match)', state_scoped: false, agency_scoped: false, identity_resolved_via: null, ...basis } },
  sections: { market_size: null, top_agencies: [], competition: { contractors: [] }, recompetes: { contracts: [] }, forecasts: { forecasts: [] }, contacts: null, agency_detail: null, set_aside_gap: null },
  _meta: { degraded: false, sections_grounded: 1, sections_total: 6 },
} as unknown as Parameters<typeof renderMarketReportHtml>[0]);
const text = (h: string) => h.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('the headline says which geography and buyers it covers', () => {
  it('state + agency requested → national, all agencies, with both notes', () => {
    const t = text(render({ requested_state: 'FL', requested_agency: 'Department of Veterans Affairs' }));
    expect(t).toContain('Total market (national, all agencies)');
    expect(t).toMatch(/is the national figure for this market/);
    expect(t).toMatch(/covers all federal buyers , not only Department of Veterans Affairs/);
    expect(t).toMatch(/neither figure is Department of Veterans Affairs's spend in this market/);
  });
  it('agency only → all agencies', () => {
    const t = text(render({ requested_state: null, requested_agency: 'Department of Veterans Affairs' }));
    expect(t).toContain('Total market (all agencies)');
    expect(t).not.toMatch(/is the national figure/);
  });
  it('neither requested → plain label, no notes', () => {
    const t = text(render({ requested_state: null, requested_agency: null }));
    expect(t).toMatch(/Total market\b(?! \()/);
    expect(t).not.toMatch(/all federal buyers/);
  });
});
