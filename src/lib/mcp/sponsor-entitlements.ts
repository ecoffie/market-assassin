/**
 * Sponsor entitlements — recurring credits paid for by a SPONSOR, not the account holder.
 *
 * Why this exists as a table and not another hardcoded list: INTERNAL_TEAM_EMAILS and
 * ADVOCATE_ACCOUNTS record WHO gets comp credits but not WHY, who is paying, or when it
 * ends — so an arrangement that lapses keeps granting forever and nobody finds out. An
 * entitlement carries the sponsor, the allowance, and an expiry the query enforces.
 *
 * ⚠️ Read `sponsor_active_entitlements`, never the base table: the view applies status +
 * date bounds, so expiration cannot be forgotten by a caller.
 */
import { getWriteClient } from '@/lib/supabase/server-clients';

export interface SponsorEntitlement {
  userId: string;
  userEmail: string;
  sponsorName: string;
  monthlyAllowance: number;
  expiresOn: string;
}

/**
 * Every entitlement that is active TODAY. Errors are surfaced, never swallowed to an
 * empty list — "no sponsors" and "the query failed" must not look identical to the
 * grant cron, or a broken read silently skips every sponsored account.
 */
export async function activeSponsorEntitlements(): Promise<{
  entitlements: SponsorEntitlement[];
  error: string | null;
}> {
  const { data, error } = await getWriteClient()
    .from('sponsor_active_entitlements')
    .select('user_id, user_email, sponsor_name, monthly_allowance, expires_on');

  if (error) return { entitlements: [], error: error.message };

  const entitlements = (data ?? [])
    .filter((r) => r.user_email && Number(r.monthly_allowance) > 0)
    .map((r) => ({
      userId: String(r.user_id),
      userEmail: String(r.user_email).toLowerCase().trim(),
      sponsorName: String(r.sponsor_name),
      monthlyAllowance: Number(r.monthly_allowance),
      expiresOn: String(r.expires_on),
    }));

  return { entitlements, error: null };
}

/**
 * Atomic top-up to a ceiling: grants max(0, ceiling - balance) under a row lock, with
 * the shortfall computed INSIDE the same statement that writes it.
 *
 * Do not reimplement this as getBalance() + applyCreditOnce(): the idempotency key stops
 * a duplicate grant but does nothing about a balance that moved between the read and the
 * write, so the amount would be computed against a stale value.
 *
 * `applied=false` means another caller already claimed this key (the month is done).
 * `applied=true, granted=0` means the balance already met the ceiling — satisfied, nothing
 * owed. Those are different facts and callers must not collapse them.
 */
export async function topUpToCeiling(
  idempotencyKey: string,
  userEmail: string,
  ceiling: number,
  reason: string,
): Promise<{ applied: boolean; granted: number; newBalance: number }> {
  const { data, error } = await getWriteClient().rpc('mcp_topup_to_ceiling', {
    p_key: idempotencyKey,
    p_user: userEmail.toLowerCase(),
    p_ceiling: Math.floor(ceiling),
    p_reason: reason,
  });
  if (error) throw new Error(`topUpToCeiling failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    applied: Boolean(row?.applied),
    granted: Number(row?.granted ?? 0),
    newBalance: Number(row?.new_balance ?? 0),
  };
}
