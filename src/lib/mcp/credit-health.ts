/**
 * Credit-exhaustion DETECTION — FLEET-WIDE (2026-09-15).
 *
 * The gap this closes: an account hit zero on 2026-09-11 and spent four days generating
 * `rejected_no_credits` rows. Every one was recorded and nobody saw any of them — we
 * learned from an email. The data was never missing; the WATCH was.
 *
 * ⚠️ SCOPE WIDENED (Eric, 2026-09-15). This first shipped covering only sponsored
 * accounts, on the reasoning that a paying user hitting zero is "a billing prompt, a
 * different signal." The paywall funnel refuted that: across 331 generated paywall
 * responses to 43 accounts, checkout was reached 3 times and produced 0 payments. A
 * blocked paying customer is NOT reliably self-serving, so excluding them from the watch
 * reproduces the original blind spot on a different population.
 *
 * Detection only. It returns findings; it sends nothing. Outbound notification is gated
 * off by default — "notifications off" must never silently become "detection off".
 */
import { getWriteClient } from '@/lib/supabase/server-clients';

/** Warn once an account carrying a recurring allowance drops below this. */
export const LOW_BALANCE_THRESHOLD = 1600;

/**
 * How an account's credits are funded. Drives triage, NOT eligibility for the watch —
 * every kind is watched.
 *   entitled  — an active sponsor_entitlements row (sponsored/advocate/comp/staff)
 *   paid      — has ever received a paid-subscription or top-up grant
 *   courtesy  — only one-off manual/administrative grants
 *   free      — signup grant only
 */
export type AccountKind = 'entitled' | 'paid' | 'courtesy' | 'free';

export interface CreditFinding {
  kind: 'low_balance' | 'exhausted';
  accountKind: AccountKind;
  userEmail: string;
  balance: number;
  /** Blocked calls in the lookback window (exhausted findings only). */
  rejections?: number;
  /** Distinct paywall responses GENERATED in the window — not proof a human saw them. */
  paywallResponses?: number;
  sponsorName?: string;
  detail: string;
}

export interface CreditHealth {
  checkedAt: string;
  lookbackHours: number;
  lowBalance: CreditFinding[];
  exhausted: CreditFinding[];
  /** Null when a source could not be read — NEVER silently 0 (Bug Prevention Rule #11). */
  sponsoredAccounts: number | null;
  /** Accounts examined this pass; null if the population could not be established. */
  accountsChecked: number | null;
  errors: string[];
}

/** Grant reasons that evidence the account has PAID us (directly or via subscription). */
const PAID_REASONS = new Set(['stripe_topup', 'auto_recharge', 'subscription', 'mcp_sub_monthly', 'mcp_sub_annual']);
/** Reasons the system issues on its own to any signup. */
const FREE_REASONS = new Set(['signup_grant']);

/**
 * Detect low-balance and exhaustion across EVERY account with recent blocked calls or a
 * recurring allowance. Errors are surfaced, never swallowed to an empty list — "nothing
 * wrong" and "the query failed" must not look identical.
 */
