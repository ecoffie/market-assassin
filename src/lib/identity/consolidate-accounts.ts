/**
 * Consolidate two Mindy accounts onto one account_id.
 *
 * Absorb B → keep A: sum MCP balances onto keep, repoint absorb rows' account_id.
 * Dry-run (preview) by default counts — execute writes. No customer-specific
 * billing remaps; both emails must already resolve to auth users.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizeEmail, resolveAccountId, type AccountId } from './account';

function getServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export interface ConsolidateResult {
  ok: boolean;
  mode: 'preview' | 'execute';
  keepAccountId: AccountId | null;
  absorbAccountId: AccountId | null;
  keepEmail: string;
  absorbEmail: string;
  keepBalance: number;
  absorbBalance: number;
  mergedBalance: number;
  stripeConflict: boolean;
  steps: Array<{ step: string; ok: boolean; detail?: string }>;
  error?: string;
}

export async function consolidateAccounts(input: {
  keepEmail: string;
  absorbEmail: string;
  mode: 'preview' | 'execute';
}): Promise<ConsolidateResult> {
  const keepEmail = normalizeEmail(input.keepEmail);
  const absorbEmail = normalizeEmail(input.absorbEmail);
  const client = getServiceClient();
  const steps: ConsolidateResult['steps'] = [];

  const empty = (error: string, extra?: Partial<ConsolidateResult>): ConsolidateResult => ({
    ok: false,
    mode: input.mode,
    keepAccountId: null,
    absorbAccountId: null,
    keepEmail,
    absorbEmail,
    keepBalance: 0,
    absorbBalance: 0,
    mergedBalance: 0,
    stripeConflict: false,
    steps,
    error,
    ...extra,
  });

  if (keepEmail === absorbEmail) {
    return empty('keep and absorb emails must differ');
  }

  const keepAccountId = await resolveAccountId(keepEmail, client);
  const absorbAccountId = await resolveAccountId(absorbEmail, client);
  if (!keepAccountId || !absorbAccountId) {
    return empty('both emails must resolve to an account_id', { keepAccountId, absorbAccountId });
  }
  if (keepAccountId === absorbAccountId) {
    return {
      ok: true,
      mode: input.mode,
      keepAccountId,
      absorbAccountId,
      keepEmail,
      absorbEmail,
      keepBalance: 0,
      absorbBalance: 0,
      mergedBalance: 0,
      stripeConflict: false,
      steps: [{ step: 'already-same-account', ok: true }],
    };
  }

  const keepBal = await balanceFor(client, keepAccountId, keepEmail);
  const absorbBal = await balanceFor(client, absorbAccountId, absorbEmail);
  const merged = keepBal + absorbBal;
  steps.push({ step: 'balances', ok: true, detail: `keep=${keepBal} absorb=${absorbBal} → ${merged}` });

  // Stripe conflict report (never auto-merge two active paid customers).
  const stripeConflict = await detectStripeConflict(keepEmail, absorbEmail);
  if (stripeConflict) {
    steps.push({
      step: 'stripe-conflict',
      ok: false,
      detail: 'both emails have active Stripe subscriptions — refuse execute; report only',
    });
  }

  if (input.mode === 'preview' || stripeConflict) {
    return {
      ok: !stripeConflict,
      mode: input.mode,
      keepAccountId,
      absorbAccountId,
      keepEmail,
      absorbEmail,
      keepBalance: keepBal,
      absorbBalance: absorbBal,
      mergedBalance: merged,
      stripeConflict,
      steps,
      error: stripeConflict ? 'active Stripe conflict — dry-run report only' : undefined,
    };
  }

  // Merge absorb credits onto keep balance row (prefer account_id row).
  const { data: keepRow } = await client
    .from('mcp_credit_balance')
    .select('user_email')
    .eq('account_id', keepAccountId)
    .maybeSingle();
  const keepBalanceEmail = keepRow?.user_email || keepEmail;

  const { error: upsertErr } = await client.from('mcp_credit_balance').upsert(
    {
      user_email: keepBalanceEmail,
      balance: merged,
      account_id: keepAccountId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_email' },
  );
  if (upsertErr) {
    steps.push({ step: 'merge-balance', ok: false, detail: upsertErr.message });
    return {
      ok: false,
      mode: 'execute',
      keepAccountId,
      absorbAccountId,
      keepEmail,
      absorbEmail,
      keepBalance: keepBal,
      absorbBalance: absorbBal,
      mergedBalance: merged,
      stripeConflict: false,
      steps,
      error: upsertErr.message,
    };
  }
  steps.push({ step: 'merge-balance', ok: true });

  // Remove absorb balance row(s) so unique(account_id) holds.
  await client.from('mcp_credit_balance').delete().eq('user_email', absorbEmail);
  await client.from('mcp_credit_balance').delete().eq('account_id', absorbAccountId).neq('user_email', keepBalanceEmail);

  // Repoint ledger / keys / topups / call log / autorecharge.
  for (const table of ['mcp_credit_ledger', 'mcp_api_keys', 'mcp_credit_topups', 'mcp_call_log', 'mcp_autorecharge'] as const) {
    const { error } = await client
      .from(table)
      .update({ account_id: keepAccountId, user_email: keepEmail })
      .eq('account_id', absorbAccountId);
    steps.push({ step: `repoint-${table}`, ok: !error, detail: error?.message });
  }
  for (const table of ['mcp_api_keys', 'mcp_autorecharge'] as const) {
    await client
      .from(table)
      .update({ account_id: keepAccountId, user_email: keepEmail })
      .eq('user_email', absorbEmail);
  }

  // Verified linked email so billing visibility still resolves absorb → keep.
  // This is NOT a grant remap — ownership stays on keepAccountId.
  const { error: linkErr } = await client.from('account_linked_emails').upsert(
    {
      owner_email: keepEmail,
      linked_email: absorbEmail,
      verified_at: new Date().toISOString(),
    },
    { onConflict: 'owner_email,linked_email' },
  );
  steps.push({ step: 'link-absorb-email', ok: !linkErr, detail: linkErr?.message || 'ok' });

  return {
    ok: true,
    mode: 'execute',
    keepAccountId,
    absorbAccountId,
    keepEmail,
    absorbEmail,
    keepBalance: keepBal,
    absorbBalance: absorbBal,
    mergedBalance: merged,
    stripeConflict: false,
    steps,
  };
}

async function balanceFor(client: SupabaseClient, accountId: AccountId, email: string): Promise<number> {
  const { data: byAcct } = await client
    .from('mcp_credit_balance')
    .select('balance')
    .eq('account_id', accountId)
    .maybeSingle();
  if (byAcct && typeof byAcct.balance === 'number') return byAcct.balance;
  const { data: byEmail } = await client
    .from('mcp_credit_balance')
    .select('balance')
    .eq('user_email', email)
    .maybeSingle();
  return byEmail?.balance ?? 0;
}

/** True when BOTH emails have ≥1 active Stripe subscription (conflicting paid owners). */
async function detectStripeConflict(keepEmail: string, absorbEmail: string): Promise<boolean> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return false;
  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(key);
    const countActive = async (email: string): Promise<number> => {
      const customers = await stripe.customers.list({ email, limit: 20 });
      let n = 0;
      for (const c of customers.data) {
        const subs = await stripe.subscriptions.list({ customer: c.id, status: 'active', limit: 5 });
        n += subs.data.length;
      }
      return n;
    };
    const [a, b] = await Promise.all([countActive(keepEmail), countActive(absorbEmail)]);
    return a > 0 && b > 0;
  } catch (err) {
    console.error('[identity] stripe conflict check failed:', err);
    // Fail open to preview-only: treat as conflict so execute cannot silently merge.
    return true;
  }
}
