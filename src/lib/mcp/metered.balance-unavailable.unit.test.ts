/**
 * runMeteredTool: a balance READ failure must never be presented as "no credits".
 * See balance-read-error.unit.test.ts for the getBalance half of this contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./tool-registry', () => ({
  isMcpTool: vi.fn(),
  creditsFor: vi.fn(),
  runMcpTool: vi.fn(),
  isProprietaryTool: vi.fn().mockReturnValue(false),
  PROPRIETARY_TOOLS: new Set<string>(),
}));
vi.mock('./credits', () => ({
  getBalance: vi.fn(),
  debitCredits: vi.fn(),
  logCall: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./paywall', () => ({
  recordPaywallAttempt: vi.fn().mockResolvedValue('attempt-1'),
  paywallMessage: vi.fn().mockReturnValue('buy credits'),
  RESUME_BASE: 'https://getmindy.ai/mcp/continue',
}));
vi.mock('./payer', () => ({
  resolvePayer: vi.fn().mockResolvedValue({ kind: 'personal' }),
  isChargeable: (r: { kind: string }) => r.kind === 'personal' || r.kind === 'pool',
  getPoolBalance: vi.fn(),
  debitResolvedPayer: vi.fn(),
}));

import { runMeteredTool } from './metered';
import * as registry from './tool-registry';
import * as credits from './credits';
import * as paywall from './paywall';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = (fn: unknown) => fn as any;
const ctx = { userEmail: 'payer@x.com', apiKeyId: 'k1' };

beforeEach(() => {
  vi.clearAllMocks();
  m(credits.logCall).mockResolvedValue(undefined);
  m(registry.isMcpTool).mockReturnValue(true);
  m(registry.creditsFor).mockReturnValue(5);
});

describe('runMeteredTool — balance read failure', () => {
  it('returns billing_unavailable, runs nothing, charges nothing, records no paywall', async () => {
    m(credits.getBalance).mockRejectedValue(new Error('getBalance failed: canceling statement due to statement timeout'));

    const r = await runMeteredTool('search_sam_opportunities', { query: 'x' }, ctx);

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.code).toBe('billing_unavailable');
    expect(r.ok === false && r.error.message).toMatch(/nothing was charged/i);
    expect(r.ok === false && 'commercial' in r.error && r.error.commercial).toBeFalsy();
    expect(r.creditsCharged).toBe(0);
    expect(registry.runMcpTool).not.toHaveBeenCalled();
    expect(credits.debitCredits).not.toHaveBeenCalled();
    expect(paywall.recordPaywallAttempt).not.toHaveBeenCalled();
    // Logged as a failed call with a distinct error code — never as rejected_no_credits.
    expect(credits.logCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', creditsCharged: 0 }));
    expect(credits.logCall).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected_no_credits' }));
    const logged = m(credits.logCall).mock.calls[0][0];
    expect(logged.outcome?.errorCode).toBe('billing_unavailable');
  });

  it('a genuine zero balance still gets the insufficient_credits paywall', async () => {
    m(credits.getBalance).mockResolvedValue(0);
    const r = await runMeteredTool('search_sam_opportunities', { query: 'x' }, ctx);
    expect(r.ok === false && r.error.code).toBe('insufficient_credits');
    expect(paywall.recordPaywallAttempt).toHaveBeenCalled();
  });
});
