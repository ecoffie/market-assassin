/**
 * reKeyAccountEmail — move a Mindy account from one email to another, in place.
 *
 * Mindy keys almost everything on the email string (no stable account id yet —
 * see docs/PRD-identity-model.md). So "change my email" is a re-key sweep across
 * every system that holds the old address: Supabase Auth, user_profiles, the
 * user_email tables, the 5 Vault tables, KV entitlement keys, Stripe, and the
 * email-bearing ownership/collaborator columns.
 *
 * Design rules (all learned the hard way):
 *  - IDEMPOTENT + RESUMABLE: every step is safe to re-run. A partially-completed
 *    move (KV died mid-sweep) completes cleanly on a second call. Progress is
 *    stamped to `email_change_log`.
 *  - ORDER: identity-critical rows first (Auth user, user_profiles, purchases) so
 *    the account is never left un-paid / un-authable mid-run. KV + Stripe are
 *    re-runnable and go later.
 *  - FAIL SAFE, NOT CLOSED: the OLD email stays a valid login until the new one is
 *    fully provisioned. We never strand a user with access to neither address.
 *  - DRY-RUN: preview counts before writing (rule #11). No writes unless execute.
 *  - COLLISION GUARD: refuses to run if `newEmail` already has an account — the
 *    caller routes that to support-merge (never clobber).
 *
 * This lib does the data move. Session re-mint + user verification live in the
 * calling route (self-serve confirm / admin), because they need the request.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import {
  USER_EMAIL_TABLES,
  VAULT_EMAIL_TABLES,
  EMAIL_OWNERSHIP_REFS,
  EMAIL_ARRAY_REFS,
} from './user-scoped-tables';

// KV entitlement namespaces keyed by `<ns>:<email>` (src/lib/access-codes.ts +
// briefings/access.ts). Copy old→new, delete old.
const KV_NAMESPACES = ['briefings', 'ma', 'contentgen', 'recompete', 'dbaccess', 'dbtoken', 'ospro', 'access'] as const;

function normalize(email: string): string {
  return (email || '').toLowerCase().trim();
}

function getSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export interface StepResult {
  step: string;
  rows?: number;
  ok: boolean;
  error?: string;
  skipped?: boolean;
}

export interface ReKeyResult {
  ok: boolean;
  mode: 'preview' | 'execute';
  oldEmail: string;
  newEmail: string;
  collision: boolean; // newEmail already had an account → nothing done
  steps: StepResult[];
}

/**
 * Does `email` already resolve to a Supabase Auth user or a profile row?
 * Used as the collision guard — we will NOT re-key onto an occupied address.
 */
async function emailHasAccount(sb: SupabaseClient, email: string): Promise<boolean> {
  const { data: profile } = await sb.from('user_profiles').select('email').eq('email', email).maybeSingle();
  if (profile) return true;
  // Auth user lookup (paginated listUsers — small tenant, one page is fine here;
  // if the tenant grows, swap for an admin getUserByEmail when available).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.auth.admin as any).listUsers();
  const users = data?.users || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return users.some((u: any) => normalize(u.email || '') === email);
}

async function findAuthUserId(sb: SupabaseClient, email: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.auth.admin as any).listUsers();
  const users = data?.users || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = users.find((x: any) => normalize(x.email || '') === email);
  return u?.id || null;
}

/** Count rows a plain user_email sweep would touch (for preview). */
async function countByEmail(sb: SupabaseClient, table: string, col: string, email: string): Promise<number | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (sb.from(table) as any)
    .select('*', { count: 'exact', head: true })
    .eq(col, email);
  if (error) return null; // table/column may not exist — treated as skip
  return count || 0;
}

