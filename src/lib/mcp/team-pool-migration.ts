/**
 * How many of a Team subscriber's personal credits are still TEAM ENTITLEMENT?
 * (tasks/PRD-pooled-team-credits.md, decision 5: move only the remaining Team-entitlement
 * credits into the new pool; unrelated personal and purchased credits stay personal.)
 *
 * The balance is fungible, so "remaining Team credits" needs an attribution rule. This
 * replays the account's ledger oldest-first:
 *
 *   · a PURCHASE (stripe_topup, auto_recharge) adds to a separate purchased bucket;
 *   · any other positive entry is an ALLOWANCE LOT, tagged Team or not by `isTeamGrant`;
 *   · a debit spends ALLOWANCE first (the database's approved spend order, see
 *     20260915_credit_pools_purchased.sql), oldest lot first (FIFO), and only then
 *     purchased credits.
 *
 * What remains in Team-tagged lots is the Team entitlement. The move is additionally
 * capped by the account's REAL allowance (balance − purchased_balance), so the replay can
 * never move more than actually exists, and any disagreement between the replay and the
 * live balance is reported rather than hidden.
 */

export const PURCHASE_REASONS = new Set(['stripe_topup', 'auto_recharge']);

export interface LedgerEntry {
  created_at: string;
  delta: number;
  reason: string;
}

export interface TeamEntitlementReport {
  teamRemaining: number;
  otherAllowanceRemaining: number;
  purchasedRemaining: number;
  /** Allowance the replay ends with (team + other). */
  simulatedAllowance: number;
  teamGranted: number;
  entries: number;
}

export function computeTeamEntitlement(
  ledger: LedgerEntry[],
  isTeamGrant: (e: LedgerEntry) => boolean,
): TeamEntitlementReport {
  const rows = [...ledger].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const lots: { amount: number; team: boolean }[] = [];
  let purchased = 0;
  let teamGranted = 0;

  for (const e of rows) {
    const d = Math.trunc(Number(e.delta) || 0);
    if (d > 0) {
      if (PURCHASE_REASONS.has(e.reason)) purchased += d;
      else {
        const team = isTeamGrant(e);
        if (team) teamGranted += d;
        lots.push({ amount: d, team });
      }
      continue;
    }
    let owed = -d;
    while (owed > 0 && lots.length) {
      const lot = lots[0];
      const take = Math.min(lot.amount, owed);
      lot.amount -= take;
      owed -= take;
      if (lot.amount === 0) lots.shift();
    }
    if (owed > 0) purchased = Math.max(0, purchased - owed);
  }

  const teamRemaining = lots.filter((l) => l.team).reduce((s, l) => s + l.amount, 0);
  const otherAllowanceRemaining = lots.filter((l) => !l.team).reduce((s, l) => s + l.amount, 0);
  return {
    teamRemaining,
    otherAllowanceRemaining,
    purchasedRemaining: purchased,
    simulatedAllowance: teamRemaining + otherAllowanceRemaining,
    teamGranted,
    entries: rows.length,
  };
}

export interface TransferPlan {
  amount: number;
  /** Real allowance on the account right now: balance − purchased_balance. */
  actualAllowance: number;
  /** True when the replay disagrees with the live allowance (reported, never hidden). */
  replayMismatch: boolean;
  report: TeamEntitlementReport;
}

/** The amount to move: remaining Team entitlement, capped by the real allowance. */
export function planTeamTransfer(
  report: TeamEntitlementReport,
  balance: number,
  purchasedBalance: number,
): TransferPlan {
  const actualAllowance = Math.max(0, balance - purchasedBalance);
  return {
    amount: Math.max(0, Math.min(report.teamRemaining, actualAllowance)),
    actualAllowance,
    replayMismatch: report.simulatedAllowance !== actualAllowance,
    report,
  };
}
