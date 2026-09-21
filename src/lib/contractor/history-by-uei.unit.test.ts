/**
 * Shared UEI contractor-history service — Map + MCP consume one path.
 * No live USASpending. Deterministic mocks only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mockGetBq = vi.fn();
const mockAllowCold = vi.fn();
const mockLookupLocal = vi.fn();
const mockBqUnavailable = vi.fn();

vi.mock('@/lib/bigquery/recipients', () => ({
  getBqContractorHistory: (...a: unknown[]) => mockGetBq(...a),
}));
vi.mock('@/lib/bigquery/cache', () => ({
  bqUnavailable: (...a: unknown[]) => mockBqUnavailable(...a),
}));
vi.mock('@/lib/bigquery/cold-budget', () => ({
  allowColdBqLookup: (...a: unknown[]) => mockAllowCold(...a),
}));
vi.mock('@/lib/sam/entity-local-fallback', () => ({
  lookupLocalEntityByUEI: (...a: unknown[]) => mockLookupLocal(...a),
}));

const NS_UEI = 'FCJCDUZV7RM3';
const TANAQ_SUPPORT = 'UM53UXL5QNF5';
const TANAQ_GLOBAL = 'WDMBF2J6EML3';

function bqHistory(
  name: string,
  awardCount: number,
  total: number,
  opts?: { enrichment_status?: 'complete' | 'budget_limited'; emptyDetails?: boolean },
) {
  const enrichment = opts?.enrichment_status ?? 'complete';
  const emptyDetails = opts?.emptyDetails === true;
  return {
    success: true,
    source: 'bigquery_normalized' as const,
    coverage: enrichment === 'budget_limited' ? 'limited' : 'cached',
    lastUpdated: '2025-06-15',
    contractor: {
      company: name,
      slug: name.toLowerCase().replace(/\s+/g, '-'),
      naics: emptyDetails ? [] : ['541512'],
      agencies: emptyDetails ? [] : ['DEPT OF DEFENSE'],
      totalContractValue: total,
      contractCount: awardCount,
      hasContact: false,
      hasEmail: false,
      hasPhone: false,
    },
    match: { method: 'recipient_name', confidence: 'high', name },
    summary: {
      totalObligations: total,
      awardCount,
      latestFiscalYear: emptyDetails ? null : 2025,
      topAgency: emptyDetails ? null : 'DEPT OF DEFENSE',
      averageAwardSize: awardCount ? total / awardCount : 0,
    },
    series: emptyDetails
      ? []
      : [{ fiscalYear: 2025, totalObligations: total, awardCount, agencyBreakdown: [] }],
    topAgencies: emptyDetails
      ? []
      : [{ agency: 'DEPT OF DEFENSE', amount: total, count: 0, share: 1 }],
    topNaics: emptyDetails
      ? []
      : [{ naics: '541512', description: 'IT', amount: total, count: awardCount }],
    recentAwards: emptyDetails
      ? []
      : [
          {
            id: 'A1',
            title: 'Services',
            agency: 'DEPT OF DEFENSE',
            subAgency: null,
            naics: '541512',
            naicsDescription: null,
            amount: total,
            startDate: null,
            endDate: null,
            state: 'AK',
            url: null,
          },
        ],
    gated: { fullHistory: false, contacts: false, workflowActions: false, exports: false },
    enrichment_status: enrichment,
    partial: enrichment === 'budget_limited',
    ...(enrichment === 'budget_limited'
      ? {
          message:
            'Award/agency/NAICS detail was not retrieved. Empty arrays mean not fetched, not none exist.',
        }
      : {}),
  };
}

async function load() {
  return import('./history-by-uei');
}

beforeEach(() => {
  vi.resetModules();
  mockGetBq.mockReset();
  mockAllowCold.mockReset();
  mockLookupLocal.mockReset();
  mockBqUnavailable.mockReset();
  mockBqUnavailable.mockReturnValue(false);
  mockAllowCold.mockResolvedValue(true);
  mockLookupLocal.mockResolvedValue({ status: 'absent' });
});

describe('getContractorHistoryByUei — validation', () => {
  it('rejects invalid UEI before any data access', async () => {
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({ uei: 'too-short', coldPolicy: 'never' });
    expect(r.resolution).toBe('malformed');
    expect(mockGetBq).not.toHaveBeenCalled();
    expect(mockLookupLocal).not.toHaveBeenCalled();
  });
});

describe('getContractorHistoryByUei — warm / cold / budget', () => {
  it('warm KV hit serves without cold BQ', async () => {
    mockGetBq.mockResolvedValueOnce(bqHistory('NORTH STAR', 35, 23_350_000));
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({
      uei: NS_UEI,
      coldPolicy: 'budgeted',
      actor: 'user@example.com',
    });
    expect(r.resolution).toBe('found');
    expect(r.cache).toBe('warm');
    expect(r.source).toBe('bigquery_normalized');
    expect(r.aggregates_cover).toBe('bq_ingest');
    expect(r.history?.summary.awardCount).toBe(35);
    expect(r.history?.source).toBe('bigquery_normalized');
    expect(r.history?.enrichment_status).toBe('complete');
    expect(r.degraded).toBe(false);
    expect(mockGetBq).toHaveBeenCalledTimes(1);
    expect(mockGetBq.mock.calls[0][0]).toMatchObject({ uei: NS_UEI, liveBq: false });
    expect(mockAllowCold).not.toHaveBeenCalled();
  });

  it('cold BQ fill occurs only when budget allows', async () => {
    mockGetBq.mockResolvedValueOnce(null); // warm miss
    mockBqUnavailable.mockReturnValue(true);
    mockAllowCold.mockResolvedValue(true);
    mockGetBq.mockResolvedValueOnce(bqHistory('NORTH STAR', 35, 23_350_000));
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({
      uei: NS_UEI,
      coldPolicy: 'budgeted',
      actor: 'user@example.com',
    });
    expect(r.cache).toBe('cold_bq');
    expect(r.resolution).toBe('found');
    expect(mockAllowCold).toHaveBeenCalled();
    expect(mockGetBq.mock.calls[1][0]).toMatchObject({ liveBq: true });
  });

  it('budget exhausted → degraded/unavailable (not zero awards)', async () => {
    mockGetBq.mockResolvedValueOnce(null);
    mockBqUnavailable.mockReturnValue(true);
    mockAllowCold.mockResolvedValue(false);
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({
      uei: NS_UEI,
      coldPolicy: 'budgeted',
      actor: 'user@example.com',
    });
    expect(r.resolution).toBe('unavailable');
    expect(r.degraded).toBe(true);
    expect(r.history).toBeNull();
    expect(mockGetBq).toHaveBeenCalledTimes(1); // warm only
  });

  it('BQ failure without warm data → unavailable', async () => {
    mockGetBq.mockResolvedValueOnce(null);
    mockBqUnavailable.mockReturnValue(true);
    mockAllowCold.mockResolvedValue(true);
    mockGetBq.mockRejectedValueOnce(new Error('quota exceeded'));
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({
      uei: NS_UEI,
      coldPolicy: 'always',
    });
    expect(r.resolution).toBe('unavailable');
    expect(r.degraded).toBe(true);
  });

  it('Map coldPolicy=always does not require actor', async () => {
    mockGetBq.mockResolvedValueOnce(null);
    mockBqUnavailable.mockReturnValue(true);
    mockGetBq.mockResolvedValueOnce(bqHistory('NORTH STAR', 35, 23_350_000));
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({ uei: NS_UEI, coldPolicy: 'always' });
    expect(r.resolution).toBe('found');
    expect(mockAllowCold).not.toHaveBeenCalled();
  });

  it('budgeted without actor cannot cold-scan (no unlimited fallback identity)', async () => {
    mockGetBq.mockResolvedValueOnce(null);
    mockBqUnavailable.mockReturnValue(true);
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({
      uei: NS_UEI,
      coldPolicy: 'budgeted',
      // actor omitted
    });
    expect(r.resolution).toBe('unavailable');
    expect(r.degraded).toBe(true);
    expect(mockAllowCold).not.toHaveBeenCalled();
    expect(mockGetBq).toHaveBeenCalledTimes(1);
    expect(mockGetBq.mock.calls[0][0]).toMatchObject({ liveBq: false });
  });
});

describe('getContractorHistoryByUei — partial detail cache', () => {
  it('warm complete cache returns complete enrichment', async () => {
    mockGetBq.mockResolvedValueOnce(
      bqHistory('NORTH STAR', 35, 23_350_000, { enrichment_status: 'complete' }),
    );
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({
      uei: NS_UEI,
      coldPolicy: 'budgeted',
      actor: 'user@example.com',
    });
    expect(r.resolution).toBe('found');
    expect(r.degraded).toBe(false);
    expect(r.history?.enrichment_status).toBe('complete');
    expect(r.history?.topAgencies.length).toBeGreaterThan(0);
    expect(r.history?.source).toBe(r.source);
  });

  it('warm profile + missing detail caches is NOT presented as complete empty history', async () => {
    mockGetBq.mockResolvedValueOnce(
      bqHistory('NORTH STAR', 35, 23_350_000, {
        enrichment_status: 'budget_limited',
        emptyDetails: true,
      }),
    );
    mockAllowCold.mockResolvedValue(false);
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({
      uei: NS_UEI,
      coldPolicy: 'budgeted',
      actor: 'user@example.com',
    });
    expect(r.resolution).toBe('found');
    expect(r.degraded).toBe(true);
    expect(r.history?.enrichment_status).toBe('budget_limited');
    expect(r.history?.partial).toBe(true);
    expect(r.history?.summary.awardCount).toBe(35);
    expect(r.history?.message).toMatch(/not fetched|not retrieved/i);
    // Empty detail arrays must not be treated as a complete zero-detail market
    expect(r.history?.enrichment_status).not.toBe('complete');
  });

  it('partial cache + cold budget allowed → cold fill → complete history', async () => {
    mockGetBq.mockResolvedValueOnce(
      bqHistory('NORTH STAR', 35, 23_350_000, {
        enrichment_status: 'budget_limited',
        emptyDetails: true,
      }),
    );
    mockAllowCold.mockResolvedValue(true);
    mockGetBq.mockResolvedValueOnce(
      bqHistory('NORTH STAR', 35, 23_350_000, { enrichment_status: 'complete' }),
    );
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({
      uei: NS_UEI,
      coldPolicy: 'budgeted',
      actor: 'user@example.com',
    });
    expect(r.cache).toBe('cold_bq');
    expect(r.degraded).toBe(false);
    expect(r.history?.enrichment_status).toBe('complete');
    expect(r.history?.topAgencies.length).toBeGreaterThan(0);
    expect(mockGetBq.mock.calls[1][0]).toMatchObject({ liveBq: true });
  });

  it('partial cache + budget exhausted → honest budget_limited (not complete zeros)', async () => {
    mockGetBq.mockResolvedValueOnce(
      bqHistory('NORTH STAR', 35, 23_350_000, {
        enrichment_status: 'budget_limited',
        emptyDetails: true,
      }),
    );
    mockAllowCold.mockResolvedValue(false);
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({
      uei: NS_UEI,
      coldPolicy: 'budgeted',
      actor: 'user@example.com',
    });
    expect(r.cache).toBe('warm');
    expect(r.degraded).toBe(true);
    expect(r.history?.enrichment_status).toBe('budget_limited');
    expect(r.history?.recentAwards).toEqual([]);
    expect(mockGetBq).toHaveBeenCalledTimes(1);
  });

  it('genuine zero awards: empty detail arrays remain valid and complete', async () => {
    mockGetBq.mockResolvedValueOnce(
      bqHistory('ZERO CO', 0, 0, { enrichment_status: 'complete', emptyDetails: true }),
    );
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({
      uei: NS_UEI,
      coldPolicy: 'budgeted',
      actor: 'user@example.com',
    });
    expect(r.resolution).toBe('registered_zero');
    expect(r.degraded).toBe(false);
    expect(r.history?.enrichment_status).toBe('complete');
    expect(r.history?.summary.awardCount).toBe(0);
    expect(r.history?.topAgencies).toEqual([]);
    expect(mockAllowCold).not.toHaveBeenCalled();
  });
});

describe('getContractorHistoryByUei — nested source agrees with additive provenance', () => {
  it('BQ path: history.source === additive source === bigquery_normalized', async () => {
    mockGetBq.mockResolvedValueOnce(bqHistory('NORTH STAR', 35, 23_350_000));
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({ uei: NS_UEI, coldPolicy: 'never' });
    expect(r.source).toBe('bigquery_normalized');
    expect(r.history?.source).toBe('bigquery_normalized');
    expect(r.history?.source).not.toBe('usaspending_cache');
  });

  it('registry path: nested source is local_registry (not usaspending_cache)', async () => {
    mockGetBq.mockResolvedValue(null);
    mockBqUnavailable.mockReturnValue(false);
    mockLookupLocal.mockResolvedValue({
      status: 'found',
      hit: {
        entity: { legalBusinessName: 'TANAQ GLOBAL LLC', dbaName: undefined },
        asOf: '2026-08-20T00:00:00Z',
      },
    });
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({ uei: TANAQ_GLOBAL, coldPolicy: 'always' });
    expect(r.source).toBe('local_registry');
    expect(r.history?.source).toBe('local_registry');
  });
});

describe('getContractorHistoryByUei — registry outcomes', () => {
  it('Tanaq Global: no BQ profile + local registry → registered_zero', async () => {
    mockGetBq.mockResolvedValue(null);
    mockBqUnavailable.mockReturnValue(false); // warm known-empty OR cold returned empty
    mockLookupLocal.mockResolvedValue({
      status: 'found',
      hit: {
        entity: { legalBusinessName: 'TANAQ GLOBAL LLC', dbaName: undefined },
        asOf: '2026-08-20T00:00:00Z',
      },
    });
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({ uei: TANAQ_GLOBAL, coldPolicy: 'always' });
    expect(r.resolution).toBe('registered_zero');
    expect(r.name).toBe('TANAQ GLOBAL LLC');
    expect(r.history?.summary.awardCount).toBe(0);
    expect(r.source).toBe('local_registry');
    expect(r.aggregates_cover).toBe('bq_ingest');
  });

  it('unknown UEI → not_found', async () => {
    mockGetBq.mockResolvedValue(null);
    mockBqUnavailable.mockReturnValue(false);
    mockLookupLocal.mockResolvedValue({ status: 'absent' });
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({ uei: 'ZZZZZZZZZZZZ', coldPolicy: 'always' });
    expect(r.resolution).toBe('not_found');
  });

  it('registry unavailable does not become not-found', async () => {
    mockGetBq.mockResolvedValue(null);
    mockBqUnavailable.mockReturnValue(false);
    mockLookupLocal.mockResolvedValue({ status: 'unavailable', detail: 'connection refused' });
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({ uei: TANAQ_GLOBAL, coldPolicy: 'always' });
    expect(r.resolution).toBe('unavailable');
    expect(r.degraded).toBe(true);
  });
});

describe('getContractorHistoryByUei — fixture parity shapes', () => {
  it('North Star BQ facts are returned with warehouse provenance', async () => {
    mockGetBq.mockResolvedValueOnce(bqHistory('NORTH STAR CONSTRUCTION SERVICES LLC', 35, 23_350_000));
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({ uei: NS_UEI, coldPolicy: 'never' });
    expect(r.resolution).toBe('found');
    expect(r.history?.summary.awardCount).toBe(35);
    expect(r.history?.summary.totalObligations).toBe(23_350_000);
    expect(r.source).toBe('bigquery_normalized');
    expect(r.asOf).toBe('2025-06-15');
  });

  it('Tanaq Support BQ facts when warehouse populated', async () => {
    mockGetBq.mockResolvedValueOnce(bqHistory('TANAQ SUPPORT SERVICES LLC', 52, 246_000_000));
    const { getContractorHistoryByUei } = await load();
    const r = await getContractorHistoryByUei({ uei: TANAQ_SUPPORT, coldPolicy: 'never' });
    expect(r.resolution).toBe('found');
    expect(r.history?.summary.awardCount).toBe(52);
  });
});

describe('serving path — no live USASpending / no nested MCP', () => {
  it('history-by-uei source does not import fetchUSASpendingAwardsByUei or awards-by-uei', () => {
    const src = readFileSync(join(__dirname, 'history-by-uei.ts'), 'utf8');
    expect(src).not.toMatch(/fetchUSASpendingAwardsByUei/);
    expect(src).not.toMatch(/awards-by-uei/);
    expect(src).not.toMatch(/search_past_contracts/);
    expect(src).not.toMatch(/runMcpTool|runMeteredTool/);
  });

  it('MCP award-history UEI path does not import live USASpending awards-by-uei', () => {
    const src = readFileSync(
      join(__dirname, '../../mcp/tools/contractor-award-history.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/fetchUSASpendingAwardsByUei/);
    expect(src).not.toMatch(/awards-by-uei/);
    expect(src).toMatch(/getContractorHistoryByUei/);
  });
});
