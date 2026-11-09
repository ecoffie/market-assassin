/**
 * Billing history rows for /mcp/account → Billing. Pure: no DB, no auth.
 *
 * The list must let a customer reconcile their balance:
 *
 *   sum(history credits) + sum(tool-call debits shown in Activity) = current balance
 *
 * It used to select ONLY additions (delta > 0), so administrative debits were invisible.
 * A customer who got the accidental 1,000 on 2026-07-15 and was reset to 200 on 2026-07-20
 * saw "+1,000 MCP Pro — monthly credits", "+100 signup" and a balance of 15, with ~285 of
 * tool calls in Activity. The missing −800 read as a renewal that had stopped
 * (Andre Llanos, 2026-11-09). Every non-tool-call ledger row now appears here, signed.
 *
 * Tool calls stay in Activity. They are the only ledger reason excluded.
 */

export const TOOL_CALL_REASON = 'tool_call';

/**
 * Every `pro_monthly` row written before GOS Decision #019 (2026-07-20) came from the
 * pre-policy audience: app access (KV `briefings:*`), not a recurring payment. On
 * 2026-07-15 that audience got 1,000 credits each (688 rows at 03:xx UTC, 24 more in the
 * 09:00 run), plus a few staff grants on 07-16/07-19. GOS #019 revoked or reset them.
 * None was a monthly entitlement, so none may be labelled as one. The first grant under
 * the recurring-payment policy ran on 2026-07-31, so the boundary has no real rows on it.
 */
const GOS_019_EFFECTIVE = Date.parse('2026-07-20T00:00:00Z');

export function isPrePolicyProGrant(reason: string, createdAt: string): boolean {
  return reason === 'pro_monthly' && Date.parse(createdAt) < GOS_019_EFFECTIVE;
}

/** Ledger reason → a label a person recognizes (credit additions). */
const GRANT_LABEL: Record<string, string> = {
  stripe_topup: 'Credit top-up',
  auto_recharge: 'Auto-recharge',
  pro_monthly: 'MCP Pro — monthly credits',
  mcp_sub_monthly: 'MCP Pro — monthly',
  mcp_sub_annual: 'MCP Pro — annual',
  signup_grant: 'Free signup credits',
  admin_grant: 'Complimentary credits',
  comp_monthly: 'Complimentary monthly credits',
};

/** Reasons that are administrative corrections in either direction, not grants. */
const ADJUSTMENT_LABEL: Record<string, string> = {
  member_credit_reset: 'Credit adjustment — balance reset',
  admin_revoke: 'Credit adjustment — grant reversed',
  admin_reversal: 'Credit adjustment — reversal',
  admin_transfer_out: 'Credit adjustment — transferred out',
  comp_reset: 'Credit adjustment — balance reset',
  pool_migration_out: 'Moved to team credit pool',
};

/** Genuinely-free grants (no purchase behind them). */
const FREE_REASONS = new Set(['signup_grant', 'admin_grant', 'comp_monthly']);

export interface LedgerRow {
  id: string;
  delta: number;
  reason: string;
  balance_after: number;
  created_at: string;
}

export interface BillingRow {
  id: string;
  date: string;
  reason: string;
  label: string;
  /** Signed: positive for a grant, negative for an administrative debit. */
  credits: number;
  balanceAfter: number;
  free: boolean;
  kind: 'grant' | 'adjustment';
}

function titleCase(reason: string): string {
  return reason.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export function billingLabel(reason: string, delta: number, createdAt: string): string {
  if (isPrePolicyProGrant(reason, createdAt)) return 'Pro credit grant';
  if (ADJUSTMENT_LABEL[reason]) return ADJUSTMENT_LABEL[reason];
  if (delta < 0) return 'Credit adjustment';
  return GRANT_LABEL[reason] ?? titleCase(reason);
}

export function toBillingRow(r: LedgerRow): BillingRow {
  const adjustment = r.delta < 0 || Boolean(ADJUSTMENT_LABEL[r.reason]);
  return {
    id: r.id,
    date: r.created_at,
    reason: r.reason,
    label: billingLabel(r.reason, r.delta, r.created_at),
    credits: r.delta,
    balanceAfter: r.balance_after,
    free: !adjustment && FREE_REASONS.has(r.reason),
    kind: adjustment ? 'adjustment' : 'grant',
  };
}

/** Every ledger row except tool calls, newest first (the caller's query order is kept). */
export function toBillingHistory(rows: LedgerRow[]): BillingRow[] {
  return rows.filter((r) => r.reason !== TOOL_CALL_REASON).map(toBillingRow);
}
