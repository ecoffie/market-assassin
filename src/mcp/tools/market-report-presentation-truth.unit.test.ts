/**
 * POTETO — Market Report Presentation Truth (2026-09-22).
 *
 * Drives the REAL generateMarketReport with its data sources mocked into the shape
 * production returned for "building construction and renovation" on 2026-09-22, so
 * each assertion fails if its fix is reverted. What production showed before:
 *
 *   - competition + forecasts `status: "ok"` with ZERO rows;
 *   - `sections_grounded: 2/7` beside FOUR `ok` statuses (two definitions);
 *   - KPI "15 recompetes" above a table that rendered 12;
 *   - a forecast listing ingested as `7799` and `GW-L:7799` shown twice;
 *   - a forecast Set-aside cell reading "true";
 *   - `estimated_recompete_date` a year before PoP end, already in the past;
 *   - a literal-phrase tier of `$0` beside a `$919.7M` headline, unexplained.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  spendingFails: false,
  forecastsDegraded: false,
}));

vi.mock('@/lib/market/keyword-coverage', () => ({
  keywordCoverage: vi.fn(async () => ({
    keyword: 'building construction and renovation',
    totalMarket: 919_694_868.54,
    naicsCount: 187,
    allNaics: [
      { code: '236220', name: 'COMMERCIAL AND INSTITUTIONAL BUILDING CONSTRUCTION', amount: 292_962_203.64, pct: 0.3185 },
      { code: '237310', name: 'HIGHWAY, STREET, AND BRIDGE CONSTRUCTION', amount: 163_600_000, pct: 0.178 },
    ],
    coverageCodes: ['236220', '237310'],
    coveragePct: 0.9,
    topCodePct: 0.3185,
    leadCodePct: 0.3185,
    topPsc: { code: 'Y1LB', name: 'CONSTRUCTION OF HIGHWAYS' },
    topPscList: [],
    windowLabel: 'FY2025 (1 complete fiscal year · description match)',
    identityResolvedVia: ['roofing', 'masonry', 'concrete'],
  })),
  codeMarketSize: vi.fn(async () => null),
  // No curated synonyms — the sections are ranked on the literal phrase.
  marketKeywords: vi.fn((k: string) => [k]),
}));
vi.mock('@/lib/market/undercount-signal', () => ({ detectUndercount: vi.fn(async () => null) }));
vi.mock('@/lib/market/spend-query', () => ({
  resolveMarketScope: vi.fn(async () => ({
    basis: 'keyword',
    marketFilter: { keywords: ['building construction and renovation'], mode: 'keyword', rankingLabel: '' },
    naicsCodes: [],
    coverage: null,
    rankedByDominantNaics: false,
    label: 'keyword "building construction and renovation"',
  })),
  filtersForScope: vi.fn(() => ({ keywords: ['building construction and renovation'] })),
  buildSpendingFilters: vi.fn(() => ({})),
  // The literal phrase genuinely returns no rows — unless we inject a failure.
  fetchSpendingCategory: vi.fn(async (_c: string, _f: unknown, _l: number, _t: string, opts?: { strict?: boolean }) => {
    if (state.spendingFails) {
      if (opts?.strict) throw new Error('HTTP 500');
      return [];
    }
    return [];
  }),
}));

const REC = (id: string, piid: string, end: string) => ({
  contract_id: id, piid, incumbent_name: 'HERITAGE-M2C1 JOINT VENTURE', awarding_agency: 'Department of Defense',
  awarding_sub_agency: 'Department of the Air Force', naics_code: '236220', description: `PROJECT ${piid}`,
  potential_total_value: 500_000, period_of_performance_current_end: end,
  estimated_recompete_date: '2025-09-23', lead_time_months: 1, recompete_likelihood: 'medium',
});
vi.mock('@/mcp/tools/expiring-contracts', () => ({
  expiringContracts: vi.fn(async () => ({
    contracts: [
      REC('A', 'FA500425F0093', '2026-09-23'),
      REC('B', 'FA500425F0094', '2026-09-23'),
      REC('B', 'FA500425F0094', '2026-09-23'), // same contract_id twice — a guard, not a merge
      ...Array.from({ length: 13 }, (_, i) => REC(`C${i}`, `W9${i}`, '2026-10-01')),
    ],
    _meta: { grounded: true, degraded: false, count: 16, total: 1234 },
  })),
}));

const FC = (over: Record<string, unknown>) => ({
  id: String(Math.random()), external_id: null, title: 'T', description: null, agency: 'DOI', department: null,
  office: null, naics_code: '236220', naics_description: null, psc_code: null, fiscal_year: 'FY2026', quarter: null,
  award_date: null, value_min: 250_000, value_max: 499_000, value_range: '$250K - $499K', set_aside_type: null,
  contract_type: null, incumbent_name: null, pop_state: 'MA', status: 'forecasted', ...over,
});
vi.mock('@/mcp/tools/forecasts', () => ({
  agencyForecasts: vi.fn(async () => state.forecastsDegraded
    ? { queried: {}, forecasts: [], _meta: { grounded: false, degraded: true, count: 0, total: 0 } }
    : {
        queried: {},
        forecasts: [
          FC({ title: 'BOST Rehabilitate the Boston Light Boathouse', external_id: '7799', set_aside_type: 'Small Business' }),
          FC({ title: 'BOST Rehabilitate the Boston Light Boathouse', external_id: 'GW-L:7799', set_aside_type: 'Small Business' }),
          FC({ title: 'Refurbish CDC', agency: 'DHS', set_aside_type: 'True', value_min: 2e6, value_max: 5e6 }),
          FC({ title: 'OPF-L Delivery Order #3', agency: 'NAVY', incumbent_name: 'Aerovironment, Inc' }),
          FC({ title: 'OPF-L Delivery Order #3', agency: 'NAVY', incumbent_name: 'Anduril Industries' }),
        ],
        _meta: { grounded: true, degraded: false, count: 5, total: 677 },
      }),
}));
vi.mock('@/lib/gov-contacts/contact-roster', () => ({ queryFederalContacts: vi.fn(async () => ({ contacts: [], total: 0 })) }));
vi.mock('@/mcp/tools/agency-spending-detail', () => ({ getAgencySpendingDetailTool: vi.fn() }));
vi.mock('@/mcp/tools/sba-goaling', () => ({ getSbaGoalingShare: vi.fn() }));
vi.mock('@/lib/market/report-store', () => ({ saveMarketReport: vi.fn(async () => null) }));

import { generateMarketReport } from './market-report';

const statusOf = (r: Awaited<ReturnType<typeof generateMarketReport>>, name: string) =>
  r._meta.section_status?.find((x) => x.name === name)?.status;

/** Rows in the <tbody> of the section whose <h2> is `title`. */
function renderedRows(html: string, title: string): number {
  const start = html.indexOf(`<h2>${title}</h2>`);
  if (start < 0) return -1;
  const end = html.indexOf('</section>', start);
  const body = html.slice(start, end);
  const tbody = body.match(/<tbody>([\s\S]*?)<\/tbody>/);
  return tbody ? (tbody[1].match(/<tr>/g) || []).length : 0;
}

