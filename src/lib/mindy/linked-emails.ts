/**
 * Linked emails — additional addresses a user has PROVEN they own.
 *
 * WHY (Eric, 2026-07-29): "our users do this all the time — buy with one email, sign in with
 * another. This is a standard, not a bug." The Billing card looks up only the signed-in email,
 * so a customer who checked out with a different address sees the wrong subscription (or none)
 * and cannot reach the Stripe portal holding their real plan.
 *
 * The link is USER-ASSERTED and OTP-PROVEN — never inferred. Nothing in our data connects two
 * addresses, so auto-linking would be a guess, and a wrong guess exposes one customer's billing
 * to another. Proof comes from the existing two_factor_codes pipeline (hashed code, 10-min TTL,
 * 60s throttle) — the same one mi-login uses. No new security surface.
 *
 * Table: account_linked_emails (migration 20260729_account_linked_emails.sql, hand-run — this
 * DB has no in-app DDL, CLAUDE.md #6).
 */
import { createHash, randomInt } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';
import { renderMindyEmailLogo } from '@/lib/mindy/email-branding';

export const LINK_CODE_TTL_MINUTES = 10;
export const LINK_RESEND_WINDOW_SECONDS = 60;
/** A user cannot hoard addresses; keeps the abuse surface small. */
export const MAX_LINKED_EMAILS = 5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: any = null;
function db() {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return _sb;
}

export function normalizeEmail(email: string) {
  return (email || '').toLowerCase().trim();
}

/**
 * Hash MUST be scoped to BOTH addresses. Scoping to the target alone would let a code minted
 * for owner A be redeemed by owner B to steal the same link.
 */
function hashLinkCode(owner: string, target: string, code: string) {
  const secret = process.env.TWO_FACTOR_SECRET || process.env.ADMIN_PASSWORD || process.env.SUPABASE_SERVICE_ROLE_KEY || 'mindy-2fa';
  return createHash('sha256')
    .update(`link:${normalizeEmail(owner)}:${normalizeEmail(target)}:${code}:${secret}`)
    .digest('hex');
}

async function tableReady(): Promise<{ ready: true } | { ready: false; error: string }> {
  // PROBE only — never self-create. A prior feature tried an exec_migration RPC that doesn't
  // exist here, failed silently, and left a gate falling open.
  const { error } = await db().from('account_linked_emails').select('id').limit(1);
  if (!error) return { ready: true };
  if (error.code === '42P01' || error.code === 'PGRST205') {
    return { ready: false, error: 'account_linked_emails table missing — run migration 20260729_account_linked_emails.sql' };
  }
  return { ready: false, error: error.message };
}

export type RequestLinkResult =
  | { ok: true }
  | { ok: false; reason: 'same-email' | 'throttled' | 'limit' | 'taken' | 'table' | 'error'; error?: string };

/**
 * Step 1 — send a verification code TO THE ADDRESS BEING ADDED.
 * Caller MUST have already authenticated `ownerEmail`.
 */
