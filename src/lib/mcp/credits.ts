/**
 * Mindy MCP prepaid credits — balance, grant, atomic debit, call log.
 *
 * Phase 1 Slice 3. Integer credits meter MCP tool calls (Stripe $-conversion is
 * Slice 4). All money movement goes through the two Postgres functions
 * (mcp_debit_credits / mcp_grant_credits) so the decrement is atomic and 100
 * concurrent debits can't corrupt the balance — app code NEVER does read-then-write.
 * See migration 20260712_mcp_credit_ledger.sql.
 */
import { getWriteClient } from '@/lib/supabase/server-clients';

/** Free credits granted on a user's FIRST API key (env-tunable). */
export const SIGNUP_CREDITS = Math.max(0, Number(process.env.MCP_SIGNUP_CREDITS ?? '25') || 0);

/** Live balance for a user (0 if they have no balance row yet). */
export async function getBalance(userEmail: string): Promise<number> {
  const { data } = await getWriteClient()
    .from('mcp_credit_balance')
    .select('balance')
    .eq('user_email', userEmail.toLowerCase())
    .maybeSingle();
  return data?.balance ?? 0;
}

/**
 * Add credits atomically (Stripe top-up in Slice 4, signup grant, admin). Returns the
 * new balance. `reason` lands in the append-only ledger.
 */
export async function grantCredits(
  userEmail: string,
  amount: number,
  reason: string,
): Promise<number> {
  const { data, error } = await getWriteClient().rpc('mcp_grant_credits', {
    p_user: userEmail.toLowerCase(),
    p_amount: Math.floor(amount),
    p_reason: reason,
  });
  if (error) throw new Error(`grantCredits failed: ${error.message}`);
  return (data as number) ?? 0;
}

export interface DebitResult {
  ok: boolean; // false => insufficient balance (nothing debited)
  newBalance: number;
}

/**
 * Debit atomically. `ok=false` means insufficient balance — NOTHING was charged and
 * no ledger row was written. A cost of 0 is a no-op that always succeeds.
 */
export async function debitCredits(
  userEmail: string,
  amount: number,
  meta: { reason: string; toolName: string; apiKeyId?: string | null },
): Promise<DebitResult> {
  const { data, error } = await getWriteClient().rpc('mcp_debit_credits', {
    p_user: userEmail.toLowerCase(),
    p_amount: Math.floor(amount),
    p_reason: meta.reason,
    p_tool: meta.toolName,
    p_api_key_id: meta.apiKeyId ?? null,
  });
  if (error) throw new Error(`debitCredits failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: Boolean(row?.ok), newBalance: Number(row?.new_balance ?? 0) };
}

export type CallStatus = 'success' | 'failed' | 'rejected_no_credits' | 'uncharged';

/** Append a call-log row (audit/analytics/abuse). Best-effort — never throws. */
export async function logCall(entry: {
  userEmail: string;
  toolName: string;
  status: CallStatus;
  creditsCharged: number;
  latencyMs?: number;
  apiKeyId?: string | null;
}): Promise<void> {
  try {
    await getWriteClient().from('mcp_call_log').insert({
      user_email: entry.userEmail.toLowerCase(),
      tool_name: entry.toolName,
      status: entry.status,
      credits_charged: entry.creditsCharged,
      latency_ms: entry.latencyMs ?? null,
      api_key_id: entry.apiKeyId ?? null,
    });
  } catch (err) {
    console.error('[mcp:credits] logCall failed (non-fatal):', err);
  }
}

/**
 * Grant the one-time signup credits IF the user has no balance row yet (i.e. this is
 * their first key). Idempotent-ish: a user who already has a balance row (from a prior
 * key or a top-up) is NOT re-granted, so re-minting keys can't farm free credits.
 * Returns the granted amount (0 if not eligible or SIGNUP_CREDITS=0).
 */
export async function grantSignupCreditsIfFirst(userEmail: string): Promise<number> {
  if (SIGNUP_CREDITS <= 0) return 0;
  const { data } = await getWriteClient()
    .from('mcp_credit_balance')
    .select('user_email')
    .eq('user_email', userEmail.toLowerCase())
    .maybeSingle();
  if (data) return 0; // already has a balance row → not their first
  await grantCredits(userEmail, SIGNUP_CREDITS, 'signup_grant');
  return SIGNUP_CREDITS;
}

export interface ApplyCreditResult {
  applied: boolean; // false => this key was already applied (idempotent no-op)
  newBalance: number;
}

/**
 * Apply credits EXACTLY ONCE for an idempotency key (Slice 4). Safe under Stripe
 * webhook re-delivery + monthly-cron re-runs — the same key never grants twice.
 *   - Stripe top-up:   key = the checkout session id
 *   - Pro monthly:     key = `pro:<email>:<YYYY-MM>`
 */
export async function applyCreditOnce(
  idempotencyKey: string,
  userEmail: string,
  credits: number,
  reason: string,
): Promise<ApplyCreditResult> {
  const { data, error } = await getWriteClient().rpc('mcp_apply_credit', {
    p_key: idempotencyKey,
    p_user: userEmail.toLowerCase(),
    p_credits: Math.floor(credits),
    p_reason: reason,
  });
  if (error) throw new Error(`applyCreditOnce failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return { applied: Boolean(row?.applied), newBalance: Number(row?.new_balance ?? 0) };
}