beforeEach(() => {
  state.spendingFails = false;
  state.forecastsDegraded = false;
});

describe('PRESENT — section status and grounding agree', () => {
  it('a zero-row section is `empty`, never `ok`', async () => {
    const r = await generateMarketReport({ keyword: 'building construction and renovation' });
    expect(r.sections.competition.contractors).toHaveLength(0);
    expect(statusOf(r, 'competition')).toBe('empty');
    expect(statusOf(r, 'top_agencies')).toBe('empty');
    expect(statusOf(r, 'forecasts')).toBe('ok');
  });

  it('sections_grounded is exactly the number of `ok` sections', async () => {
    const r = await generateMarketReport({ keyword: 'building construction and renovation' });
    const ok = (r._meta.section_status ?? []).filter((s) => s.status === 'ok').length;
    expect(r._meta.sections_grounded).toBe(ok);
    expect(r._meta.sections_total).toBe(r._meta.section_status?.length);
  });

  it('a USAspending failure is `failed` (unknown), not `empty`', async () => {
    state.spendingFails = true;
    const r = await generateMarketReport({ keyword: 'building construction and renovation' });
    expect(statusOf(r, 'competition')).toBe('failed');
    expect(statusOf(r, 'top_agencies')).toBe('failed');
    expect(r._meta.sections_failed).toEqual(expect.arrayContaining(['competition', 'top_agencies']));
    // An unknown literal reading is not a $0 reading.
    expect(r.summary.size_tiers?.[0].amount).toBeNull();
  });

  it('a tool that reports `_meta.degraded` is `failed`, not an established zero', async () => {
    state.forecastsDegraded = true;
    const r = await generateMarketReport({ keyword: 'building construction and renovation' });
    expect(statusOf(r, 'forecasts')).toBe('failed');
  });
});

