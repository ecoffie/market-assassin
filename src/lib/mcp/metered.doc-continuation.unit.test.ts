/**
 * runMeteredTool prices a verified get_solicitation_documents continuation at 0 BEFORE the call
 * runs (so a user low on balance can finish a read they already paid for), and bills everything
 * else normally. ChatGPT blocker #2, owner decision 2026-10-04.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./tool-registry', () => ({
  isMcpTool: vi.fn(() => true),
  creditsFor: vi.fn(() => 10),
  runMcpTool: vi.fn(async () => ({ result: { _meta: { grounded: true, degraded: false } }, credits: 10 })),
  isProprietaryTool: vi.fn(() => false),
  PROPRIETARY_TOOLS: new Set(),
}));
vi.mock('./credits', () => ({ getBalance: vi.fn(async () => 3), debitCredits: vi.fn(), logCall: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./payer', () => ({
  resolvePayer: vi.fn().mockResolvedValue({ kind: 'personal' }),
  isChargeable: () => true,
  getPoolBalance: vi.fn(),
  debitResolvedPayer: vi.fn(async () => ({ ok: true, newBalance: 0, payer: 'personal' })),
}));
vi.mock('./paywall', () => ({ recordPaywallAttempt: vi.fn(), paywallMessage: vi.fn(() => 'pay'), RESUME_BASE: 'x' }));
vi.mock('./entitlements', () => ({ isProTool: vi.fn(() => false), isProForMcp: vi.fn(async () => true) }));
vi.mock('@/lib/search-history', () => ({ recordSearchAxes: vi.fn() }));
vi.mock('./flags', () => ({ mcpFlags: { enforceTiers: false, extractionGuard: false, extractionEnforce: false, oauth: true, aiHint: false } }));

const { runMeteredTool } = await import('./metered');
const { issueContinuation } = await import('./doc-continuation');
const payer = await import('./payer');
const credits = await import('./credits');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = (fn: unknown) => fn as any;

const USER = 'reader@example.com';
const W = [{ document_id: 'file-guide', offset: 20_000, limit: 20_000 }];

beforeAll(() => {
  process.env.MCP_OAUTH_SIGNING_SECRET = 'test-secret-metered';
});
beforeEach(() => vi.clearAllMocks());

describe('runMeteredTool — documents continuation pricing', () => {
  it('a verified continuation is not debited and is not refused for a low balance (3 < 10)', async () => {
    const out = await runMeteredTool('get_solicitation_documents', {
      notice_id: 'n', document_ids: ['file-guide'], documents: W, continuation: issueContinuation(USER, W, 1)!,
    }, { userEmail: USER, channel: 'chatgpt' });
    expect(out.ok).toBe(true);
    expect(out.creditsCharged).toBe(0);
    expect(m(payer.debitResolvedPayer)).not.toHaveBeenCalled();
    expect(m(credits.logCall).mock.calls.at(-1)[0]).toMatchObject({ status: 'success', creditsCharged: 0, channel: 'chatgpt' });
  });

  it('a first retrieval (no token) is a normal paid call — refused here only because balance 3 < 10', async () => {
    const out = await runMeteredTool('get_solicitation_documents', { notice_id: 'n' }, { userEmail: USER });
    expect(out.ok).toBe(false);
    expect(m(credits.logCall).mock.calls.at(-1)[0]).toMatchObject({ status: 'rejected_no_credits' });
  });

  it('a token presented by another user bills normally', async () => {
    const out = await runMeteredTool('get_solicitation_documents', {
      notice_id: 'n', document_ids: ['file-guide'], documents: W, continuation: issueContinuation(USER, W, 1)!,
    }, { userEmail: 'other@example.com' });
    expect(out.ok).toBe(false); // priced at 10 → refused at balance 3
  });

  it('with enough balance, a non-continuation call is debited the full price', async () => {
    m(credits.getBalance).mockResolvedValueOnce(100);
    const out = await runMeteredTool('get_solicitation_documents', { notice_id: 'n' }, { userEmail: USER });
    expect(out.ok).toBe(true);
    expect(m(payer.debitResolvedPayer).mock.calls[0][1]).toBe(10);
  });
});
