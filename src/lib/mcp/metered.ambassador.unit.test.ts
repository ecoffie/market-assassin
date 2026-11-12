/**
 * Approved Mindy Ambassadors use Mindy without paying credits (owner decision 2026-11-12:
 * "Free Pro, truly unlimited"). runMeteredTool prices their calls at 0 before anything runs:
 * no balance check, no debit, the call still runs and is logged. Everyone else bills as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ambassadors/store', () => ({ isApprovedAmbassador: vi.fn(async () => false) }));
vi.mock('./tool-registry', () => ({
  isMcpTool: vi.fn(() => true),
  creditsFor: vi.fn(() => 50),
  runMcpTool: vi.fn(async () => ({ result: { _meta: { grounded: true, degraded: false } }, credits: 50 })),
  isProprietaryTool: vi.fn(() => false),
  PROPRIETARY_TOOLS: new Set(),
}));
vi.mock('./credits', () => ({ getBalance: vi.fn(async () => 0), debitCredits: vi.fn(), logCall: vi.fn().mockResolvedValue(undefined) }));
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
const store = await import('@/lib/ambassadors/store');
const payer = await import('./payer');
const credits = await import('./credits');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = (fn: unknown) => fn as any;

beforeEach(() => vi.clearAllMocks());

describe('runMeteredTool — Mindy Ambassadors are never charged', () => {
  it('an approved ambassador with a ZERO balance runs a 50-credit tool for free', async () => {
    m(store.isApprovedAmbassador).mockResolvedValueOnce(true);
    const out = await runMeteredTool('draft_proposal', { notice_id: 'n' }, { userEmail: 'amb@example.com' });
    expect(out.ok).toBe(true);
    expect(out.creditsCharged).toBe(0);
    expect(m(credits.getBalance)).not.toHaveBeenCalled();
    expect(m(payer.debitResolvedPayer)).not.toHaveBeenCalled();
    expect(m(credits.logCall).mock.calls.at(-1)[0]).toMatchObject({ userEmail: 'amb@example.com', status: 'success', creditsCharged: 0 });
  });

  it('anyone else with a zero balance is refused, exactly as before', async () => {
    const out = await runMeteredTool('draft_proposal', { notice_id: 'n' }, { userEmail: 'customer@example.com' });
    expect(out.ok).toBe(false);
    expect(m(credits.logCall).mock.calls.at(-1)[0]).toMatchObject({ status: 'rejected_no_credits' });
  });

  it('anyone else with a balance is debited the full price', async () => {
    m(credits.getBalance).mockResolvedValueOnce(500);
    const out = await runMeteredTool('draft_proposal', { notice_id: 'n' }, { userEmail: 'customer@example.com' });
    expect(out.ok).toBe(true);
    expect(m(payer.debitResolvedPayer).mock.calls[0][1]).toBe(50);
  });
});
