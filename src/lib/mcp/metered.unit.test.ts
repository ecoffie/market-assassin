import { describe, it, expect, vi, beforeEach } from 'vitest';

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
// PR 4A: runMeteredTool now resolves WHO PAYS before charging. Mocked to the
// production-today answer — zero pools exist, so every real caller is `personal` and
// `debitResolvedPayer` delegates straight to `debitCredits`. Mocking it this way keeps
// these tests asserting the SAME behaviour they always did (the personal path), which
// is exactly the regression this PR must not cause.
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

beforeEach(() => {
  vi.clearAllMocks();
  m(credits.logCall).mockResolvedValue(undefined);
  m(registry.isMcpTool).mockReturnValue(true);
});

describe('runMeteredTool', () => {
  it('rejects an unknown tool without running or charging', async () => {
    m(registry.isMcpTool).mockReturnValue(false);
    const r = await runMeteredTool('nope', {}, ctx);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.code).toBe('unknown_tool');
    expect(registry.runMcpTool).not.toHaveBeenCalled();
  });

  it('answers a RETIRED tool without running, pricing or charging it, and logs it as retired', async () => {
    m(registry.creditsFor).mockReturnValue(5);
    m(credits.getBalance).mockResolvedValue(100);
    const r = await runMeteredTool('search_sbir', { keyword: 'zero trust' }, ctx);
    expect(r).toMatchObject({ ok: false, creditsCharged: 0 });
    expect(r.ok === false && r.error.code).toBe('tool_retired');
    expect(r.ok === false && r.error.message).toMatch(/No credits were charged/);
    expect(registry.runMcpTool).not.toHaveBeenCalled();
    expect(credits.getBalance).not.toHaveBeenCalled();
    expect(credits.debitCredits).not.toHaveBeenCalled();
    expect(credits.logCall).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'search_sbir', status: 'retired', creditsCharged: 0 }));
  });

  it('rejects insufficient balance BEFORE running the tool (top-up message)', async () => {
    m(registry.creditsFor).mockReturnValue(5);
    m(credits.getBalance).mockResolvedValue(2);
    const r = await runMeteredTool('get_contractor_profile', {}, ctx);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.code).toBe('insufficient_credits');
    expect(registry.runMcpTool).not.toHaveBeenCalled();
    expect(credits.debitCredits).not.toHaveBeenCalled();
    expect(credits.logCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected_no_credits', creditsCharged: 0 }));
  });

  it('debits on success by exactly the tool price', async () => {
    m(registry.creditsFor).mockReturnValue(5);
    m(credits.getBalance).mockResolvedValue(10);
    m(registry.runMcpTool).mockResolvedValue({ result: { a: 1 }, credits: 5 });
    m(credits.debitCredits).mockResolvedValue({ ok: true, newBalance: 5 });
    const r = await runMeteredTool('get_contractor_profile', {}, ctx);
    expect(r).toMatchObject({ ok: true, creditsCharged: 5, balance: 5 });
    expect(credits.debitCredits).toHaveBeenCalledTimes(1);
    expect(credits.logCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', creditsCharged: 5 }));
  });

  it('a failed tool debits 0 and never calls debit', async () => {
    m(registry.creditsFor).mockReturnValue(5);
    m(credits.getBalance).mockResolvedValue(10);
    m(registry.runMcpTool).mockRejectedValue(new Error('boom'));
    const r = await runMeteredTool('get_contractor_profile', {}, ctx);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.code).toBe('tool_error');
    expect(r.creditsCharged).toBe(0);
    expect(credits.debitCredits).not.toHaveBeenCalled();
    expect(credits.logCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', creditsCharged: 0 }));
  });

  it('a free tool (cost 0) runs with no pre-check and no debit', async () => {
    m(registry.creditsFor).mockReturnValue(0);
    m(registry.runMcpTool).mockResolvedValue({ result: { balance: 3 }, credits: 0 });
    const r = await runMeteredTool('get_balance', {}, ctx);
    expect(r).toMatchObject({ ok: true, creditsCharged: 0 });
    expect(credits.getBalance).not.toHaveBeenCalled(); // no pre-check for free tools
    expect(credits.debitCredits).not.toHaveBeenCalled();
  });

  it('edge race: debit fails after a successful run → deliver result, charge 0, mark uncharged', async () => {
    m(registry.creditsFor).mockReturnValue(5);
    m(credits.getBalance).mockResolvedValue(10);
    m(registry.runMcpTool).mockResolvedValue({ result: { a: 1 }, credits: 5 });
    m(credits.debitCredits).mockResolvedValue({ ok: false, newBalance: 1 });
    const r = await runMeteredTool('get_contractor_profile', {}, ctx);
    expect(r).toMatchObject({ ok: true, creditsCharged: 0 });
    expect(credits.logCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'uncharged', creditsCharged: 0 }));
  });

  // capability_market_match charging contract (Eric 2026-09-15):
  // coverage timeout → degraded+!grounded → DEFECT-7 uncharged;
  // grounded core + omitted enrichment → full price (sections_omitted is not a discount).
  it('coverage-timeout shape (degraded && !grounded) is uncharged — DEFECT-7', async () => {
    m(registry.creditsFor).mockReturnValue(50);
    m(credits.getBalance).mockResolvedValue(100);
    m(registry.runMcpTool).mockResolvedValue({
      result: {
        market: null,
        _meta: { grounded: false, degraded: true, degraded_reason: 'deadline_exceeded' },
      },
      credits: 50,
    });
    const r = await runMeteredTool('capability_market_match', {}, ctx);
    expect(r).toMatchObject({ ok: true, creditsCharged: 0 });
    expect(credits.debitCredits).not.toHaveBeenCalled();
    expect(credits.logCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'uncharged', creditsCharged: 0 }));
  });

  it('grounded core + sections_omitted still bills the full tool price', async () => {
    m(registry.creditsFor).mockReturnValue(50);
    m(credits.getBalance).mockResolvedValue(100);
    m(registry.runMcpTool).mockResolvedValue({
      result: {
        market: { lead_keyword: 'cnc', total_market: 1 },
        competitors: [],
        _meta: {
          grounded: true,
          degraded: false,
          sections_omitted: ['competitors', 'forecasts'],
        },
      },
      credits: 50,
    });
    m(credits.debitCredits).mockResolvedValue({ ok: true, newBalance: 50 });
    const r = await runMeteredTool('capability_market_match', {}, ctx);
    expect(r).toMatchObject({ ok: true, creditsCharged: 50, balance: 50 });
    expect(credits.debitCredits).toHaveBeenCalledWith('u@x.com', 50, expect.anything());
    expect(credits.logCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', creditsCharged: 50 }));
  });
});
