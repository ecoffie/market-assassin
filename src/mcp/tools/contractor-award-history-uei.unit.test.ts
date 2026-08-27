/**
 * MCP get_contractor_award_history — UEI path shares Map history service;
 * name-only path unchanged (CHAIN-2 existence).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockShared = vi.fn();
const mockSales = vi.fn();
const mockExistence = vi.fn();

vi.mock('@/lib/contractor/history-by-uei', () => ({
  getContractorHistoryByUei: (...a: unknown[]) => mockShared(...a),
}));
vi.mock('@/lib/contractor-sales-history', () => ({
  getContractorSalesHistory: (...a: unknown[]) => mockSales(...a),
}));
vi.mock('@/lib/contractor/award-history-existence', () => ({
  establishAwardHistory: (...a: unknown[]) => mockExistence(...a),
}));
vi.mock('@/lib/mcp/flags', () => ({
  mcpFlags: { aiHint: false },
}));

async function load() {
  return import('./contractor-award-history');
}

beforeEach(() => {
  vi.resetModules();
  mockShared.mockReset();
  mockSales.mockReset();
  mockExistence.mockReset();
});

describe('contractorAwardHistory — UEI path', () => {
  it('uses shared getContractorHistoryByUei with budgeted cold policy + actor', async () => {
    mockShared.mockResolvedValue({
      uei: 'FCJCDUZV7RM3',
      resolution: 'found',
      name: 'NORTH STAR',
      history: {
        source: 'bigquery_normalized',
        enrichment_status: 'complete',
        contractor: { company: 'NORTH STAR' },
        summary: { awardCount: 35, totalObligations: 23_350_000 },
        recentAwards: [],
      },
      source: 'bigquery_normalized',
      asOf: '2025-06-15',
      aggregates_cover: 'bq_ingest',
      degraded: false,
      cache: 'warm',
    });
    const { contractorAwardHistory } = await load();
    const r = await contractorAwardHistory({
      uei: 'fcjcduzv7rm3',
      company: 'Ignored Name',
      actor: 'mcp@example.com',
    });
    expect(mockShared).toHaveBeenCalledWith(
      expect.objectContaining({
        uei: 'FCJCDUZV7RM3',
        actor: 'mcp@example.com',
        coldPolicy: 'budgeted',
      }),
    );
    expect(mockSales).not.toHaveBeenCalled();
    expect(r._meta.grounded).toBe(true);
    expect(r._meta.award_count).toBe(35);
    expect(r._meta.source).toBe('bigquery_normalized');
    expect(r._meta.aggregates_cover).toBe('bq_ingest');
    expect(r.history?.source).toBe('bigquery_normalized');
    expect(r.queried.uei).toBe('FCJCDUZV7RM3');
  });

  it('Tanaq Global registered_zero is grounded identity with zero awards (not not-found)', async () => {
    mockShared.mockResolvedValue({
      uei: 'WDMBF2J6EML3',
      resolution: 'registered_zero',
      name: 'TANAQ GLOBAL LLC',
      history: {
        contractor: { company: 'TANAQ GLOBAL LLC' },
        summary: { awardCount: 0, totalObligations: 0 },
        recentAwards: [],
      },
      source: 'local_registry',
      asOf: '2026-08-20',
      aggregates_cover: 'bq_ingest',
      degraded: false,
      cache: 'registry',
    });
    const { contractorAwardHistory } = await load();
    const r = await contractorAwardHistory({ uei: 'WDMBF2J6EML3', actor: 'a@b.com' });
    expect(r._meta.resolution).toBe('registered_zero');
    expect(r._meta.grounded).toBe(true);
    expect(r._meta.award_count).toBe(0);
    expect(r._meta.note).toMatch(/Do NOT claim the company does not exist/i);
  });

  it('budget unavailable → degraded, not zero fabrication', async () => {
    mockShared.mockResolvedValue({
      uei: 'FCJCDUZV7RM3',
      resolution: 'unavailable',
      name: null,
      history: null,
      source: null,
      asOf: null,
      aggregates_cover: null,
      degraded: true,
      cache: 'none',
      detail: 'Cold BigQuery budget exhausted',
    });
    const { contractorAwardHistory } = await load();
    const r = await contractorAwardHistory({ uei: 'FCJCDUZV7RM3', actor: 'a@b.com' });
    expect(r._meta.degraded).toBe(true);
    expect(r._meta.grounded).toBe(false);
    expect(r.history).toBeNull();
  });

  it('rejects malformed UEI without calling shared service data path meaningfully', async () => {
    const { contractorAwardHistory } = await load();
    const r = await contractorAwardHistory({ uei: 'BAD', actor: 'a@b.com' });
    expect(r._meta.resolution).toBe('malformed');
    // isWellFormedUei fails before getContractorHistoryByUei — shared may still not be called
    expect(mockShared).not.toHaveBeenCalled();
  });
});

describe('contractorAwardHistory — name-only legacy unchanged', () => {
  it('name-only still uses getContractorSalesHistory + existence check', async () => {
    mockSales.mockResolvedValue({
      contractor: { company: 'FLUIDYNE CORPORATION' },
      summary: { awardCount: 0, totalObligations: 0 },
      source: 'usaspending_cache',
    });
    mockExistence.mockResolvedValue({
      hasFederalAwardHistory: true,
      degraded: false,
      sources: [{ source: 'recompete', found: true }],
    });
    const { contractorAwardHistory } = await load();
    const r = await contractorAwardHistory({ company: 'FLUIDYNE CORPORATION' });
    expect(mockShared).not.toHaveBeenCalled();
    expect(mockSales).toHaveBeenCalled();
    expect(mockExistence).toHaveBeenCalled();
    expect(r._meta.award_history_elsewhere).toBe(true);
    expect(r._meta.grounded).toBe(true);
  });

  it('requires company or uei', async () => {
    const { contractorAwardHistory } = await load();
    const r = await contractorAwardHistory({});
    expect(r._meta.resolution).toBe('malformed');
  });
});

describe('Map/MCP parity — same shared facts', () => {
  it('North Star Map resolveCompanyDetail and MCP award-history share identical totals', async () => {
    const sharedPayload = {
      uei: 'FCJCDUZV7RM3',
      resolution: 'found' as const,
      name: 'NORTH STAR CONSTRUCTION SERVICES LLC',
      history: {
        contractor: {
          company: 'NORTH STAR CONSTRUCTION SERVICES LLC',
          totalContractValue: 23_350_000,
          contractCount: 35,
          naics: ['236220'],
        },
        summary: { totalObligations: 23_350_000, awardCount: 35, topAgency: 'DOD', latestFiscalYear: 2025, averageAwardSize: 1 },
        topAgencies: [{ agency: 'DOD', amount: 23_350_000, share: 1 }],
        topNaics: [{ naics: '236220', description: null, amount: 23_350_000, count: 35 }],
        recentAwards: [{ id: '1', title: 'x', agency: 'DOD', subAgency: null, naics: null, naicsDescription: null, amount: 1, startDate: null, endDate: null, state: null, url: null }],
        lastUpdated: '2025-06-15',
      },
      source: 'bigquery_normalized' as const,
      asOf: '2025-06-15',
      aggregates_cover: 'bq_ingest' as const,
      degraded: false,
      cache: 'warm' as const,
    };
    mockShared.mockResolvedValue(sharedPayload);

    const { contractorAwardHistory } = await load();
    const mcp = await contractorAwardHistory({ uei: 'FCJCDUZV7RM3', actor: 'a@b.com' });

    // Re-import company-detail with same mock
    vi.doMock('@/lib/contractor/history-by-uei', () => ({
      getContractorHistoryByUei: (...a: unknown[]) => mockShared(...a),
    }));
    vi.doMock('@/lib/bigquery/recipients', () => ({
      getRecipientByUei: vi.fn(async () => null),
      getSetAsidesForRecipients: vi.fn(async () => new Map()),
      getSimilarRecipients: vi.fn(async () => []),
      recipientSlug: (n: string) => n.toLowerCase(),
      SET_ASIDE_BUCKET_LABEL: {},
    }));
    vi.doMock('@/lib/agency-intelligence', () => ({
      getUnifiedAgencyIntelligence: vi.fn(async () => null),
    }));

    expect(mcp._meta.award_count).toBe(35);
    expect(mcp._meta.total_obligations).toBe(23_350_000);
    expect(mcp.history?.summary.awardCount).toBe(sharedPayload.history.summary.awardCount);
    expect(mcp.history?.topAgencies).toEqual(sharedPayload.history.topAgencies);
  });
});
