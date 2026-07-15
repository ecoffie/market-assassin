/**
 * Shared email-OTP send logic — the code-gen → hash → throttle → insert → email
 * pipeline, extracted from api/auth/two-factor/request so BOTH that route and the
 * paid-MFA login gate (mi-login) can issue a code without duplicating the throttle
 * + hash posture (which must stay identical to what two-factor/verify checks).
 *
 * Storage: hashed code (never plaintext) in two_factor_codes, 10-min TTL, 60s
 * resend throttle. Verified by api/auth/two-factor/verify.
 */

import { createHash, randomInt } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';
import { renderMindyEmailLogo } from '@/lib/mindy/email-branding';

export const CODE_TTL_MINUTES = 10;
export const RESEND_WINDOW_SECONDS = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _supabase;
}

function normalizeEmail(email: string) {
  return email.toLowerCase().trim();
}

// MUST match api/auth/two-factor/verify's hashCode exactly (same secret order).
function hashCode(email: string, code: string) {
  const secret = process.env.TWO_FACTOR_SECRET || process.env.ADMIN_PASSWORD || process.env.SUPABASE_SERVICE_ROLE_KEY || 'mindy-2fa';
  return createHash('sha256').update(`${normalizeEmail(email)}:${code}:${secret}`).digest('hex');
}

async function ensureTwoFactorTable() {
  // The table is created by a hand-run migration (supabase/migrations/
  // 20260714_two_factor_codes.sql) — this DB has no in-app DDL (CLAUDE.md #6).
  // We only PROBE it here; if it's missing that's a hard, loud error (a prior
  // version tried to self-create via an `exec_migration` RPC that doesn't exist
  // in this DB, which silently failed and made the paid-MFA gate fall open).
  const { error } = await getSupabase().from('two_factor_codes').select('id').limit(1);
  if (!error) return { ready: true as const };
  if (error.code === '42P01' || error.code === 'PGRST205') {
    return { ready: false, error: 'two_factor_codes table missing — run migration 20260714_two_factor_codes.sql' };
  }
  return { ready: false, error: error.message };
}

function buildEmailHtml(code: string) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a;">
      <div style="background:#020617;color:white;border-radius:14px;padding:24px;text-align:center;">
        ${renderMindyEmailLogo(52)}
        <h1 style="margin:10px 0 8px;font-size:24px;">Your verification code</h1>
        <p style="color:#cbd5e1;margin:0 0 22px;">Enter this code to finish signing in. It expires in ${CODE_TTL_MINUTES} minutes.</p>
        <div style="font-size:36px;letter-spacing:10px;font-weight:700;background:#0f172a;border:1px solid #334155;border-radius:12px;padding:18px 20px;text-align:center;">
          ${code}
        </div>
        <p style="font-size:13px;color:#94a3b8;margin:22px 0 0;">If you did not request this, you can ignore this email.</p>
      </div>
    </div>
  `;
}

export type SendTwoFactorResult =
  | { ok: true; expiresAt: string; delivery: 'sent' | 'failed'; deliveryError?: string }
  | { ok: false; reason: 'throttled' | 'table' | 'error'; error?: string };

/**
 * Issue an email OTP for `email`. Assumes the CALLER has already authenticated
 * the user (mi-login verified the password; two-factor/request verifies it too).
 * Enforces the 60s resend throttle. Returns a discriminated result.
 */
export async function sendTwoFactorCode(
  email: string,
  opts: { ip?: string | null; userAgent?: string | null } = {}
): Promise<SendTwoFactorResult> {
  const normalized = normalizeEmail(email);

  const table = await ensureTwoFactorTable();
  if (!table.ready) return { ok: false, reason: 'table', error: table.error };

  // Resend throttle — an unconsumed code minted in the last 60s blocks a new one.
  const resendAfter = new Date(Date.now() - RESEND_WINDOW_SECONDS * 1000).toISOString();
  const { data: recentCode } = await getSupabase()
    .from('two_factor_codes')
    .select('id')
    .eq('user_email', normalized)
    .gte('created_at', resendAfter)
    .is('consumed_at', null)
    .limit(1)
    .maybeSingle();
  if (recentCode) return { ok: false, reason: 'throttled' };

  const code = String(randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();

  const { error: insertError } = await getSupabase()
    .from('two_factor_codes')
    .insert({
      user_email: normalized,
      code_hash: hashCode(normalized, code),
      expires_at: expiresAt,
      ip_address: opts.ip || null,
      user_agent: opts.userAgent || null,
    });
  if (insertError) return { ok: false, reason: 'error', error: insertError.message };

  // The code row is now written → the OTP challenge is ACTIVE. From here on, a mail
  // delivery failure must NOT throw: if it did, a paid-MFA caller's outer catch would
  // fail OPEN and silently mint a session — downgrading the security control on a
  // transient email hiccup. Instead we return ok:true with delivery:'failed' so the
  // caller still routes to the code step (challenge stands) and the user can Resend.
  let delivery: 'sent' | 'failed' = 'sent';
  let deliveryError: string | undefined;
  try {
    await sendEmail({
      to: normalized,
      subject: `${code} is your Mindy verification code`,
      html: buildEmailHtml(code),
      text: `Your Mindy verification code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.`,
      emailType: 'two_factor_code',
      eventSource: 'mindy_login',
      tags: { product: 'mindy', type: '2fa' },
      metadata: { expiresAt },
      transactional: true,
    });
  } catch (err) {
    delivery = 'failed';
    deliveryError = err instanceof Error ? err.message : String(err);
    console.error('[sendTwoFactorCode] code stored but email delivery failed:', deliveryError);
  }

  return { ok: true, expiresAt, delivery, deliveryError };
}
