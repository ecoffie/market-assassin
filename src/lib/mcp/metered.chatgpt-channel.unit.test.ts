/**
 * runMeteredTool with channel 'chatgpt' — billing identical, commerce side effects absent.
 *
 *   · insufficient credits / requires Pro: recordPaywallAttempt is NOT called (no saved
 *     purchase retry), the message carries no link, continue_url is null
 *   · the default channel is unchanged: it still saves the attempt and builds the paywall
 *   · a successful ChatGPT call debits exactly like a Claude one (billing seam intact)
 *   · every ChatGPT call writes an `outcome` on its mcp_call_log row (#1777 telemetry),
 *     refusals included — the channel changes commerce copy, never the measurement
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./tool-registry', () => ({
  isMcpTool: vi.fn(() => true),
  creditsFor: vi.fn(() => 50),
  runMcpTool: vi.fn(),
  isProprietaryTool: vi.fn(() => false),
  PROPRIETARY_TOOLS: new Set(),
}));
vi.mock('./credits', () => ({ getBalance: vi.fn(), debitCredits: vi.fn(), logCall: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./payer', () => ({
  resolvePayer: vi.fn().mockResolvedValue({ kind: 'personal' }),
  isChargeable: () => true,
  getPoolBalance: vi.fn(),
  debitResolvedPayer: vi.fn(async () => ({ ok: true, newBalance: 5, payer: 'personal' })),
}));
const recordPaywallAttempt = vi.fn(async () => 'attempt-123');
vi.mock('./paywall', () => ({
  recordPaywallAttempt: (...a: unknown[]) => recordPaywallAttempt(...(a as [])),
  paywallMessage: vi.fn(() => 'Buy more → https://getmindy.ai/mcp/continue?attempt=attempt-123'),
  RESUME_BASE: 'https://getmindy.ai/mcp/continue',
}));
vi.mock('./entitlements', () => ({ isProTool: vi.fn(() => true), isProForMcp: vi.fn(async () => false) }));
vi.mock('@/lib/search-history', () => ({ recordSearchAxes: vi.fn() }));

const flags = { enforceTiers: false, extractionGuard: false, extractionEnforce: false, oauth: true, aiHint: false };
vi.mock('./flags', () => ({ mcpFlags: flags }));

const { runMeteredTool } = await import('./metered');
const credits = await import('./credits');
const registry = await import('./tool-registry');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = (fn: unknown) => fn as any;

beforeEach(() => {
  vi.clearAllMocks();
  flags.enforceTiers = false;
});

describe('insufficient credits', () => {
  it('chatgpt: no saved attempt, neutral message, no continue_url', async () => {
    m(credits.getBalance).mockResolvedValue(45);
    const r = await runMeteredTool('capability_market_match', { description: 'x' }, { userEmail: 'u@x.com', channel: 'chatgpt' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(recordPaywallAttempt).not.toHaveBeenCalled();
    expect(r.error.message).toBe('This request needs 50 credits and the account has 45. Nothing was charged. Account credits are managed outside this chat.');
    expect(r.error.commercial).toMatchObject({ required_credits: 50, available_credits: 45, continue_url: null, continuation_available: false });
    expect(registry.runMcpTool).not.toHaveBeenCalled();
    expect(credits.logCall).toHaveBeenCalledWith(expect.objectContaining({
      status: 'rejected_no_credits',
      outcome: expect.objectContaining({ outcome: 'blocked', errorCode: 'insufficient_credits' }),
    }));
  });

  it('default channel unchanged: saves the attempt and returns the paywall', async () => {
    m(credits.getBalance).mockResolvedValue(45);
    const r = await runMeteredTool('capability_market_match', { description: 'x' }, { userEmail: 'u@x.com' });
    if (r.ok) throw new Error('expected refusal');
    expect(recordPaywallAttempt).toHaveBeenCalledTimes(1);
    expect(r.error.commercial?.continue_url).toBe('https://getmindy.ai/mcp/continue?attempt=attempt-123');
  });
});

describe('requires_pro (tier enforcement on)', () => {
  it('chatgpt: no saved attempt, neutral message', async () => {
    flags.enforceTiers = true;
    const r = await runMeteredTool('get_winning_playbook', { topic: 'x' }, { userEmail: 'u@x.com', channel: 'chatgpt' });
    if (r.ok) throw new Error('expected refusal');
    expect(r.error.code).toBe('requires_pro');
    expect(recordPaywallAttempt).not.toHaveBeenCalled();
    expect(r.error.message).not.toMatch(/getmindy\.ai|buy|upgrade/i);
    expect(r.error.commercial?.continue_url).toBeNull();
    expect(credits.logCall).toHaveBeenCalledWith(expect.objectContaining({
      status: 'gated',
      outcome: expect.objectContaining({ outcome: 'blocked', errorCode: 'requires_pro' }),
    }));
  });
});

describe('billing seam intact on chatgpt', () => {
  it('debits on success exactly like the default channel', async () => {
    m(credits.getBalance).mockResolvedValue(100);
    m(registry.runMcpTool).mockResolvedValue({ result: { _meta: { grounded: true, degraded: false } }, credits: 50 });
    const r = await runMeteredTool('capability_market_match', { description: 'x' }, { userEmail: 'u@x.com', channel: 'chatgpt' });
    expect(r).toMatchObject({ ok: true, creditsCharged: 50, balance: 5, needsRecharge: true });
    expect(credits.logCall).toHaveBeenCalledWith(expect.objectContaining({
      status: 'success',
      creditsCharged: 50,
      outcome: expect.objectContaining({ outcome: 'grounded', grounded: true, degraded: false }),
    }));
    // needsRecharge is only a SIGNAL; the /chatgpt/mcp route ignores it (route.unit.test.ts)
  });
});

describe('outcome telemetry on the ChatGPT channel (#1777)', () => {
  it('a degraded empty result is logged as degraded and not charged', async () => {
    m(credits.getBalance).mockResolvedValue(100);
    m(registry.runMcpTool).mockResolvedValue({ result: { _meta: { grounded: false, degraded: true } }, credits: 50 });
    const r = await runMeteredTool('get_solicitation_documents', { notice_id: 'x' }, { userEmail: 'u@x.com', channel: 'chatgpt' });
    expect(r).toMatchObject({ ok: true, creditsCharged: 0 });
    const rows = m(credits.logCall).mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toMatchObject({ outcome: 'degraded' });
  });

  it('a thrown tool is logged with outcome error', async () => {
    m(credits.getBalance).mockResolvedValue(100);
    m(registry.runMcpTool).mockRejectedValue(new Error('boom'));
    await runMeteredTool('assess_market_depth', { naics: '238220' }, { userEmail: 'u@x.com', channel: 'chatgpt' });
    expect(credits.logCall).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed', outcome: expect.objectContaining({ outcome: 'error', errorCode: 'tool_exception' }),
    }));
  });
});