describe('EXPLAIN — the $0 literal reading is not the market', () => {
  it('the $0 tier says what $0 means and names the words the headline was measured through', async () => {
    const r = await generateMarketReport({ keyword: 'building construction and renovation' });
    const named = r.summary.size_tiers?.[0];
    expect(named?.amount).toBe(0);
    expect(named?.note).toMatch(/NOT that the market is \$0/);
    expect(named?.note).toMatch(/roofing, masonry, concrete/);
    const html = r.deliverable.html;
    expect(html).toContain('How this market was measured');
    expect(html).toContain('Total market (headline)');
    expect(html).toContain('No contract award text contains the exact phrase');
  });
});

describe('COUNT — KPIs reconcile with the rows shown', () => {
  it('every counted row is rendered, and the population is labelled as larger', async () => {
    const r = await generateMarketReport({ keyword: 'building construction and renovation' });
    const html = r.deliverable.html;
    expect(renderedRows(html, 'Recompetes on the horizon')).toBe(r.summary.recompetes);
    expect(renderedRows(html, 'Upcoming forecasts')).toBe(r.summary.forecasts);
    expect(r.summary.recompetes_total).toBe(1234);
    expect(html).toContain(`Showing ${r.summary.recompetes} of 1,234 found`);
    expect(html).toContain(`${r.summary.recompetes} shown below`);
  });
});

describe('LIST — one row per customer-visible record', () => {
  it('drops a repeated contract_id and a cross-listed forecast, keeps same-title different procurements', async () => {
    const r = await generateMarketReport({ keyword: 'building construction and renovation' });
    const ids = r.sections.recompetes.contracts.map((c) => (c as { contract_id: string }).contract_id);
    expect(new Set(ids).size).toBe(ids.length);
    const titles = r.sections.forecasts.forecasts.map((f) => (f as { title: string }).title);
    expect(titles.filter((t) => t.includes('Boston Light Boathouse'))).toHaveLength(1);
    expect(titles.filter((t) => t.includes('OPF-L'))).toHaveLength(2);
    expect(r.summary.forecasts_duplicates_removed).toBe(1);
    // Same incumbent, two contracts: the contract number is what tells them apart.
    expect(r.deliverable.html).toContain('FA500425F0093');
    expect(r.deliverable.html).toContain('FA500425F0094');
    expect(r.deliverable.html).toContain('Incumbent: Anduril Industries');
  });
});

describe('DATE — the capture date is labelled for what it is', () => {
  it('no row carries estimated_recompete_date; capture_start_date is flagged as passed', async () => {
    const r = await generateMarketReport({ keyword: 'building construction and renovation' });
    for (const c of r.sections.recompetes.contracts as Record<string, unknown>[]) {
      expect(c).not.toHaveProperty('estimated_recompete_date');
      expect(c.capture_start_date).toBe('2025-09-23');
      expect(c.capture_start_passed).toBe(true);
    }
  });
});

describe('PRESENT — forecast set-aside is a category or "Not stated"', () => {
  it('a boolean source value never renders as a set-aside category', async () => {
    const r = await generateMarketReport({ keyword: 'building construction and renovation' });
    const cdc = (r.sections.forecasts.forecasts as Record<string, unknown>[]).find((f) => f.title === 'Refurbish CDC');
    expect(cdc?.set_aside_type).toBeNull();
    expect(cdc?.set_aside_source_value).toBe('True');
    expect(r.deliverable.html).not.toMatch(/<td>(true|True)<\/td>/);
    expect(r.deliverable.html).toContain('Not stated');
  });
});