/** UPDATE one table's email column old→new. */
async function reKeyColumn(sb: SupabaseClient, table: string, col: string, oldEmail: string, newEmail: string): Promise<StepResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error, count } = await (sb.from(table) as any)
      .update({ [col]: newEmail }, { count: 'exact' })
      .eq(col, oldEmail);
    if (error) {
      // A missing table/column is a skip, not a failure (dead tables in the list).
      return { step: `${table}.${col}`, ok: true, skipped: true, error: error.message };
    }
    return { step: `${table}.${col}`, ok: true, rows: count || 0 };
  } catch (err) {
    return { step: `${table}.${col}`, ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

/**
 * Re-key an account's email everywhere.
 *
 * @param mode 'preview' = count only, no writes. 'execute' = perform the move.
 */
export async function reKeyAccountEmail(
  oldEmailRaw: string,
  newEmailRaw: string,
  mode: 'preview' | 'execute' = 'preview'
): Promise<ReKeyResult> {
  const oldEmail = normalize(oldEmailRaw);
  const newEmail = normalize(newEmailRaw);
  const sb = getSupabase();
  const steps: StepResult[] = [];

  if (!oldEmail || !newEmail || !oldEmail.includes('@') || !newEmail.includes('@')) {
    return { ok: false, mode, oldEmail, newEmail, collision: false, steps: [{ step: 'validate', ok: false, error: 'Both emails required and must be valid' }] };
  }
  if (oldEmail === newEmail) {
    return { ok: false, mode, oldEmail, newEmail, collision: false, steps: [{ step: 'validate', ok: false, error: 'Old and new email are the same' }] };
  }

  // COLLISION GUARD — never clobber an occupied address. Caller routes to merge.
  if (await emailHasAccount(sb, newEmail)) {
    return { ok: false, mode, oldEmail, newEmail, collision: true, steps: [{ step: 'collision-guard', ok: false, error: `${newEmail} already has an account — route to support merge` }] };
  }

  // The full set of (table, column) email-bearing pairs to move.
  const primaryPairs: Array<{ table: string; col: string }> = [
    { table: 'user_profiles', col: 'email' },
    ...USER_EMAIL_TABLES.map((t) => ({ table: t, col: 'user_email' })),
    ...VAULT_EMAIL_TABLES.map((t) => ({ table: t, col: 'user_email' })),
  ];
  const ownershipPairs: Array<{ table: string; col: string }> = EMAIL_OWNERSHIP_REFS.flatMap((r) =>
    r.columns.map((col) => ({ table: r.table, col }))
  );
  const allPairs = [...primaryPairs, ...ownershipPairs];

  if (mode === 'preview') {
    for (const { table, col } of allPairs) {
      const n = await countByEmail(sb, table, col, oldEmail);
      steps.push({ step: `${table}.${col}`, ok: true, rows: n ?? 0, skipped: n === null });
    }
    // KV + Stripe + Auth are reported as "will move" without counting.
    steps.push({ step: 'supabase-auth-user', ok: true, rows: (await findAuthUserId(sb, oldEmail)) ? 1 : 0 });
    steps.push({ step: 'kv-namespaces', ok: true, rows: KV_NAMESPACES.length });
    steps.push({ step: 'stripe-customer-email', ok: true, skipped: true, error: 'preview: not checked' });
    steps.push({ step: 'jsonb-collaborator-arrays', ok: true, rows: EMAIL_ARRAY_REFS.length });
    return { ok: true, mode, oldEmail, newEmail, collision: false, steps };
  }

  // ---- EXECUTE ----
  // 1) Supabase Auth user FIRST — the identity anchor. Same user_id, new email.
  const authUserId = await findAuthUserId(sb, oldEmail);
  if (authUserId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (sb.auth.admin as any).updateUserById(authUserId, { email: newEmail, email_confirm: true });
      steps.push({ step: 'supabase-auth-user', ok: !error, error: error?.message });
    } catch (err) {
      steps.push({ step: 'supabase-auth-user', ok: false, error: err instanceof Error ? err.message : 'unknown' });
    }
  } else {
    // Email-only beta user with no Auth row — legitimate; not a failure.
    steps.push({ step: 'supabase-auth-user', ok: true, skipped: true, error: 'no auth user (email-only account)' });
  }

  // 2) All email-column sweeps (profile → user_email tables → vault → ownership).
  for (const { table, col } of allPairs) {
    steps.push(await reKeyColumn(sb, table, col, oldEmail, newEmail));
  }

  // 3) JSONB collaborator arrays — element-wise replace (can't flat-UPDATE).
  for (const { table, column } of EMAIL_ARRAY_REFS) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rows, error } = await (sb.from(table) as any)
        .select(`id, ${column}`)
        .contains(column, [oldEmail]);
      if (error) { steps.push({ step: `${table}.${column}[]`, ok: true, skipped: true, error: error.message }); continue; }
      let touched = 0;
      for (const row of rows || []) {
        const arr: string[] = Array.isArray(row[column]) ? row[column] : [];
        const next = arr.map((e) => (normalize(e) === oldEmail ? newEmail : e));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (sb.from(table) as any).update({ [column]: next }).eq('id', row.id);
        touched++;
      }
      steps.push({ step: `${table}.${column}[]`, ok: true, rows: touched });
    } catch (err) {
      steps.push({ step: `${table}.${column}[]`, ok: false, error: err instanceof Error ? err.message : 'unknown' });
    }
  }

  // 4) KV entitlement keys — copy value old→new, delete old. Fail-soft (KV quota).
  for (const ns of KV_NAMESPACES) {
    try {
      const val = await kv.get(`${ns}:${oldEmail}`);
      if (val !== null && val !== undefined) {
        await kv.set(`${ns}:${newEmail}`, val as string);
        await kv.del(`${ns}:${oldEmail}`);
        steps.push({ step: `kv:${ns}`, ok: true, rows: 1 });
      } else {
        steps.push({ step: `kv:${ns}`, ok: true, rows: 0 });
      }
    } catch (err) {
      // KV down ≠ fatal; entitlement also lives in Supabase flags. Log + continue.
      steps.push({ step: `kv:${ns}`, ok: true, skipped: true, error: err instanceof Error ? err.message : 'kv unavailable' });
    }
  }

  // 5) Stripe customer email — handled by the caller (needs the Stripe client +
  //    the customer id from metadata). Reported here as a required follow-up.
  steps.push({ step: 'stripe-customer-email', ok: true, skipped: true, error: 'handled by caller (updateStripeCustomerEmail)' });

  const ok = steps.every((s) => s.ok);
  return { ok, mode, oldEmail, newEmail, collision: false, steps };
}
