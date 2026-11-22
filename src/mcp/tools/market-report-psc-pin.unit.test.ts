/**
 * P0 (Claude Local, 2026-11-22): the VA healthcare construction report led with $1.6B of NATIONAL, ALL-AGENCY
 * construction-TRADE obligations (top PSC Y1NZ utilities) because "hospital construction" fell to the generic
 * construction sector expansion. The term-of-art PSC pin now DEFINES the market: headline measured by the
 * pinned PSCs for the named agency; recompetes/forecasts bounded by the term's curated NAICS; sections ranked
 * by PSC (buildMarketFilter). PSC values are pending live USASpending verification (see PR).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => ({ codeMarketSize: [] as unknown[], expiring: [] as unknown[], forecasts: [] as unknown[] }));

vi.mock('@/lib/market/keyword-coverage', () => ({
  keywordCoverage: vi.fn(async () => ({
    keyword: 'hospital construction renovation',
    totalMarket: 1_573_852_508,
    naicsCount: 163,
    allNaics: [{ code: '236220', name: 'COMMERCIAL AND INSTITUTIONAL BUILDING CONSTRUCTION', amount: 1_046_622_144, pct: 0.665 }],
    coverageCodes: ['236220', '237310', '238160'],
    coveragePct: 0.9, topCodePct: 0.665, leadCodePct: 0.665,
    topPsc: { code: 'Y1NZ', name: 'CONSTRUCTION OF OTHER UTILITIES' }, topPscList: [],
    windowLabel: 'FY2026 (1 complete fiscal year · description match)',
    identityResolvedVia: ['electrical contractor', 'roofing'],
    pinnedPscCodes: ['Y1DA', 'Z1DA', 'Z2DA'],
  })),
  codeMarketSize: vi.fn(async (o: unknown) => {
    calls.codeMarketSize.push(o);
    return { totalMarket: 812_000_000, topPsc: { code: 'Y1DA', name: 'CONSTRUCTION OF HOSPITALS AND INFIRMARIES' }, basis: 'psc',
      windowKind: 'latest_complete_fy_live_api', windowLabel: 'FY2026 (1 complete fiscal year · all awards coded PSC Y1DA/Z1DA/Z2DA · Department of Veterans Affairs only)',
      questionKind: 'code_pinned_fy_category_total', fiscalYear: 2026 };
  }),
  marketKeywords: vi.fn((k: string) => [k]),
}));
vi.mock('@/lib/market/undercount-signal', () => ({ detectUndercount: vi.fn(async () => null) }));
vi.mock('@/lib/market/spend-query', () => ({
  resolveMarketScope: vi.fn(async () => ({ basis: 'keyword', marketFilter: { psc_codes: ['Y1DA', 'Z1DA', 'Z2DA'], mode: 'keyword_psc', rankingLabel: '' }, naicsCodes: [], coverage: null, rankedByDominantNaics: false, label: 'pinned' })),
  filtersForScope: vi.fn(() => ({ psc_codes: ['Y1DA', 'Z1DA', 'Z2DA'] })),
  buildSpendingFilters: vi.fn(() => ({})),
  fetchSpendingCategory: vi.fn(async () => []),
}));
vi.mock('@/mcp/tools/expiring-contracts', () => ({
  expiringContracts: vi.fn(async (o: unknown) => { calls.expiring.push(o); return { contracts: [], _meta: { grounded: false, degraded: false, count: 0, total: 0 } }; }),
}));
vi.mock('@/mcp/tools/forecasts', () => ({
  agencyForecasts: vi.fn(async (o: unknown) => { calls.forecasts.push(o); return { queried: {}, forecasts: [], _meta: { grounded: false, degraded: false, count: 0, total: 0 } }; }),
}));
vi.mock('@/lib/gov-contacts/contact-roster', () => ({ queryFederalContacts: vi.fn(async () => ({ contacts: [], total: 0 })) }));
vi.mock('@/mcp/tools/agency-spending-detail', () => ({ getAgencySpendingDetailTool: vi.fn(async () => ({ _meta: { grounded: false } })) }));
vi.mock('@/mcp/tools/sba-goaling', () => ({ getSbaGoalingShare: vi.fn(async () => ({ _meta: { grounded: false } })) }));
vi.mock('@/lib/market/report-store', () => ({ saveMarketReport: vi.fn(async () => null) }));

import { generateMarketReport } from './market-report';

beforeEach(() => { calls.codeMarketSize.length = 0; calls.expiring.length = 0; calls.forecasts.length = 0; });

describe('a pinned term of art defines the market (VA hospital construction)', () => {
  it('headline = pinned PSCs measured for the named agency, not the national trade description match', async () => {
    const r = await generateMarketReport({ keyword: 'hospital construction renovation', agency: 'Department of Veterans Affairs', state: 'FL' });
    expect(calls.codeMarketSize[0]).toMatchObject({ pscCodes: ['Y1DA', 'Z1DA', 'Z2DA'], agency: 'Department of Veterans Affairs', strict: true });
    expect(r.summary.total_market).toBe(812_000_000);
    expect(r.summary.top_psc).toEqual({ code: 'Y1DA', name: 'CONSTRUCTION OF HOSPITALS AND INFIRMARIES' });
    expect(r.summary.naics_count).toBeNull(); // the 163 description-match NAICS are not this market
    expect(r.summary.size_tiers).toBeNull();
    expect(r.summary.total_market_basis).toMatchObject({ source: 'psc_term_of_art', agency_scoped: true, requested_agency: 'Department of Veterans Affairs' });
  });
  it('recompetes and forecasts are bounded by the term\'s curated NAICS (236220), not the generic trade set', async () => {
    await generateMarketReport({ keyword: 'hospital construction renovation', agency: 'Department of Veterans Affairs' });
    expect(calls.expiring[0]).toMatchObject({ naicsCodes: ['236220'], agency: 'Department of Veterans Affairs' });
    expect(calls.forecasts[0]).toMatchObject({ naics: '236220', agency: 'Department of Veterans Affairs' });
  });
});
