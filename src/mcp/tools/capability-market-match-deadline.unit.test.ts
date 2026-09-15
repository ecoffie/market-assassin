/**
 * P1 budget + charging contract for capability_market_match.
 *
 * Charging (Eric 2026-09-15):
 *   - FULL 50 credits when core market is grounded
 *   - UNCHARGED when coverage times out / ungrounded (degraded && !grounded → DEFECT-7)
 *   - Optional enrichment omitted for time does NOT cut price and does NOT set degraded
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  capabilityMarketMatch,
  CAPABILITY_MARKET_MATCH_BUDGET_MS,
  guardedWithDeadline,
} from './capability-market-match';
import type { KeywordCoverage } from '@/lib/market/keyword-coverage';

const hang = <T = never>() => new Promise<T>(() => {});

function coverageFixture(over: Partial<KeywordCoverage> = {}): KeywordCoverage {
  return {
    keyword: 'cnc machining',
    totalMarket: 500_000_000,
    naicsCount: 3,
    allNaics: [
      { code: '332710', name: 'Machine Shops', amount: 300_000_000, pct: 0.6 },
      { code: '336413', name: 'Other Aircraft Parts', amount: 150_000_000, pct: 0.3 },
      { code: '332721', name: 'Precision Turned Product', amount: 50_000_000, pct: 0.1 },
    ],
    coverageCodes: ['332710', '336413'],
    coveragePct: 0.9,
    topCodePct: 0.6,
    leadCodePct: 0.6,
    pscCount: 2,
    topPsc: { code: '9530', name: 'Bars and Rods' },
    topPscPct: 0.4,
    topPscList: [{ code: '9530', name: 'Bars and Rods', amount: 200_000_000, pct: 0.4 }],
    pinnedPscCodes: null,
    ...over,
  };
}

vi.mock('@/mcp/tools/company-keywords', () => ({
  deriveCompanyKeywords: vi.fn(async () => ({
    keywords: ['cnc machining', 'titanium components', 'precision machining'],
    _meta: { grounded: true, degraded: false },
  })),
}));

vi.mock('@/lib/market/keyword-coverage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/market/keyword-coverage')>(
    '@/lib/market/keyword-coverage',
  );
  return {
    ...actual,
    keywordCoverage: vi.fn(),
  };
});

vi.mock('@/lib/market/capability-anchor-evidence', () => ({
  loadAnchorEvidence: vi.fn(async () => ({
    identity: 'unique',
    identityUei: 'TESTUEI00001',
    identityCandidates: 1,
    samNaics: ['332710'],
    awardNaics: ['332710'],
    awardObligatedUsd: 1_000_000,
  })),
}));

vi.mock('@/lib/market/capability-anchor', async () => {
  const actual = await vi.importActual<typeof import('@/lib/market/capability-anchor')>(
    '@/lib/market/capability-anchor',
  );
  return {
    ...actual,
    pickBestAnchor: vi.fn(() => ({
      phrase: 'cnc machining',
      score: 10,
      source: 'capability',
    })),
    pickLeadNaicsFromCoverage: vi.fn(() => '332710'),
    resolveLeadNaicsWithEvidence: vi.fn(() => '332710'),
    validateMarketAnchor: vi.fn(() => ({
      grounded: true,
      anchor_verified: true,
      anchor_confidence: 'high' as const,
      anchor_note: undefined,
      tamFlag: false,
    })),
  };
});

vi.mock('@/mcp/tools/search-contractors', () => ({
  searchContractors: vi.fn(),
}));
vi.mock('@/mcp/tools/forecasts', () => ({
  agencyForecasts: vi.fn(),
}));
vi.mock('@/mcp/tools/expiring-contracts', () => ({
  expiringContracts: vi.fn(),
}));
vi.mock('@/lib/market/vocabulary', () => ({
  getVocabulary: vi.fn(),
}));
vi.mock('@/lib/usaspending/psc-recipients', () => ({
  topRecipientsByPsc: vi.fn(async () => []),
}));

import { keywordCoverage, CoverageDeadlineError } from '@/lib/market/keyword-coverage';
import { searchContractors } from '@/mcp/tools/search-contractors';
import { agencyForecasts } from '@/mcp/tools/forecasts';
import { expiringContracts } from '@/mcp/tools/expiring-contracts';
import { getVocabulary } from '@/lib/market/vocabulary';
import { validateMarketAnchor } from '@/lib/market/capability-anchor';

const kwMock = vi.mocked(keywordCoverage);
const contractorsMock = vi.mocked(searchContractors);
const forecastsMock = vi.mocked(agencyForecasts);
const expiringMock = vi.mocked(expiringContracts);
const vocabMock = vi.mocked(getVocabulary);
const validateMock = vi.mocked(validateMarketAnchor);

function successEnrichment() {
  contractorsMock.mockResolvedValue({
    queried: { naics: '332710', sort_by: 'total_obligated' },
    contractors: [{ recipient_name: 'Acme Machining', recipient_uei: 'A'.repeat(12) } as never],
    _meta: { grounded: true, degraded: false, count: 1 },
  });
  forecastsMock.mockResolvedValue({
    forecasts: [{ title: 'Shop equipment' } as never],
    _meta: { grounded: true, degraded: false, count: 1 },
  });
  expiringMock.mockResolvedValue({
    contracts: [{ contract_id: 'C1' } as never],
    _meta: { grounded: true, degraded: false, count: 1 },
  });
  vocabMock.mockResolvedValue([{ term: 'machine shop' } as never]);
}

describe('guardedWithDeadline', () => {
  it('omits when remaining budget is too small without awaiting the promise', async () => {
    const outcome = await guardedWithDeadline(hang(), 100, 'competitors');
    expect(outcome).toEqual({ value: null, status: 'omitted' });
  });

  it('returns ok when the promise wins the race', async () => {
    const outcome = await guardedWithDeadline(Promise.resolve({ ok: true }), 5_000, 'forecasts');
    expect(outcome).toEqual({ value: { ok: true }, status: 'ok' });
  });
});

describe('capability_market_match budget + charging contract', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    validateMock.mockReturnValue({
      grounded: true,
      anchor_verified: true,
      anchor_confidence: 'high',
      anchor_note: undefined,
      tamFlag: false,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. coverage hangs → inside budget, grounded=false, degraded, deadline_exceeded (uncharged shape)', async () => {
    kwMock.mockImplementation(async (_k, _t, opts) => {
      await new Promise<never>((_resolve, reject) => {
        const signal = opts?.signal;
        if (!signal) return;
        const fail = () => reject(new CoverageDeadlineError());
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
      });
    });

    const started = Date.now();
    const p = capabilityMarketMatch({
      description: 'Precision CNC machining of aerospace titanium components',
      client_name: 'Budget Test Co',
      capabilities: ['CNC machining'],
    });
    await vi.advanceTimersByTimeAsync(CAPABILITY_MARKET_MATCH_BUDGET_MS + 500);
    const result = await p;

    expect(Date.now() - started).toBeLessThan(CAPABILITY_MARKET_MATCH_BUDGET_MS + 3_000);
    expect(result.market).toBeNull();
    expect(result._meta.grounded).toBe(false);
    expect(result._meta.degraded).toBe(true);
    expect(result._meta.degraded_reason).toBe('deadline_exceeded');
    // DEFECT-7 uncharged predicate
    expect(result._meta.degraded && result._meta.grounded !== true).toBe(true);
  });

  it('2. coverage ok + competitors hang → inside budget, grounded, competitors omitted, billable shape', async () => {
    kwMock.mockResolvedValue(coverageFixture());
    contractorsMock.mockImplementation(() => hang());
    forecastsMock.mockResolvedValue({
      forecasts: [{ title: 'Shop equipment' } as never],
      _meta: { grounded: true, degraded: false, count: 1 },
    });
    expiringMock.mockResolvedValue({
      contracts: [{ contract_id: 'C1' } as never],
      _meta: { grounded: true, degraded: false, count: 1 },
    });
    vocabMock.mockResolvedValue([{ term: 'machine shop' } as never]);

    // Leave ~2s after "fast" coverage so competitor race times out without waiting forever.
    vi.setSystemTime(Date.now());
    const p = capabilityMarketMatch({
      description: 'Precision CNC machining',
      client_name: 'Hang Competitors Co',
      capabilities: ['CNC machining'],
    });
    // Advance enough for competitor deadline races (remaining budget shrinks as we go).
    await vi.advanceTimersByTimeAsync(CAPABILITY_MARKET_MATCH_BUDGET_MS);
    const result = await p;

    expect(result._meta.elapsed_ms).toBeLessThanOrEqual(CAPABILITY_MARKET_MATCH_BUDGET_MS + 2_000);
    expect(result._meta.grounded).toBe(true);
    expect(result._meta.degraded).toBe(false);
    expect(result.market).not.toBeNull();
    expect(result._meta.sections_omitted).toContain('competitors');
    expect(result.competitors).toEqual([]);
    expect(result._meta.sections.competitors).toEqual({ shown: 0, available: 0 });
    // Billable: grounded and NOT (degraded && !grounded)
    expect(!(result._meta.degraded === true && result._meta.grounded !== true)).toBe(true);
  });

  it('3. coverage ok + forecasts hang → forecasts omitted, market preserved, billable', async () => {
    kwMock.mockResolvedValue(coverageFixture());
    contractorsMock.mockResolvedValue({
      queried: { naics: '332710', sort_by: 'total_obligated' },
      contractors: [{ recipient_name: 'Acme' } as never],
      _meta: { grounded: true, degraded: false, count: 1 },
    });
    forecastsMock.mockImplementation(() => hang());
    expiringMock.mockResolvedValue({
      contracts: [{ contract_id: 'C1' } as never],
      _meta: { grounded: true, degraded: false, count: 1 },
    });
    vocabMock.mockResolvedValue([{ term: 'machine shop' } as never]);

    const p = capabilityMarketMatch({
      description: 'Precision CNC machining',
      client_name: 'Hang Forecasts Co',
      capabilities: ['CNC machining'],
    });
    await vi.advanceTimersByTimeAsync(CAPABILITY_MARKET_MATCH_BUDGET_MS);
    const result = await p;

    expect(result._meta.grounded).toBe(true);
    expect(result._meta.degraded).toBe(false);
    expect(result.market).not.toBeNull();
    expect(result._meta.sections_omitted).toContain('forecasts');
    expect(result.upcoming_forecasts).toEqual([]);
    expect(result._meta.sections.forecasts).toEqual({ shown: 0, available: 0 });
  });

  it('4. multiple downstream hangs → still returns inside budget', async () => {
    kwMock.mockResolvedValue(coverageFixture());
    contractorsMock.mockImplementation(() => hang());
    forecastsMock.mockImplementation(() => hang());
    expiringMock.mockImplementation(() => hang());
    vocabMock.mockImplementation(() => hang());

    const started = Date.now();
    const p = capabilityMarketMatch({
      description: 'Precision CNC machining',
      client_name: 'Hang All Enrichment Co',
      capabilities: ['CNC machining'],
    });
    await vi.advanceTimersByTimeAsync(CAPABILITY_MARKET_MATCH_BUDGET_MS + 200);
    const result = await p;

    expect(Date.now() - started).toBeLessThan(CAPABILITY_MARKET_MATCH_BUDGET_MS + 3_000);
    expect(result._meta.grounded).toBe(true);
    expect(result._meta.degraded).toBe(false);
    expect(result.market).not.toBeNull();
    expect(result._meta.sections_omitted?.length).toBeGreaterThanOrEqual(2);
  });

  it('5. all sections succeed → full result unchanged shape', async () => {
    kwMock.mockResolvedValue(coverageFixture());
    successEnrichment();

    const result = await capabilityMarketMatch({
      description: 'Precision CNC machining',
      client_name: 'Full Success Co',
      capabilities: ['CNC machining'],
    });

    expect(result._meta.grounded).toBe(true);
    expect(result._meta.degraded).toBe(false);
    expect(result._meta.sections_omitted).toBeUndefined();
    expect(result.market?.lead_keyword).toBe('cnc machining');
    expect(result.competitors.length).toBeGreaterThan(0);
    expect(result.upcoming_forecasts.length).toBeGreaterThan(0);
    expect(result.recompete_opportunities.length).toBeGreaterThan(0);
    expect(result.buyer_vocabulary.length).toBeGreaterThan(0);
  });

  it('6. omitted sections are not fabricated sourced zeros (available=0, not "found 0")', async () => {
    kwMock.mockResolvedValue(coverageFixture());
    contractorsMock.mockImplementation(() => hang());
    forecastsMock.mockImplementation(() => hang());
    expiringMock.mockResolvedValue({
      contracts: [{ contract_id: 'C1' } as never],
      _meta: { grounded: true, degraded: false, count: 1 },
    });
    vocabMock.mockResolvedValue([{ term: 'machine shop' } as never]);

    const p = capabilityMarketMatch({
      description: 'Precision CNC machining',
      client_name: 'No Fabricated Zero Co',
      capabilities: ['CNC machining'],
    });
    await vi.advanceTimersByTimeAsync(CAPABILITY_MARKET_MATCH_BUDGET_MS);
    const result = await p;

    expect(result._meta.sections_omitted).toEqual(expect.arrayContaining(['competitors', 'forecasts']));
    // Explicit omit metadata — not a confident "0 found in market"
    expect(result._meta.sections.competitors.available).toBe(0);
    expect(result._meta.sections.forecasts.available).toBe(0);
    expect(result._meta.note).toMatch(/omitted enrichment/i);
  });
});
