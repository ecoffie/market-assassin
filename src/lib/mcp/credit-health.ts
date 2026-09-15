/**
 * Credit-exhaustion DETECTION (2026-09-15).
 *
 * The gap this closes: Rochelle hit zero on 2026-09-11 and spent the next four days
 * generating 59 `rejected_no_credits` rows. Every one was recorded, and nobody saw any
 * of them — we learned she was blocked from an email. The data was never missing; the
 * WATCH was. This module is the watch.
 *
 * Detection only. It returns findings; it sends nothing. Callers decide what to do with
 * them, and outbound notification is gated off by default (Eric, 2026-09-15: "notification
 * emails must remain off").
 */
import { getWriteClient } from '@/lib/supabase/server-clients';

/** Warn once a sponsored/allowance account drops below this. */
export const LOW_BALANCE_THRESHOLD = 1600;

export interface CreditFinding {
  kind: 'low_balance' | 'exhausted';
  userEmail: string;
  balance: number;
  /** Rejections seen in the lookback window (exhausted findings only). */
  rejections?: number;
  sponsorName?: string;
  detail: string;
}

export interface CreditHealth {
  checkedAt: string;
  lowBalance: CreditFinding[];
  exhausted: CreditFinding[];
  /** Null when a source could not be read — NEVER silently 0 (Bug Prevention Rule #11). */
  sponsoredAccounts: number | null;
  errors: string[];
}

/**
 * Detect low-balance and exhaustion across accounts that carry a recurring allowance.
 *
 * Scope is deliberately sponsored accounts: they cannot self-serve a top-up (nobody is
 * holding a card), so exhaustion is OUR failure to notice rather than the customer's
 * choice not to buy. Paying users hitting zero is a billing prompt, a different signal.
 */
export async function collectCreditHealth(lookbackHours = 24): Promise<CreditHealth> {
  const db = getWriteClient();
  const errors: string[] = [];
  const lowBalance: CreditFinding[] = [];
  const exhausted: CreditFinding[] = [];
  let sponsoredAccounts: number | null = null;

  const { data: ents, error: entErr } = await db
    .from('sponsor_active_entitlements')
    .select('user_email, sponsor_name, monthly_allowance');

  if (entErr) {
    // Surface it. An unreadable source is UNKNOWN, not "no sponsored accounts" — the
    // distinction is the whole point of the silent-failure registry.
    errors.push(`sponsor_active_entitlements: ${entErr.message}`);
    return { checkedAt: new Date().toISOString(), lowBalance, exhausted, sponsoredAccounts, errors };
  }

  const rows = ents ?? [];
  sponsoredAccounts = rows.length;
  if (rows.length === 0) {
    return { checkedAt: new Date().toISOString(), lowBalance, exhausted, sponsoredAccounts, errors };
  }

  const emails = rows.map((r) => String(r.user_email).toLowerCase());
  const sponsorBy = new Map(rows.map((r) => [String(r.user_email).toLowerCase(), String(r.sponsor_name)]));

  const { data: balances, error: balErr } = await db
    .from('mcp_credit_balance')
    .select('user_email, balance')
    .in('user_email', emails);
  if (balErr) errors.push(`mcp_credit_balance: ${balErr.message}`);

  const balanceBy = new Map((balances ?? []).map((b) => [String(b.user_email).toLowerCase(), Number(b.balance)]));

  const since = new Date(Date.now() - lookbackHours * 3600_000).toISOString();
  const { data: rejects, error: rejErr } = await db
    .from('mcp_call_log')
    .select('user_email')
    .eq('status', 'rejected_no_credits')
    .gte('created_at', since)
    .in('user_email', emails);
  if (rejErr) errors.push(`mcp_call_log: ${rejErr.message}`);

  const rejectionBy = new Map<string, number>();
  for (const r of rejects ?? []) {
    const e = String(r.user_email).toLowerCase();
    rejectionBy.set(e, (rejectionBy.get(e) ?? 0) + 1);
  }

  for (const email of emails) {
    // A sponsored account with no balance row has never been granted — that is 0 for a
    // real reason (the row is created on first grant), not an unreadable source.
    const balance = balanceBy.get(email) ?? 0;
    const rejections = rejectionBy.get(email) ?? 0;
    const sponsorName = sponsorBy.get(email);

    if (rejections > 0) {
      exhausted.push({
        kind: 'exhausted', userEmail: email, balance, rejections, sponsorName,
        detail: `${rejections} credit rejection(s) in ${lookbackHours}h at balance ${balance}`,
      });
    } else if (balance < LOW_BALANCE_THRESHOLD) {
      lowBalance.push({
        kind: 'low_balance', userEmail: email, balance, sponsorName,
        detail: `balance ${balance} is below the ${LOW_BALANCE_THRESHOLD} warning threshold`,
      });
    }
  }

  return { checkedAt: new Date().toISOString(), lowBalance, exhausted, sponsoredAccounts, errors };
}

/**
 * Has this alert already fired for this account today? Dedupe is per account PER TYPE PER
 * DAY (Eric, 2026-09-15), so 59 rejections produce one notification rather than 59.
 *
 * Uses mcp_credit_topups as the claim ledger — the same ON CONFLICT DO NOTHING guard the
 * grant path relies on, so two concurrent checks cannot both claim the same alert.
 * credits=0 means it never touches a balance.
 */
export async function claimAlertOnce(kind: string, userEmail: string, day: string): Promise<boolean> {
  const { error } = await getWriteClient()
    .from('mcp_credit_topups')
    .insert({
      idempotency_key: `alert:${kind}:${userEmail.toLowerCase()}:${day}`,
      user_email: userEmail.toLowerCase(),
      credits: 0,
      reason: `alert_${kind}`,
    });
  // A duplicate-key violation means it already fired today — not an error, the answer is
  // "no". Any OTHER error must not silently suppress an alert, so it claims (fails open).
  if (error) return error.code !== '23505' ? true : false;
  return true;
}
