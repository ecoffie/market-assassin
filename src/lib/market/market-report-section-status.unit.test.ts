import { describe, it, expect } from 'vitest';
import { renderMarketReportHtml } from './market-report-html';

// A failed lookup is UNKNOWN, a withheld one was not attempted — neither may render as 0 / "No rows".
const render = (section_status: { name: string; status: string }[]) => renderMarketReportHtml({
  subject: 'hospital construction renovation', generated_at: '2026-11-22T00:00:00.000Z',
  summary: { subject: 'x', axis: 'keyword', total_market: 1_573_852_508, naics_count: 163, top_psc: null, buying_agencies: 0, top_contractors: 0, recompetes: 0, forecasts: 0, contacts: 0, size_tiers: null, undercount_note: null },
  sections: { market_size: null, top_agencies: [], competition: { contractors: [] }, recompetes: { contracts: [] }, forecasts: { forecasts: [] }, contacts: null, agency_detail: null, set_aside_gap: null },
  _meta: { degraded: true, sections_grounded: 1, sections_total: 6, section_status },
} as unknown as Parameters<typeof renderMarketReportHtml>[0]);
const text = (h: string) => h.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('section outcome reaches the page', () => {
  it('failed sections read Unknown, not 0 / No rows', () => {
    const t = text(render([{ name: 'top_agencies', status: 'failed' }, { name: 'competition', status: 'failed' }, { name: 'forecasts', status: 'failed' }]));
    expect(t).toMatch(/Unknown Top agencies/);
    expect(t).toMatch(/Unknown Leading contractors/);
    expect(t).toContain('Unknown — this lookup failed');
    expect(t).not.toMatch(/\b0 Top agencies/);
  });
  it('a withheld section says it was not attempted', () => {
    expect(text(render([{ name: 'recompetes', status: 'withheld_no_subject' }]))).toContain('Not attempted — no defensible market boundary');
  });
  it('a genuinely empty section still reads as none', () => {
    const t = text(render([{ name: 'top_agencies', status: 'empty' }, { name: 'competition', status: 'empty' }]));
    expect(t).toMatch(/\b0 Top agencies/);
    expect(t).toContain('No rows available for this section.');
  });
});
