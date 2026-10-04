/**
 * capability_market_match billing — Option D, r = 10 (owner decision 2026-10-04, ChatGPT
 * submission blocker #3): grounded 50 · useful candidate 10 · empty / no defensible market 0 ·
 * degraded / system failure 0. Measured before: all 8 ChatGPT dev-mode calls were charged 50,
 * including 6 that returned no market at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./tool-registry', () => ({
  isMcpTool: vi.fn(() => true),
  creditsFor: vi.fn(() => 50),
  runMcpTool: vi.fn(),
  isProprietaryTool: vi.fn(() => false),
  PROPRIETARY_TOOLS: new Set(),
}));
vi.mock('./credits', () => ({ getBalance: vi.fn(async () => 500), debitCredits: vi.fn(), logCall: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./payer', () => ({
  resolvePayer: vi.fn().mockResolvedValue({ kind: 'personal' }),
  isChargeable: () => true,
  getPoolBalance: vi.fn(),
  debitResolvedPayer: vi.fn(async (_e: string, amount: number) => ({ ok: true, newBalance: 500 - amount, payer: 'personal' })),
}));
vi.mock('./paywall', () => ({ recordPaywallAttempt: vi.fn(), paywallMessage: vi.fn(() => 'pay'), RESUME_BASE: 'x' }));
vi.mock('./entitlements', () => ({ isProTool: vi.fn(() => false), isProForMcp: vi.fn(async () => true) }));
vi.mock('@/lib/search-history', () => ({ recordSearchAxes: vi.fn() }));
vi.mock('./flags', () => ({ mcpFlags: { enforceTiers: false, extractionGuard: false, extractionEnforce: false, oauth: true, aiHint: false } }));

const { runMeteredTool } = await import('./metered');
const { classifyBillingOutcome, creditsForOutcome, CANDIDATE_CREDITS, isBillable } = await import('./credit-integrity');
const { classifyCallOutcome } = await import('./call-outcome');
const registry = await import('./tool-registry');
const payer = await import('./payer');
const credits = await import('./credits');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = (fn: unknown) => fn as any;

const result = (tier: string, billing: string, grounded = false, degraded = false) => ({
  market: tier === 'empty' ? null : { lead_keyword: 'x' },
  _meta: { grounded, degraded, result_tier: tier, billing_outcome: billing },
});

beforeEach(() => vi.clearAllMocks());

describe('credit-integrity — the two new outcomes', () => {
  it('classifies the tool-declared outcomes', () => {
    expect(classifyBillingOutcome(result('candidate', 'billable_candidate'))).toBe('billable_candidate');
    expect(classifyBillingOutcome(result('empty', 'nonbillable_no_market'))).toBe('nonbillable_no_market');
    expect(isBillable('billable_candidate')).toBe(true);
    expect(isBillable('nonbillable_no_market')).toBe(false);
  });

  it('Option D prices: 50 / 10 / 0 / 0', () => {
    expect(CANDIDATE_CREDITS.capability_market_match).toBe(10);
    expect(creditsForOutcome('capability_market_match', 'billable_success', 50)).toBe(50);
    expect(creditsForOutcome('capability_market_match', 'billable_candidate', 50)).toBe(10);
    expect(creditsForOutcome('capability_market_match', 'nonbillable_no_market', 50)).toBe(0);
    expect(creditsForOutcome('capability_market_match', 'nonbillable_system_failure', 50)).toBe(0);
  });

  it('a tool with no reduced price bills a candidate outcome in full, never above base', () => {
    expect(creditsForOutcome('find_opportunities', 'billable_candidate', 10)).toBe(10);
    expect(creditsForOutcome('capability_market_match', 'billable_candidate', 5)).toBe(5);
  });
});

describe('telemetry split', () => {
  it('a candidate is its own outcome, not no_result; an empty market is no_result', () => {
    expect(classifyCallOutcome(result('candidate', 'billable_candidate')).outcome).toBe('candidate');
    expect(classifyCallOutcome(result('empty', 'nonbillable_no_market')).outcome).toBe('no_result');
    expect(classifyCallOutcome(result('grounded', 'billable_success', true)).outcome).toBe('grounded');
    expect(classifyCallOutcome(result('degraded', 'nonbillable_system_failure', false, true)).outcome).toBe('degraded');
  });
});

describe('runMeteredTool charges by result tier', () => {
  const run = async (r: unknown) => {
    m(registry.runMcpTool).mockResolvedValueOnce({ result: r, credits: 50 });
    return runMeteredTool('capability_market_match', { description: 'roofing contractor' }, { userEmail: 'u@x.com', channel: 'chatgpt' });
  };

  it('grounded → 50', async () => {
    const out = await run(result('grounded', 'billable_success', true));
    expect(out.creditsCharged).toBe(50);
    expect(m(payer.debitResolvedPayer).mock.calls[0][1]).toBe(50);
  });

  it('useful candidate → 10, logged as candidate', async () => {
    const out = await run(result('candidate', 'billable_candidate'));
    expect(out.creditsCharged).toBe(10);
    expect(m(payer.debitResolvedPayer).mock.calls[0][1]).toBe(10);
    expect(m(credits.logCall).mock.calls.at(-1)[0]).toMatchObject({ status: 'success', creditsCharged: 10, outcome: { outcome: 'candidate', billingOutcome: 'billable_candidate' } });
  });

  it('empty → 0, no debit, logged uncharged no_result', async () => {
    const out = await run(result('empty', 'nonbillable_no_market'));
    expect(out.creditsCharged).toBe(0);
    expect(m(payer.debitResolvedPayer)).not.toHaveBeenCalled();
    expect(m(credits.logCall).mock.calls.at(-1)[0]).toMatchObject({ status: 'uncharged', creditsCharged: 0, outcome: { outcome: 'no_result' } });
  });

  it('degraded → 0, no debit', async () => {
    const out = await run(result('degraded', 'nonbillable_system_failure', false, true));
    expect(out.creditsCharged).toBe(0);
    expect(m(payer.debitResolvedPayer)).not.toHaveBeenCalled();
  });
});
