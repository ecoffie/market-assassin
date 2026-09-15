/**
 * P1: capability_market_match returns within its soft budget when coverage hangs.
 * Timed-out coverage → market null + degraded + !grounded (not fabricated $0).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  capabilityMarketMatch,
  CAPABILITY_MARKET_MATCH_BUDGET_MS,
} from './capability-market-match';

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
    keywordCoverage: vi.fn(async (_kw: string, _t?: number, opts?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        const signal = opts?.signal;
        if (!signal) return; // hang
        const onAbort = () => reject(new actual.CoverageDeadlineError());
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }),
  };
});

vi.mock('@/lib/market/capability-anchor-evidence', () => ({
  loadAnchorEvidence: vi.fn(async () => ({
    identity: 'unknown',
    identityUei: null,
    identityCandidates: 0,
    samNaics: [],
    awardNaics: [],
    awardObligatedUsd: null,
  })),
}));

describe('capability_market_match budget', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it(`returns within ~${CAPABILITY_MARKET_MATCH_BUDGET_MS}ms when keywordCoverage never resolves`, async () => {
    const started = Date.now();
    const p = capabilityMarketMatch({
      description: 'Precision CNC machining of aerospace titanium components',
      client_name: 'Budget Test Co',
      capabilities: ['CNC machining', 'titanium'],
    });
    // Advance past the tool budget; coverage mock rejects on abort.
    await vi.advanceTimersByTimeAsync(CAPABILITY_MARKET_MATCH_BUDGET_MS + 500);
    const result = await p;
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(CAPABILITY_MARKET_MATCH_BUDGET_MS + 3_000);
    expect(result.market).toBeNull();
    expect(result._meta.grounded).toBe(false);
    expect(result._meta.degraded).toBe(true);
    expect(result._meta.degraded_reason).toBe('deadline_exceeded');
    // Timed-out ≠ no market — never fabricate a zero TAM.
    expect(result.market).toBeNull();
    expect(result._meta.note).toMatch(/timed out|not "no market found"/i);
  });
});
