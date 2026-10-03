/**
 * runMeteredTool forwards the ChatGPT channel into the debit meta (so the personal debit
 * is attributed and can never trigger an auto-recharge), and adds NOTHING on the default
 * channel — the Claude edge's debit call is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./tool-registry', () => ({
  isMcpTool: vi.fn(() => true),
  creditsFor: vi.fn(() => 5),
  runMcpTool: vi.fn(async () => ({ result: { _meta: { grounded: true, degraded: false } }, credits: 5 })),
  isProprietaryTool: vi.fn(() => false),
  PROPRIETARY_TOOLS: new Set(),
}));
vi.mock('./credits', () => ({ getBalance: vi.fn(async () => 100), debitCredits: vi.fn(), logCall: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./payer', () => ({
  resolvePayer: vi.fn().mockResolvedValue({ kind: 'personal' }),
  isChargeable: () => true,
  getPoolBalance: vi.fn(),
  debitResolvedPayer: vi.fn(async () => ({ ok: true, newBalance: 95, payer: 'personal' })),
}));
vi.mock('./paywall', () => ({ recordPaywallAttempt: vi.fn(), paywallMessage: vi.fn(), RESUME_BASE: 'x' }));
vi.mock('./entitlements', () => ({ isProTool: vi.fn(() => false), isProForMcp: vi.fn(async () => true) }));
vi.mock('@/lib/search-history', () => ({ recordSearchAxes: vi.fn() }));
vi.mock('./flags', () => ({ mcpFlags: { enforceTiers: false, extractionGuard: false, extractionEnforce: false, oauth: true, aiHint: false } }));

const { runMeteredTool } = await import('./metered');
const payer = await import('./payer');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = (fn: unknown) => fn as any;

beforeEach(() => vi.clearAllMocks());

describe('runMeteredTool → debit meta', () => {
  it('chatgpt channel adds channel=chatgpt', async () => {
    await runMeteredTool('capability_market_match', { description: 'x' }, { userEmail: 'u@x.com', channel: 'chatgpt' });
    expect(m(payer.debitResolvedPayer).mock.calls[0][2]).toEqual({ reason: 'tool_call', toolName: 'capability_market_match', apiKeyId: undefined, channel: 'chatgpt' });
  });

  it('default (Claude) channel: meta has no channel key', async () => {
    await runMeteredTool('capability_market_match', { description: 'x' }, { userEmail: 'u@x.com', apiKeyId: 'k1' });
    const meta = m(payer.debitResolvedPayer).mock.calls[0][2];
    expect(meta).toEqual({ reason: 'tool_call', toolName: 'capability_market_match', apiKeyId: 'k1' });
    expect(Object.keys(meta)).not.toContain('channel');
  });
});
