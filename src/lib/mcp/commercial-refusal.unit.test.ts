/**
 * Commercial refusal contract — 2026-09-15 incident regression.
 *
 * Repro: capability_market_match with available=45, required=50 must refuse as
 * INSUFFICIENT_CREDITS (retryable:false), preserve the attempt, never look like a
 * server/timeout failure, and never start market work or debit credits.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  INSUFFICIENT_CREDITS,
  buildInsufficientCreditsRefusal,
  insufficientCreditsLead,
  mcpToolResultFromMeteredError,
} from './commercial-refusal';
import { RESUME_BASE } from './paywall';

vi.mock('./tool-registry', () => ({
  isMcpTool: vi.fn(),
  creditsFor: vi.fn(),
  runMcpTool: vi.fn(),
  isProprietaryTool: vi.fn().mockReturnValue(false),
  PROPRIETARY_TOOLS: new Set(),
}));
vi.mock('./credits', () => ({
  getBalance: vi.fn(),
  debitCredits: vi.fn(),
  logCall: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./payer', () => ({
  resolvePayer: vi.fn().mockResolvedValue({ kind: 'personal' }),
  isChargeable: (r: { kind: string }) => r.kind === 'personal' || r.kind === 'pool',
  getPoolBalance: vi.fn(),
  debitResolvedPayer: vi.fn(),
}));
vi.mock('./flags', () => ({
  mcpFlags: { enforceTiers: false, extractionGuard: false, extractionEnforce: false },
}));
vi.mock('./entitlements', () => ({
  isProTool: vi.fn().mockReturnValue(false),
  isProForMcp: vi.fn(),
}));
vi.mock('./extraction-guard', () => ({
  evaluateExtractionGuard: vi.fn(),
}));
vi.mock('@/lib/search-history', () => ({
  recordSearchAxes: vi.fn(),
}));
vi.mock('./paywall', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./paywall')>();
  return {
    ...actual,
    recordPaywallAttempt: vi.fn().mockResolvedValue('attempt-cbm-45'),
  };
});

import { runMeteredTool } from './metered';
import * as registry from './tool-registry';
import * as credits from './credits';
import * as paywall from './paywall';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = (fn: unknown) => fn as any;

const ctx = { userEmail: 'in***@warabahavenfoundation.org', apiKeyId: null };

beforeEach(() => {
  vi.clearAllMocks();
  m(credits.logCall).mockResolvedValue(undefined);
  m(registry.isMcpTool).mockReturnValue(true);
  m(paywall.recordPaywallAttempt).mockResolvedValue('attempt-cbm-45');
});

describe('insufficientCreditsLead', () => {
  it('states need and have exactly', () => {
    expect(insufficientCreditsLead(50, 45)).toBe(
      'You need 50 credits to run this analysis. You currently have 45.',
    );
  });

  it('does not invent a zero balance when unknown', () => {
    expect(insufficientCreditsLead(50, undefined)).toBe(
      'You need 50 credits to run this analysis.',
    );
    expect(insufficientCreditsLead(50, undefined)).not.toMatch(/you currently have 0/i);
  });
});

describe('buildInsufficientCreditsRefusal', () => {
  it('emits the machine contract without inviting retry', () => {
    const refusal = buildInsufficientCreditsRefusal({
      toolName: 'capability_market_match',
      requiredCredits: 50,
      availableCredits: 45,
      message: 'You need 50 credits to run this analysis. You currently have 45.',
      continueUrl: `${RESUME_BASE}?attempt=attempt-cbm-45`,
    });
    expect(refusal).toMatchObject({
      error_code: INSUFFICIENT_CREDITS,
      required_credits: 50,
      available_credits: 45,
      credits_needed: 5,
      retryable: false,
      continuation_available: true,
      continue_url: `${RESUME_BASE}?attempt=attempt-cbm-45`,
      tool_name: 'capability_market_match',
    });
    expect(refusal.message).not.toMatch(/server (isn.t|not) responding/i);
    expect(refusal.message).not.toMatch(/retry once/i);
    expect(refusal.message).not.toMatch(/temporary/i);
  });
});

describe('mcpToolResultFromMeteredError', () => {
  it('does NOT set isError for commercial refusals (Claude misread isError as server down)', () => {
    const commercial = buildInsufficientCreditsRefusal({
      toolName: 'capability_market_match',
      requiredCredits: 50,
      availableCredits: 45,
      message: 'You need 50 credits to run this analysis. You currently have 45.',
      continueUrl: `${RESUME_BASE}?attempt=x`,
    });
    const result = mcpToolResultFromMeteredError({
      code: 'insufficient_credits',
      message: commercial.message,
      commercial,
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(commercial);
    expect(result.content[0].text).toContain('You need 50 credits');
    const parsed = JSON.parse(result.content[1].text);
    expect(parsed.error_code).toBe(INSUFFICIENT_CREDITS);
    expect(parsed.retryable).toBe(false);
  });

  it('keeps isError for real tool failures', () => {
    const result = mcpToolResultFromMeteredError({
      code: 'tool_error',
      message: 'boom',
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });
});

describe('capability_market_match credit gate — incident 45 vs 50', () => {
  it('available=45 required=50 → INSUFFICIENT_CREDITS, no work, no debit, attempt preserved', async () => {
    m(registry.creditsFor).mockReturnValue(50);
    m(credits.getBalance).mockResolvedValue(45);

    const r = await runMeteredTool(
      'capability_market_match',
      {
        client_name: 'CBM Precision Parts',
        description: 'Woman-owned precision machining',
      },
      ctx,
    );

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected refuse');
    expect(r.error.code).toBe('insufficient_credits');
    expect(r.creditsCharged).toBe(0);
    expect(r.balance).toBe(45);

    const c = r.error.commercial!;
    expect(c.error_code).toBe(INSUFFICIENT_CREDITS);
    expect(c.required_credits).toBe(50);
    expect(c.available_credits).toBe(45);
    expect(c.credits_needed).toBe(5);
    expect(c.retryable).toBe(false);
    expect(c.continuation_available).toBe(true);
    expect(c.continue_url).toBe(`${RESUME_BASE}?attempt=attempt-cbm-45`);
    expect(c.message).toContain('You need 50 credits to run this analysis. You currently have 45.');
    expect(c.message).toMatch(/do not retry/i);
    expect(c.message).not.toMatch(/server (isn.t|not) responding/i);

    expect(registry.runMcpTool).not.toHaveBeenCalled();
    expect(credits.debitCredits).not.toHaveBeenCalled();
    expect(credits.logCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rejected_no_credits', creditsCharged: 0 }),
    );
    expect(paywall.recordPaywallAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'capability_market_match',
        reason: 'insufficient_credits',
        creditsRequired: 50,
        balanceAtAttempt: 45,
        args: expect.objectContaining({ client_name: 'CBM Precision Parts' }),
      }),
    );

    // Transport shape Claude actually sees — not isError.
    const mcp = mcpToolResultFromMeteredError(r.error);
    expect(mcp.isError).toBeUndefined();
    expect(mcp.structuredContent?.error_code).toBe(INSUFFICIENT_CREDITS);
  });

  it('available=50 → proceeds (gate opens; tool may still run)', async () => {
    m(registry.creditsFor).mockReturnValue(50);
    m(credits.getBalance).mockResolvedValue(50);
    m(registry.runMcpTool).mockResolvedValue({
      result: { _meta: { grounded: true, degraded: false } },
      credits: 50,
    });
    m(credits.debitCredits).mockResolvedValue({ ok: true, newBalance: 0 });
    // debitResolvedPayer is mocked via payer module — need it to succeed
    const payer = await import('./payer');
    m(payer.debitResolvedPayer).mockResolvedValue({ ok: true, newBalance: 0, payer: 'personal' });

    const r = await runMeteredTool(
      'capability_market_match',
      { description: 'CNC machining shop' },
      ctx,
    );

    expect(r.ok).toBe(true);
    expect(registry.runMcpTool).toHaveBeenCalledTimes(1);
    expect(paywall.recordPaywallAttempt).not.toHaveBeenCalled();
    expect(credits.logCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', creditsCharged: 50 }),
    );
  });

  it('does not create a second paywall row when refuse is the only outcome (single attempt)', async () => {
    m(registry.creditsFor).mockReturnValue(50);
    m(credits.getBalance).mockResolvedValue(45);
    await runMeteredTool('capability_market_match', { description: 'x'.repeat(20) }, ctx);
    expect(paywall.recordPaywallAttempt).toHaveBeenCalledTimes(1);
  });
});