export async function requestEmailLink(
  ownerEmail: string,
  targetEmail: string,
  opts: { ip?: string | null; userAgent?: string | null } = {},
): Promise<RequestLinkResult> {
  const owner = normalizeEmail(ownerEmail);
  const target = normalizeEmail(targetEmail);
  if (!owner || !target) return { ok: false, reason: 'error', error: 'email required' };
  if (owner === target) return { ok: false, reason: 'same-email' };

  const t = await tableReady();
  if (!t.ready) return { ok: false, reason: 'table', error: t.error };

  // Already claimed (verified) by someone else → refuse. Deliberately does NOT say by whom.
  const { data: claimed } = await db()
    .from('account_linked_emails')
    .select('owner_email')
    .ilike('linked_email', target)
    .not('verified_at', 'is', null)
    .maybeSingle();
  if (claimed && normalizeEmail(claimed.owner_email) !== owner) return { ok: false, reason: 'taken' };

  const { count } = await db()
    .from('account_linked_emails')
    .select('*', { count: 'exact', head: true })
    .ilike('owner_email', owner)
    .not('verified_at', 'is', null);
  if ((count ?? 0) >= MAX_LINKED_EMAILS) return { ok: false, reason: 'limit' };

  // Reuse the two_factor_codes throttle so a user can't spam a stranger's inbox.
  const since = new Date(Date.now() - LINK_RESEND_WINDOW_SECONDS * 1000).toISOString();
  const { data: recent } = await db()
    .from('two_factor_codes')
    .select('id')
    .eq('user_email', target)
    .gte('created_at', since)
    .is('consumed_at', null)
    .limit(1)
    .maybeSingle();
  if (recent) return { ok: false, reason: 'throttled' };

  const code = String(randomInt(100000, 1000000));
  const { error: insErr } = await db().from('two_factor_codes').insert({
    user_email: target,
    code_hash: hashLinkCode(owner, target, code),
    expires_at: new Date(Date.now() + LINK_CODE_TTL_MINUTES * 60 * 1000).toISOString(),
    ip_address: opts.ip || null,
    user_agent: opts.userAgent || null,
  });
  if (insErr) return { ok: false, reason: 'error', error: insErr.message };

  // Record the pending link (unverified — nothing reads it for billing yet).
  await db().from('account_linked_emails').upsert(
    { owner_email: owner, linked_email: target, verified_at: null, updated_at: new Date().toISOString() },
    { onConflict: 'owner_email,linked_email' },
  );

  const sent = await sendEmail({
    to: target,
    subject: `Confirm this email for your Mindy account — ${code}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a;">
        <div style="background:#020617;color:white;border-radius:14px;padding:24px;text-align:center;">
          ${renderMindyEmailLogo(52)}
          <h1 style="margin:10px 0 8px;font-size:22px;">Confirm this email address</h1>
          <p style="color:#cbd5e1;margin:0 0 18px;">
            Someone signed in to Mindy as <strong>${owner}</strong> asked to connect this address,
            so their billing and purchases show up in one place.
          </p>
          <div style="font-size:34px;letter-spacing:10px;font-weight:700;background:#0f172a;border:1px solid #334155;border-radius:12px;padding:16px;">${code}</div>
          <p style="color:#94a3b8;margin:18px 0 0;font-size:13px;">Expires in ${LINK_CODE_TTL_MINUTES} minutes.</p>
        </div>
        <p style="color:#64748b;font-size:12px;margin-top:16px;">
          If you didn't expect this, ignore this email — nothing is connected unless the code is entered.
        </p>
      </div>`,
    text: `Confirm this email for Mindy.\n\nSomeone signed in as ${owner} asked to connect this address.\nCode: ${code} (expires in ${LINK_CODE_TTL_MINUTES} minutes)\n\nIf you didn't expect this, ignore this email.`,
  });
  if (!sent) return { ok: false, reason: 'error', error: 'could not send verification email' };
  return { ok: true };
}

export type ConfirmLinkResult =
  | { ok: true; linkedEmail: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'taken' | 'table' | 'error'; error?: string };

/** Step 2 — redeem the code and mark the link verified. */
export async function confirmEmailLink(
  ownerEmail: string,
  targetEmail: string,
  code: string,
): Promise<ConfirmLinkResult> {
  const owner = normalizeEmail(ownerEmail);
  const target = normalizeEmail(targetEmail);
  const t = await tableReady();
  if (!t.ready) return { ok: false, reason: 'table', error: t.error };

  const { data: row } = await db()
    .from('two_factor_codes')
    .select('id, expires_at, consumed_at')
    .eq('user_email', target)
    .eq('code_hash', hashLinkCode(owner, target, (code || '').trim()))
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row) return { ok: false, reason: 'invalid' };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };

  // Consume FIRST — a code must never be redeemable twice, even if the update below fails.
  await db().from('two_factor_codes').update({ consumed_at: new Date().toISOString() }).eq('id', row.id);

  const { error: upErr } = await db().from('account_linked_emails').upsert(
    { owner_email: owner, linked_email: target, verified_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: 'owner_email,linked_email' },
  );
  // 23505 = the partial unique index on verified linked_email — someone else already proved it.
  if (upErr) return { ok: false, reason: upErr.code === '23505' ? 'taken' : 'error', error: upErr.message };

  return { ok: true, linkedEmail: target };
}

/**
 * Every address this signed-in user can act as — their own first, then verified links.
 * Billing/entitlement lookups fan out over this instead of a single email.
 */
export async function getLinkedEmails(ownerEmail: string): Promise<string[]> {
  const owner = normalizeEmail(ownerEmail);
  if (!owner) return [];
  const t = await tableReady();
  if (!t.ready) return [owner]; // degrade to today's behaviour, never throw
  const { data } = await db()
    .from('account_linked_emails')
    .select('linked_email')
    .ilike('owner_email', owner)
    .not('verified_at', 'is', null);
  const extra = (data || []).map((r: { linked_email: string }) => normalizeEmail(r.linked_email));
  return [...new Set([owner, ...extra])];
}

/** Remove a link (user-initiated). Only the owner can unlink. */
export async function unlinkEmail(ownerEmail: string, targetEmail: string): Promise<boolean> {
  const { error } = await db()
    .from('account_linked_emails')
    .delete()
    .ilike('owner_email', normalizeEmail(ownerEmail))
    .ilike('linked_email', normalizeEmail(targetEmail));
  return !error;
}
