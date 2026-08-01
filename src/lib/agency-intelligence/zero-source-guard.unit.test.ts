import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./fetchers/usaspending', () => ({
  fetchAgencySpendingPatterns: vi.fn(),
  fetchNAICSSpending: vi.fn(async () => []),
  fetchSubtierAgencies: vi.fn(async () => []),
}));
vi.mock('./fetchers/govinfo', () => ({
  fetchGAOReports: vi.fn(),
  fetchBudgetDocuments: vi.fn(async () => []),
}));
vi.mock('./fetchers/it-dashboard', () => ({
  fetchITInvestments: vi.fn(async () => []),
  fetchCIOPriorities: vi.fn(async () => []),
}));
vi.mock('./verifier', () => ({ batchVerify: vi.fn(async () => []), quickVerify: vi.fn(() => true) }));

const row = (t: string) => ({ agency_name: 'DHS', intelligence_type: t, title: 't-' + t }) as never;

describe('syncAllSources zero-record guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports an error when a source returns 0 records', async () => {
    const { fetchAgencySpendingPatterns } = await import('./fetchers/usaspending');
    const { fetchGAOReports } = await import('./fetchers/govinfo');
    vi.mocked(fetchAgencySpendingPatterns).mockResolvedValue([]);          // dead
    vi.mocked(fetchGAOReports).mockResolvedValue([row('gao_high_risk')]);  // healthy
    const { syncAllSources } = await import('./index');
    const r = await syncAllSources({ dryRun: true } as never);
    // dryRun short-circuits storage; force the non-dry path for the guard:
    const r2 = await syncAllSources({} as never);
    expect(r2.errors.some((e) => e.includes('USASpending') && e.includes('0 records'))).toBe(true);
    expect(r2.errors.some((e) => e.includes('GovInfo'))).toBe(false);
    expect(r2.bySource).toEqual({ USASpending: 0, GovInfo: 1 });
    expect(r).toBeDefined();
  });

  it('reports no error when every source produces records', async () => {
    const { fetchAgencySpendingPatterns } = await import('./fetchers/usaspending');
    const { fetchGAOReports } = await import('./fetchers/govinfo');
    vi.mocked(fetchAgencySpendingPatterns).mockResolvedValue([row('contract_pattern')]);
    vi.mocked(fetchGAOReports).mockResolvedValue([row('gao_high_risk')]);
    const { syncAllSources } = await import('./index');
    const r = await syncAllSources({} as never);
    expect(r.errors).toEqual([]);
    expect(r.bySource).toEqual({ USASpending: 1, GovInfo: 1 });
  });
});
