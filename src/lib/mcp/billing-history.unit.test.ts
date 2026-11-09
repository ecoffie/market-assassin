import { describe, it, expect } from 'vitest';
import { toBillingHistory, billingLabel, isPrePolicyProGrant, type LedgerRow } from './billing-history';

/**
 * Billing history must RECONCILE with the balance:
 *
 *   sum(billing-history credits) + sum(tool-call debits, shown in Activity) = balance_after
 *
 * The fixture is the real ledger shape of the 2026-11-09 support case (identity removed):
 * the accidental 07-15 grant, the 07-20 GOS #019 reset, the one-time signup grant, then
 * tool calls. Before this test the route selected `delta > 0` only, so the −800 reset was
 * invisible and the customer read the gap as a monthly renewal that had stopped.
 */
let n = 0;
const row = (created_at: string, delta: number, reason: string, balance_after: number): LedgerRow =>
  ({ id: `r${++n}`, created_at, delta, reason, balance_after });

const ledgerOldestFirst: LedgerRow[] = [
  row('2026-07-15T03:10:30Z', 1000, 'pro_monthly', 1000),
  row('2026-07-20T15:21:26Z', -800, 'member_credit_reset', 200),
  row('2026-08-22T15:36:19Z', 100, 'signup_grant', 300),
  ...Array.from({ length: 31 }, (_, i) => row(`2026-08-22T16:${String(i).padStart(2, '0')}:00Z`, i === 30 ? -10 : -9, 'tool_call', 0)),
  row('2026-10-17T18:34:07Z', -5, 'tool_call', 15),
];
// Give the tool-call rows correct running balances.
{
  let bal = 0;
  for (const r of ledgerOldestFirst) { bal += r.delta; r.balance_after = bal; }
}
const newestFirst = [...ledgerOldestFirst].reverse();
const finalBalance = ledgerOldestFirst[ledgerOldestFirst.length - 1].balance_after;

describe('billing history reconciles with the balance', () => {
  const history = toBillingHistory(newestFirst);
  const toolDebits = ledgerOldestFirst.filter((r) => r.reason === 'tool_call').reduce((s, r) => s + r.delta, 0);

  it('history credits + Activity tool-call debits = current balance', () => {
    const shown = history.reduce((s, h) => s + h.credits, 0);
    expect(shown + toolDebits).toBe(finalBalance);
    expect(finalBalance).toBe(15);
  });

  it('shows the administrative reset as a signed adjustment', () => {
    const reset = history.find((h) => h.reason === 'member_credit_reset');
    expect(reset).toBeDefined();
    expect(reset!.credits).toBe(-800);
    expect(reset!.kind).toBe('adjustment');
    expect(reset!.free).toBe(false);
    expect(reset!.label).toMatch(/^Credit adjustment/);
  });

  it('never lists tool calls (those live in Activity)', () => {
    expect(history.some((h) => h.reason === 'tool_call')).toBe(false);
    expect(history).toHaveLength(3);
  });

  it('keeps newest-first order', () => {
    expect(history.map((h) => h.reason)).toEqual(['signup_grant', 'member_credit_reset', 'pro_monthly']);
  });

  it('the running balance on each row matches the ledger', () => {
    expect(history.map((h) => h.balanceAfter)).toEqual([300, 200, 1000]);
  });
});

describe('pre-GOS-#019 Pro grants are not labelled monthly', () => {
  it('relabels the 2026-07-15 03:xx accident batch as a Pro credit grant', () => {
    expect(isPrePolicyProGrant('pro_monthly', '2026-07-15T03:10:30.000+00:00')).toBe(true);
    expect(billingLabel('pro_monthly', 1000, '2026-07-15T03:10:30Z')).toBe('Pro credit grant');
    expect(billingLabel('pro_monthly', 1000, '2026-07-15T03:10:30Z')).not.toMatch(/monthly/i);
  });

  it('also relabels the same-day 09:00 run and the 07-16/07-19 grants (same pre-policy audience)', () => {
    for (const t of ['2026-07-15T09:01:00Z', '2026-07-16T09:00:00Z', '2026-07-19T10:53:00Z']) {
      expect(billingLabel('pro_monthly', 1000, t)).toBe('Pro credit grant');
    }
  });

  it('leaves grants under the recurring-payment policy (from 2026-07-31) unchanged', () => {
    expect(isPrePolicyProGrant('pro_monthly', '2026-07-31T09:01:00Z')).toBe(false);
    expect(billingLabel('pro_monthly', 1500, '2026-11-01T09:00:30Z')).toBe('MCP Pro — monthly credits');
  });

  it('only pro_monthly rows are affected', () => {
    expect(isPrePolicyProGrant('admin_grant', '2026-07-15T03:10:30Z')).toBe(false);
  });
});

describe('every administrative debit seen in production renders as an adjustment', () => {
  // Distinct negative non-tool-call reasons in the prod ledger on 2026-11-09.
  const prodNegativeReasons = ['admin_revoke', 'member_credit_reset', 'pool_migration_out', 'admin_transfer_out', 'comp_reset', 'p0_verify_set_balance', 'admin_reversal'];
  for (const reason of prodNegativeReasons) {
    it(`${reason} (negative) is a signed adjustment, never a grant`, () => {
      const [h] = toBillingHistory([row('2026-08-01T00:00:00Z', -50, reason, 0)]);
      expect(h.kind).toBe('adjustment');
      expect(h.credits).toBe(-50);
      expect(h.free).toBe(false);
    });
  }

  it('a positive balance-reset row is also an adjustment, not a free grant', () => {
    const [h] = toBillingHistory([row('2026-07-20T15:21:26Z', 50, 'member_credit_reset', 250)]);
    expect(h.kind).toBe('adjustment');
    expect(h.credits).toBe(50);
  });

  it('free grants keep their free badge', () => {
    const [h] = toBillingHistory([row('2026-08-22T15:36:19Z', 100, 'signup_grant', 100)]);
    expect(h).toMatchObject({ kind: 'grant', free: true, label: 'Free signup credits' });
  });
});
