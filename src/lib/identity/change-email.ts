/**
 * Verified primary-email change on a stable account_id.
 *
 * account_id (= auth.users.id) is preserved. MCP balances stay on the account_id
 * row — we only refresh denormalized user_email WHERE account_id = ?. Other
 * email-keyed tables still go through reKeyAccountEmail until they gain
 * account_id (dual-write window).
 *
 * ORDER MATTERS: do NOT update Auth/profile before reKeyAccountEmail — reKey's
 * collision guard treats an already-moved Auth email as "newEmail occupied".
 * MCP denorm-by-account_id runs first; reKey then moves Auth + remaining tables.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizeEmail, resolveAccountId, type AccountId } from './account';
import { reKeyAccountEmail, type ReKeyResult } from '@/lib/mindy/rekey-account-email';

const MCP_DENORM_TABLES = [
  'mcp_credit_balance',
  'mcp_credit_ledger',
  'mcp_credit_topups',
  'mcp_api_keys',
  'mcp_call_log',
  'mcp_autorecharge',
] as const;

function getServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export interface ChangeEmailAccountResult {
  ok: boolean;
  accountId: AccountId;
  oldEmail: string;
  newEmail: string;
  mcpDenormUpdated: number;
  reKey: ReKeyResult;
  error?: string;
}

/**
 * Change the primary email for an existing account_id.
 * Auth user id is preserved. MCP balance rows are NOT moved between accounts —
 * only user_email denorm is updated where account_id matches.
 */
export async function changeAccountPrimaryEmail(input: {
  accountId: AccountId;
  oldEmail: string;
  newEmail: string;
  mode: 'preview' | 'execute';
}): Promise<ChangeEmailAccountResult> {
  const oldEmail = normalizeEmail(input.oldEmail);
  const newEmail = normalizeEmail(input.newEmail);
  const client = getServiceClient();

  if (!oldEmail.includes('@') || !newEmail.includes('@') || oldEmail === newEmail) {
    return {
      ok: false,
      accountId: input.accountId,
      oldEmail,
      newEmail,
      mcpDenormUpdated: 0,
      reKey: { ok: false, mode: input.mode, oldEmail, newEmail, collision: false, steps: [] },
      error: 'Both emails required and must differ',
    };
  }

  // Collision: new address must not belong to a DIFFERENT account_id.
  const newAccountId = await resolveAccountId(newEmail, client);
  if (newAccountId && newAccountId !== input.accountId) {
    return {
      ok: false,
      accountId: input.accountId,
      oldEmail,
      newEmail,
      mcpDenormUpdated: 0,
      reKey: { ok: false, mode: input.mode, oldEmail, newEmail, collision: true, steps: [] },
      error: `${newEmail} already has a different account — route to consolidate`,
    };
  }

  if (input.mode === 'preview') {
    const reKey = await reKeyAccountEmail(oldEmail, newEmail, 'preview');
    const { count, error: countErr } = await client
      .from('mcp_credit_balance')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', input.accountId);
    if (countErr) {
      return {
        ok: false,
        accountId: input.accountId,
        oldEmail,
        newEmail,
        mcpDenormUpdated: 0,
        reKey,
        error: countErr.message,
      };
    }
    // count null with no error = unknown (missing relation) — never fabricate 0.
    if (count === null) {
      return {
        ok: false,
        accountId: input.accountId,
        oldEmail,
        newEmail,
        mcpDenormUpdated: 0,
        reKey,
        error: 'mcp_credit_balance count unknown (null) — refuse to treat as empty',
      };
    }
    return {
      ok: !reKey.collision,
      accountId: input.accountId,
      oldEmail,
      newEmail,
      mcpDenormUpdated: count,
      reKey,
    };
  }

  // 1) Denorm MCP email on account-scoped rows (balance stays on same account_id row).
  // For mcp_credit_balance this updates the PK column in place — credits do not move.
  let mcpDenormUpdated = 0;
  for (const table of MCP_DENORM_TABLES) {
    try {
      const { count, error } = await client
        .from(table)
        .update({ user_email: newEmail }, { count: 'exact' })
        .eq('account_id', input.accountId);
      if (error) {
        // Missing table/column (e.g. mcp_autorecharge absent) — skip.
        console.error(`[identity] mcp denorm ${table}:`, error.message);
        continue;
      }
      if (table === 'mcp_credit_balance') mcpDenormUpdated = count || 0;
    } catch (err) {
      console.error(`[identity] mcp denorm ${table}:`, err);
    }
  }

  // 2) Auth + profile + remaining email-keyed tables (KV, vault, alerts, …).
  // reKey updates Auth in place (same user id) and user_profiles.email.
  const reKey = await reKeyAccountEmail(oldEmail, newEmail, 'execute');

  return {
    ok: reKey.ok && !reKey.collision,
    accountId: input.accountId,
    oldEmail,
    newEmail,
    mcpDenormUpdated,
    reKey,
    error: reKey.collision
      ? 'collision'
      : reKey.ok
        ? undefined
        : 'rekey step failed',
  };
}
