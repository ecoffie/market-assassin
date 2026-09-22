/**
 * A withheld report must withhold the ARTIFACT, not just the link — proven by
 * EXECUTION, not by grepping the source.
 *
 * The gate withheld `deliverable.url` and persistence while still RENDERING and
 * returning the branded HTML. The HTML is the thing a customer forwards to their
 * client, so withholding the link and handing over the page is not a refusal.
 *
 * These drive the real `generateMarketReport` with its data sources stubbed, and
 * assert on the RETURNED VALUE plus a spy on the persistence boundary. A rename or
 * an "equivalent" refactor cannot satisfy them without preserving the behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const saveMarketReport = vi.fn(async () => 'stub-report-id');

vi.mock('@/lib/market/report-store', () => ({ saveMarketReport }));

// Data sources — each test sets these to model a grounded or an empty market.
const keywordCoverage = vi.fn();
const codeMarketSize = vi.fn();
const resolveMarketScope = vi.fn();
const fetchSpendingCategory = vi.fn();
const expiringContracts = vi.fn();
const agencyForecasts = vi.fn();
const queryFederalContacts = vi.fn();

vi.mock('@/lib/market/keyword-coverage', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  keywordCoverage: (...a: unknown[]) => keywordCoverage(...a),
  codeMarketSize: (...a: unknown[]) => codeMarketSize(...a),
}));
vi.mock('@/lib/market/spend-query', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolveMarketScope: (...a: unknown[]) => resolveMarketScope(...a),
  fetchSpendingCategory: (...a: unknown[]) => fetchSpendingCategory(...a),
}));
vi.mock('@/mcp/tools/expiring-contracts', () => ({ expiringContracts: (...a: unknown[]) => expiringContracts(...a) }));
vi.mock('@/mcp/tools/forecasts', () => ({ agencyForecasts: (...a: unknown[]) => agencyForecasts(...a) }));
vi.mock('@/lib/gov-contacts/contact-roster', () => ({ queryFederalContacts: (...a: unknown[]) => queryFederalContacts(...a) }));

const { generateMarketReport } = await import('@/mcp/tools/market-report');

const KEYWORD_SCOPE = {
  basis: 'keyword' as const,
  marketFilter: { keywords: ['widgets'], mode: 'keyword' as const, rankingLabel: 'keyword "widgets"' },
  naicsCodes: [] as string[],
  coverage: null,
  rankedByDominantNaics: false,
  label: 'keyword "widgets"',
};

/** A market where NOTHING was measured — the withheld case. */
function stubEmptyMarket() {
  keywordCoverage.mockResolvedValue(null);
  codeMarketSize.mockResolvedValue(null);
  resolveMarketScope.mockResolvedValue(KEYWORD_SCOPE);
  fetchSpendingCategory.mockResolvedValue([]);
  expiringContracts.mockResolvedValue({ contracts: [], _meta: { total: 0 } });
  agencyForecasts.mockResolvedValue({ forecasts: [] });
  queryFederalContacts.mockResolvedValue({ contacts: [] });
}

/** A market with a real total, real buyers and real competitors — the publish case. */
function stubGroundedMarket() {
  keywordCoverage.mockResolvedValue({
    keyword: 'widgets', totalMarket: 250_000_000, naicsCount: 4, coveragePct: 0.9,
    topCodePct: 0.4, leadCodePct: 0.4, allNaics: [{ code: '332999', name: 'Widgets', amount: 100_000_000 }],
    coverageCodes: ['332999'], topPscList: [], pinnedPscCodes: [],
  });
  codeMarketSize.mockResolvedValue({ totalMarket: 250_000_000 });
  resolveMarketScope.mockResolvedValue(KEYWORD_SCOPE);
  fetchSpendingCategory.mockResolvedValue([
    { name: 'DEPT OF THE NAVY', amount: 120_000_000, count: 0, rank: 1 },
    { name: 'DEFENSE LOGISTICS AGENCY', amount: 80_000_000, count: 0, rank: 2 },
  ]);
  expiringContracts.mockResolvedValue({ contracts: [], _meta: { total: 0 } });
  agencyForecasts.mockResolvedValue({ forecasts: [] });
  queryFederalContacts.mockResolvedValue({ contacts: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a REFUSED report yields no client-facing artifact', () => {
  it('returns empty HTML, no URL, and never calls persistence', async () => {
    stubEmptyMarket();
    const r = await generateMarketReport({ keyword: 'widgets', userEmail: 'buyer@example.com' });

    expect(r._meta.deliverable_withheld).toBe(true);
    expect(r.deliverable.html).toBe('');
    expect(r.deliverable.url).toBeNull();
    expect(r.deliverable.report_id).toBeNull();
    expect(r._meta.saved).toBe(false);
    // The persistence boundary is never reached — not merely "returned no id".
    expect(saveMarketReport).not.toHaveBeenCalled();
  });

  it('hands back a diagnostic instead of a page, so the caller keeps what it paid for', async () => {
    stubEmptyMarket();
    const r = await generateMarketReport({ keyword: 'widgets', userEmail: 'buyer@example.com' });
    expect(r._meta.deliverable_withheld_reason).toBeTruthy();
    expect(r.sections).toBeTruthy();       // structured data still returned
    expect(r.deliverable.html).toHaveLength(0);
  });

  it('withholds the artifact even with NO verified caller (nothing to persist either way)', async () => {
    stubEmptyMarket();
    const r = await generateMarketReport({ keyword: 'widgets' });
    expect(r.deliverable.html).toBe('');
    expect(r.deliverable.url).toBeNull();
    expect(saveMarketReport).not.toHaveBeenCalled();
  });
});

describe('a PUBLISHED report still produces the artifact', () => {
  it('renders HTML, persists once, and returns the hosted URL', async () => {
    stubGroundedMarket();
    const r = await generateMarketReport({ keyword: 'widgets', userEmail: 'buyer@example.com' });

    expect(r._meta.deliverable_withheld).toBe(false);
    expect(r.deliverable.html.length).toBeGreaterThan(0);
    expect(r.deliverable.html).toContain('<!doctype html>');
    expect(saveMarketReport).toHaveBeenCalledTimes(1);
    expect(r.deliverable.report_id).toBe('stub-report-id');
    expect(r.deliverable.url).toContain('/reports/stub-report-id');
    expect(r._meta.saved).toBe(true);
  });

  it('does not persist without a verified caller, but still renders the page', async () => {
    stubGroundedMarket();
    const r = await generateMarketReport({ keyword: 'widgets' });
    expect(r.deliverable.html.length).toBeGreaterThan(0);
    expect(saveMarketReport).not.toHaveBeenCalled();
    expect(r.deliverable.url).toBeNull();
  });
});

describe('generated client HTML carries no engineering notes', () => {
  it('emits no comments and leaks no implementation detail, while keeping provenance', async () => {
    stubGroundedMarket();
    const { deliverable } = await generateMarketReport({ keyword: 'widgets' });
    const html = deliverable.html;

    expect(html.match(/<!--[\s\S]*?-->/g)).toBeNull();
    expect(html.match(/\/\*[\s\S]*?\*\//g)).toBeNull();
    for (const leak of [/chromium/i, /puppeteer/i, /lambda/i, /\bEric\b/, /TODO/, /FIXME/]) {
      expect(html).not.toMatch(leak);
    }
    expect(html).toContain('Powered by');
    expect(html).toMatch(/USASpending\/SAM/);
    expect(html).toMatch(/not budget authority/);
  });
});