export async function collectCreditHealth(lookbackHours = 24): Promise<CreditHealth> {
  const db = getWriteClient();
  const errors: string[] = [];
  const lowBalance: CreditFinding[] = [];
  const exhausted: CreditFinding[] = [];
  let sponsoredAccounts: number | null = null;
  let accountsChecked: number | null = null;
  const since = new Date(Date.now() - lookbackHours * 3600_000).toISOString();

  // ── Population 1: everyone carrying an entitlement (expiry already applied by the view).
  const { data: ents, error: entErr } = await db
    .from('sponsor_active_entitlements')
    .select('user_email, sponsor_name, monthly_allowance');
  if (entErr) errors.push(`sponsor_active_entitlements: ${entErr.message}`);
  else sponsoredAccounts = (ents ?? []).length;

  const sponsorBy = new Map<string, string>();
  for (const e of ents ?? []) sponsorBy.set(String(e.user_email).toLowerCase(), String(e.sponsor_name));

  // ── Population 2: everyone BLOCKED in the window, regardless of how they are funded.
  const { data: rejects, error: rejErr } = await db
    .from('mcp_call_log')
    .select('user_email')
    .eq('status', 'rejected_no_credits')
    .gte('created_at', since);
  if (rejErr) errors.push(`mcp_call_log: ${rejErr.message}`);

  const rejectionBy = new Map<string, number>();
  for (const r of rejects ?? []) {
    const e = String(r.user_email).toLowerCase();
    rejectionBy.set(e, (rejectionBy.get(e) ?? 0) + 1);
  }

  // If BOTH sources failed we know nothing — say so rather than report a clean sweep.
  if (entErr && rejErr) {
    return { checkedAt: new Date().toISOString(), lookbackHours, lowBalance, exhausted, sponsoredAccounts, accountsChecked, errors };
  }

  const emails = [...new Set([...sponsorBy.keys(), ...rejectionBy.keys()])];
  accountsChecked = emails.length;
  if (emails.length === 0) {
    return { checkedAt: new Date().toISOString(), lookbackHours, lowBalance, exhausted, sponsoredAccounts, accountsChecked, errors };
  }

  // Balances (chunked — `.in()` on a long list is a real limit, not a hypothetical one).
  const balanceBy = new Map<string, number>();
  for (let i = 0; i < emails.length; i += 100) {
    const { data, error } = await db.from('mcp_credit_balance')
      .select('user_email, balance').in('user_email', emails.slice(i, i + 100));
    if (error) { errors.push(`mcp_credit_balance: ${error.message}`); break; }
    for (const b of data ?? []) balanceBy.set(String(b.user_email).toLowerCase(), Number(b.balance));
  }

  // Funding history → account kind.
  const kindBy = new Map<string, AccountKind>();
  for (let i = 0; i < emails.length; i += 100) {
    const { data, error } = await db.from('mcp_credit_ledger')
      .select('user_email, reason').gt('delta', 0).in('user_email', emails.slice(i, i + 100));
    if (error) { errors.push(`mcp_credit_ledger: ${error.message}`); break; }
    for (const r of data ?? []) {
      const e = String(r.user_email).toLowerCase();
      const reason = String(r.reason);
      const prev = kindBy.get(e);
      if (sponsorBy.has(e)) { kindBy.set(e, 'entitled'); continue; }
      if (PAID_REASONS.has(reason)) { kindBy.set(e, 'paid'); continue; }
      if (prev === 'paid') continue;
      kindBy.set(e, FREE_REASONS.has(reason) ? (prev ?? 'free') : 'courtesy');
    }
  }

  // Paywall responses GENERATED in the window. Deliberately NOT called "offers seen":
  // a generated response is a server event; whether a human ever saw it is unverified.
  const paywallBy = new Map<string, number>();
  {
    const { data, error } = await db.from('mcp_paywall_attempts')
      .select('user_email').gte('rejected_at', since);
    if (error) errors.push(`mcp_paywall_attempts: ${error.message}`);
    for (const r of data ?? []) {
      const e = String(r.user_email).toLowerCase();
      paywallBy.set(e, (paywallBy.get(e) ?? 0) + 1);
    }
  }

  for (const email of emails) {
    const balance = balanceBy.get(email) ?? 0;
    const rejections = rejectionBy.get(email) ?? 0;
    const accountKind = kindBy.get(email) ?? (sponsorBy.has(email) ? 'entitled' : 'free');
    const sponsorName = sponsorBy.get(email);
    const paywallResponses = paywallBy.get(email);

    if (rejections > 0) {
      exhausted.push({
        kind: 'exhausted', accountKind, userEmail: email, balance, rejections, paywallResponses, sponsorName,
        detail: `${rejections} blocked call(s) in ${lookbackHours}h at balance ${balance} [${accountKind}]`,
      });
    } else if (sponsorBy.has(email) && balance < LOW_BALANCE_THRESHOLD) {
      // Low-balance warning applies to allowance-backed accounts, where a floor is
      // meaningful. A free account sitting near zero is the normal resting state.
      lowBalance.push({
        kind: 'low_balance', accountKind, userEmail: email, balance, sponsorName,
        detail: `balance ${balance} is below the ${LOW_BALANCE_THRESHOLD} warning threshold [${accountKind}]`,
      });
    }
  }

  return { checkedAt: new Date().toISOString(), lookbackHours, lowBalance, exhausted, sponsoredAccounts, accountsChecked, errors };
}

/**
 * Has this alert already fired for this account today? Dedupe is per account PER TYPE PER
 * DAY, so a retry loop producing 57 blocked calls yields one notification, not 57.
 *
 * Uses mcp_credit_topups as the claim ledger — the same ON CONFLICT DO NOTHING guard the
 * grant path relies on, so two concurrent checks cannot both claim. credits=0 means it
 * never touches a balance.
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
  if (error) return error.code !== '23505';
  return true;
}
