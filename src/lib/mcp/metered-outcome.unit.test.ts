import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase 0 (tool portfolio audit, 2026-10-02): every mcp_call_log row carries an OUTCOME
 * read from the tool's structured result, and a call that did no research is not billed.
 *
 * Same mocking shape as metered.unit.test.ts (personal payer, mocked registry/credits).
 */
vi.mock('./tool-registry', () => ({
  isMcpTool: vi.fn(),
  creditsFor: vi.fn(),
  runMcpTool: vi.fn(),
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
  debitResolvedPayer: vi.fn(async (email: string, amount: number, meta: unknown) => {
    const { debitCredits } = await import('./credits');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (debitCredits as any)(email, amount, meta);
    return { ...r, payer: 'personal' };
  }),
}));

import { runMeteredTool } from './metered';
import * as registry from './tool-registry';
import * as credits from './credits';

const ctx = { userEmail: 'u@x.com', apiKeyId: 'k1' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = (fn: unknown) => fn as any;

function lastLog(): Record<string, unknown> {
  const calls = m(credits.logCall).mock.calls;
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  m(credits.logCall).mockResolvedValue(undefined);
  m(registry.isMcpTool).mockReturnValue(true);
  m(registry.creditsFor).mockReturnValue(10);
  m(credits.getBalance).mockResolvedValue(100);
  m(credits.debitCredits).mockResolvedValue({ ok: true, newBalance: 90 });
});

async function run(result: Record<string, unknown>, name = 'some_tool') {
  m(registry.runMcpTool).mockResolvedValue({ result, credits: 10 });
  return runMeteredTool(name, {}, ctx);
}

describe('outcome telemetry on every row', () => {
  it('grounded result → billed, outcome grounded', async () => {
    const r = await run({ rows: [1], _meta: { grounded: true, degraded: false } });
    expect(r).toMatchObject({ ok: true, creditsCharged: 10 });
    expect(lastLog()).toMatchObject({
      status: 'success',
      creditsCharged: 10,
      outcome: { outcome: 'grounded', grounded: true, degraded: false, billingOutcome: 'billable_success', errorCode: null },
    });
  });

  it('honest empty → still billed (a paid research answer), outcome no_result', async () => {
    const r = await run({ rows: [], _meta: { grounded: false, degraded: false } });
    expect(r).toMatchObject({ ok: true, creditsCharged: 10 });
    expect(lastLog()).toMatchObject({ status: 'success', outcome: { outcome: 'no_result', billingOutcome: 'billable_no_result' } });
  });

  it('degraded + empty → not billed, outcome degraded', async () => {
    const r = await run({ rows: [], _meta: { grounded: false, degraded: true } });
    expect(r).toMatchObject({ ok: true, creditsCharged: 0 });
    expect(credits.debitCredits).not.toHaveBeenCalled();
    expect(lastLog()).toMatchObject({ status: 'uncharged', outcome: { outcome: 'degraded', degraded: true } });
  });

  it('a result with no structured signal is UNCLASSIFIED, never assumed grounded', async () => {
    await run({ some: 'prose' });
    expect(lastLog()).toMatchObject({ status: 'success', outcome: { outcome: 'unclassified', grounded: null, degraded: null } });
  });

  it('a thrown tool → status failed, outcome error, no message stored', async () => {
    m(registry.runMcpTool).mockRejectedValue(new Error('secret user text in message'));
    const r = await runMeteredTool('some_tool', {}, ctx);
    expect(r.ok).toBe(false);
    const row = lastLog();
    expect(row).toMatchObject({ status: 'failed', outcome: { outcome: 'error', errorCode: 'tool_exception' } });
    expect(JSON.stringify(row)).not.toContain('secret user text');
  });

  it('insufficient credits → outcome blocked/insufficient_credits, tool never runs', async () => {
    m(credits.getBalance).mockResolvedValue(2);
    await runMeteredTool('some_tool', {}, ctx);
    expect(registry.runMcpTool).not.toHaveBeenCalled();
    expect(lastLog()).toMatchObject({ status: 'rejected_no_credits', outcome: { outcome: 'blocked', errorCode: 'insufficient_credits' } });
  });

  it('input preflight refusal → outcome blocked/invalid_input', async () => {
    await runMeteredTool('build_pursuit_dossier', {}, ctx);
    expect(lastLog()).toMatchObject({ status: 'rejected_invalid_input', outcome: { outcome: 'blocked', errorCode: 'invalid_input' } });
  });

  it('free tool still records its outcome', async () => {
    m(registry.creditsFor).mockReturnValue(0);
    await run({ balance: 5, count: 1 }, 'get_balance');
    expect(lastLog()).toMatchObject({ status: 'success', creditsCharged: 0, outcome: { outcome: 'grounded' } });
  });
});

describe('no-op billing: a call that did no research is never charged', () => {
  const NOOPS: Array<[string, Record<string, unknown>, string, string]> = [
    // [label, result, expected outcome, expected error_code]
    ['tier-1 missing keyword', { ok: false, error: 'keyword_required', count: 0, items: [] }, 'refused', 'keyword_required'],
    ['tier-1 unknown set-aside', { ok: false, error: 'unknown_set_aside', message: 'x', count: 0, items: [] }, 'refused', 'unknown_set_aside'],
    ['tier-1 SAM unavailable', { ok: false, error: 'sam_unavailable', count: 0, items: [] }, 'degraded', 'sam_unavailable'],
    ['tier-2 rate limited', { ok: false, error: 'rate_limited', count: 0, items: [] }, 'degraded', 'rate_limited'],
    ['tier-2 lookup failed', { ok: false, found: false, resolution: 'lookup_failed', error: 'lookup_failed' }, 'degraded', 'lookup_failed'],
    ['validation_error (pricing/no input)', { _meta: { grounded: false, degraded: false, validation_error: 'no_input' } }, 'refused', 'no_input'],
    ['CRM not connected', { connected: false, _meta: { grounded: false, degraded: false, connected: false, count: 0, billing_outcome: 'nonbillable_not_configured' } }, 'refused', 'not_configured'],
  ];

  for (const [label, result, outcome, code] of NOOPS) {
    it(`${label} → 0 credits, status uncharged, outcome ${outcome}`, async () => {
      const r = await run(result);
      expect(r).toMatchObject({ ok: true, creditsCharged: 0 });
      expect(credits.debitCredits).not.toHaveBeenCalled();
      expect(lastLog()).toMatchObject({ status: 'uncharged', creditsCharged: 0, outcome: { outcome, errorCode: code } });
    });
  }

  it('an ok:false result is not billed even when the tool is priced high', async () => {
    m(registry.creditsFor).mockReturnValue(100);
    const r = await run({ ok: false, error: 'company_name_required' });
    expect(r).toMatchObject({ ok: true, creditsCharged: 0 });
  });
});
