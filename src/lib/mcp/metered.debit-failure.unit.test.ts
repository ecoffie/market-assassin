/**
 * A failed DEBIT must not discard a tool result that already exists.
 *
 * Before this fix, runMeteredTool awaited debitResolvedPayer() with no catch. When the
 * debit RPC errored (timeout, connection reset) AFTER the tool had run, the exception
 * escaped: the customer got an error instead of the finished result, nothing was
 * logged, and the natural client reaction — retry — ran the upstream work a second
 * time. Contract now: deliver the result, charge 0 (the debit did not confirm), and log
 * the call as `uncharged` with error_code `debit_failed` so it can be reconciled
 * against mcp_credit_ledger.
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
vi.mock('./payer', () => ({
  resolvePayer: vi.fn().mockResolvedValue({ kind: 'personal' }),
  isChargeable: (r: { kind: string }) => r.kind === 'personal' || r.kind === 'pool',
  getPoolBalance: vi.fn(),
  debitResolvedPayer: vi.fn(),
}));

import { runMeteredTool } from './metered';
import * as registry from './tool-registry';
import * as credits from './credits';
import * as payer from './payer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = (fn: unknown) => fn as any;
const ctx = { userEmail: 'payer@x.com', apiKeyId: 'k1' };
const RESULT = { opportunities: [{ notice_id: 'abc' }], _meta: { grounded: true, degraded: false } };

beforeEach(() => {
  vi.clearAllMocks();
  m(credits.logCall).mockResolvedValue(undefined);
  m(registry.isMcpTool).mockReturnValue(true);
  m(registry.creditsFor).mockReturnValue(5);
  m(credits.getBalance).mockResolvedValue(100);
  m(registry.runMcpTool).mockResolvedValue({ result: RESULT, credits: 5 });
});

describe('runMeteredTool — debit failure after the tool ran', () => {
  it('returns the completed result, charges 0 and logs debit_failed for reconciliation', async () => {
    m(payer.debitResolvedPayer).mockRejectedValue(new Error('debitCredits failed: canceling statement due to statement timeout'));

    const r = await runMeteredTool('search_sam_opportunities', { query: 'x' }, ctx);

    expect(r.ok).toBe(true);
    expect(r.ok && r.result).toEqual(RESULT);
    expect(r.creditsCharged).toBe(0);
    expect(r.ok && r.balance).toBeNull(); // unknown, never a fabricated number
    expect(r.ok && r.needsRecharge).toBe(false);
    expect(registry.runMcpTool).toHaveBeenCalledTimes(1);
    expect(credits.logCall).toHaveBeenCalledTimes(1);
    const logged = m(credits.logCall).mock.calls[0][0];
    expect(logged).toMatchObject({ status: 'uncharged', creditsCharged: 0, toolName: 'search_sam_opportunities' });
    expect(logged.outcome?.errorCode).toBe('debit_failed');
  });

  it('a successful debit is unchanged', async () => {
    m(payer.debitResolvedPayer).mockResolvedValue({ ok: true, newBalance: 95, payer: 'personal' });
    const r = await runMeteredTool('search_sam_opportunities', { query: 'x' }, ctx);
    expect(r).toMatchObject({ ok: true, creditsCharged: 5, balance: 95 });
    expect(m(credits.logCall).mock.calls[0][0]).toMatchObject({ status: 'success', creditsCharged: 5 });
  });
});
