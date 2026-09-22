/**
 * POTETO — Credit Integrity, LIVE LEDGER leg.
 *
 * The hermetic suite (credit-integrity.unit.test.ts) proves the REAL tools produce each
 * terminal state. This leg proves the MONEY: the real runMeteredTool against the real
 * `mcp_debit_credits` / `mcp_grant_credits` RPCs, `mcp_credit_ledger`, `mcp_call_log`.
 * Only the tool body is substituted (by the terminal-state shapes those tools return),
 * so no upstream is hit and nothing is ever forced to fail in production.
 *
 * Writes ONLY to one synthetic account that no customer owns. Opt-in:
 *   CREDIT_INTEGRITY_LIVE=1 npx vitest run src/lib/mcp/credit-integrity.live.test.ts
 * The concurrency case drains the account, so every run starts from a small balance.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const p of [
  resolve(process.cwd(), '.env.local'),
  resolve(process.cwd(), '../../../.env.local'),
  '/Users/ericcoffie/Market Assasin/market-assassin/.env.local',
]) {
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  break;
}
const LIVE = process.env.CREDIT_INTEGRITY_LIVE === '1'
  && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const next = vi.hoisted(() => ({ result: {} as Record<string, unknown> }));
vi.mock('./tool-registry', async (orig) => {
  const actual = await orig<typeof import('./tool-registry')>();
  return { ...actual, runMcpTool: vi.fn(async () => ({ result: next.result })) };
});
vi.mock('./paywall', () => ({ recordPaywallAttempt: vi.fn(async () => null), paywallMessage: () => 'top up', RESUME_BASE: '' }));
vi.mock('@/lib/search-history', () => ({ recordSearchAxes: vi.fn() }));

// Dynamic: server-clients captures env at import time, and static imports are hoisted
// above the loader above.
const { runMeteredTool } = await import('./metered');
const { getBalance, grantCredits } = await import('./credits');
const { runMcpTool } = await import('./tool-registry');
const { getWriteClient } = await import('@/lib/supabase/server-clients');

const ACCOUNT = 'credit-integrity-acceptance@getmindy.ai';
const ctx = { userEmail: ACCOUNT, apiKeyId: null };

// Terminal-state shapes, as the real tools emit them (see the hermetic suite).
const DOSSIER_OK = { subject: 'x', _meta: { grounded: true, degraded: false } };
const DOSSIER_ANCHOR_FAILED = { _meta: { grounded: false, degraded: true, billing_outcome: 'nonbillable_system_failure' } };
const REPORT = (state: string, extra: Record<string, unknown> = {}) => ({
  deliverable: { url: state === 'publish' ? 'https://getmindy.ai/reports/x' : null },
  _meta: { grounded: true, degraded: state === 'measurement_failure', publication_state: state, ...extra },
});

async function ledgerSince(t0: string) {
  const { data, error } = await getWriteClient().from('mcp_credit_ledger')
    .select('delta, reason, tool_name, created_at').eq('user_email', ACCOUNT).gt('created_at', t0).order('created_at');
  if (error) throw error;
  return data ?? [];
}
async function callsSince(t0: string) {
  const { data, error } = await getWriteClient().from('mcp_call_log')
    .select('tool_name, status, credits_charged, created_at').eq('user_email', ACCOUNT).gt('created_at', t0).order('created_at');
  if (error) throw error;
  return data ?? [];
}

describe.skipIf(!LIVE)('Credit Integrity — real ledger', () => {
  let t0 = '';
  let b0 = 0;
  const GRANT = 700;

  beforeAll(async () => {
    t0 = new Date(Date.now() - 1000).toISOString();
    b0 = await getBalance(ACCOUNT);
    await grantCredits(ACCOUNT, GRANT, 'admin_grant');
  }, 30_000);

  it('four terminal states + replay reconcile exactly against the ledger', async () => {
    const steps: [string, string, Record<string, unknown>, Record<string, unknown> | null, number][] = [
      ['invalid dossier (gold master)', 'build_pursuit_dossier', { solicitation: '36C24226Q0857' }, null, 0],
      ['valid dossier', 'build_pursuit_dossier', { solicitation_number: '36C24226Q0857' }, DOSSIER_OK, 100],
      ['dossier anchor failed', 'build_pursuit_dossier', { solicitation_number: '36C24226Q0857' }, DOSSIER_ANCHOR_FAILED, 0],
      ['report publish', 'generate_market_report', { keyword: 'drones' }, REPORT('publish'), 100],
      ['report insufficient_evidence', 'generate_market_report', { keyword: 'x' }, REPORT('insufficient_evidence'), 100],
      ['report measurement_failure', 'generate_market_report', { keyword: 'drones' }, REPORT('measurement_failure', { billing_outcome: 'nonbillable_system_failure' }), 0],
      ['replay 1', 'generate_market_report', { keyword: 'drones' }, REPORT('measurement_failure', { billing_outcome: 'nonbillable_system_failure' }), 0],
      ['replay 2', 'generate_market_report', { keyword: 'drones' }, REPORT('measurement_failure', { billing_outcome: 'nonbillable_system_failure' }), 0],
    ];
    const trace: string[] = [];
    for (const [label, tool, args, result, cost] of steps) {
      const before = await getBalance(ACCOUNT);
      if (result) next.result = result;
      const r = await runMeteredTool(tool, args, ctx);
      const after = await getBalance(ACCOUNT);
      trace.push(`${label}: ${before} → ${after} (charged ${r.creditsCharged})`);
      expect(r.creditsCharged, label).toBe(cost);
      expect(before - after, label).toBe(cost);
    }
    console.error(`[credit-integrity live] b0=${b0}\n  ${trace.join('\n  ')}`);
    expect(vi.mocked(runMcpTool)).toHaveBeenCalledTimes(7); // the invalid call never executed

    const rows = await ledgerSince(t0);
    expect(rows.filter((r) => r.delta > 0)).toEqual([expect.objectContaining({ delta: GRANT, reason: 'admin_grant' })]);
    const debits = rows.filter((r) => r.delta < 0);
    expect(debits.map((r) => [r.delta, r.reason, r.tool_name])).toEqual([
      [-100, 'tool_call', 'build_pursuit_dossier'],
      [-100, 'tool_call', 'generate_market_report'],
      [-100, 'tool_call', 'generate_market_report'],
    ]);
    expect(await getBalance(ACCOUNT)).toBe(b0 + GRANT - 300);

    const calls = await callsSince(t0);
    expect(calls.map((c) => [c.status, c.credits_charged])).toEqual([
      ['rejected_invalid_input', 0], ['success', 100], ['uncharged', 0], ['success', 100],
      ['success', 100], ['uncharged', 0], ['uncharged', 0], ['uncharged', 0],
    ]);
  }, 120_000);

  it('concurrent billable calls cannot overdraw: balance never negative, debits == ledger', async () => {
    const start = await getBalance(ACCOUNT);
    const payable = Math.floor(start / 100);
    const t1 = new Date(Date.now() - 1000).toISOString();
    next.result = REPORT('publish');
    const billable = Array.from({ length: payable + 3 }, () => runMeteredTool('generate_market_report', { keyword: 'drones' }, ctx));
    const [outcomes] = await Promise.all([Promise.all(billable)]);
    const charged = outcomes.reduce((s, o) => s + o.creditsCharged, 0);
    const end = await getBalance(ACCOUNT);
    console.error(`[credit-integrity live] concurrency: start=${start} calls=${payable + 3} charged=${charged} end=${end}`);
    expect(end).toBeGreaterThanOrEqual(0);
    expect(charged).toBe(payable * 100);
    expect(start - end).toBe(charged);
    const rows = await ledgerSince(t1);
    expect(rows.reduce((s, r) => s + r.delta, 0)).toBe(-charged);
  }, 120_000);
});
