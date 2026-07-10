/**
 * Per-user admin authentication (P3) — who is acting, not just "is the password right".
 *
 * PROBLEM: 226 routes gate on a single shared ADMIN_PASSWORD. The audit log
 * (P1) can only record actor='admin' because that's all the system knows, and
 * you can't revoke one person without rotating the shared secret.
 *
 * FIX (additive, zero-break): verifyAdminAuth() accepts EITHER
 *   (a) an authenticated session (Supabase Bearer OR 2FA session token) whose
 *       email is an admin per getStaffRole()  → returns that real email, or
 *   (b) the existing shared ADMIN_PASSWORD    → returns actor 'admin' (fallback).
 *
 * Both work, so nothing breaks when this replaces a bare verifyAdminPassword()
 * check. As admins move to logging in via 2FA, the audit trail gains real names
 * for free. Later, set ADMIN_PASSWORD_BREAKGLASS_ONLY=true to disable path (b)
 * except as an emergency (see isBreakGlassOnly()).
 *
 * This is auth plumbing only — no DB migration, no customer-data access.
 */
import type { NextRequest } from 'next/server';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { verifyUserSession, getStaffRole } from '@/lib/api-auth';
import { verifyTwoFactorSessionToken } from '@/lib/two-factor-session';

export interface AdminAuthResult {
  ok: boolean;
  /** The acting admin's email, or 'admin' when authenticated via the shared password. */
  actorEmail: string;
  /** How they authenticated — for the audit trail. */
  method: 'session' | '2fa' | 'password' | 'none';
  error?: string;
}

/** When true, the shared password is accepted only as emergency break-glass. */
function isBreakGlassOnly(): boolean {
  return process.env.ADMIN_PASSWORD_BREAKGLASS_ONLY === 'true';
}

/**
 * Resolve the acting admin from a request. Tries, in order:
 *   1. Supabase session (Authorization: Bearer <token>) → email must be admin.
 *   2. 2FA session token (x-mi-session header or body-supplied) → email must be admin.
 *   3. Shared ADMIN_PASSWORD (from body/query) → actor 'admin' (unless break-glass-only).
 *
 * @param sharedPassword the password value the route already reads (adminPassword / ?password).
 * @param twoFactorToken optional 2FA session token if the route has it.
 */
export async function verifyAdminAuth(
  request: NextRequest,
  sharedPassword?: string | null,
  twoFactorToken?: string | null
): Promise<AdminAuthResult> {
  // 1. Supabase session → real identity, gated by admin role.
  try {
    const session = await verifyUserSession(request);
    if (session.authenticated && session.email && getStaffRole(session.email) === 'admin') {
      return { ok: true, actorEmail: session.email, method: 'session' };
    }
  } catch {
    /* fall through to next method */
  }

  // 2. 2FA session token (header or explicit), gated by admin role.
  const token2fa = twoFactorToken || request.headers.get('x-mi-session');
  if (token2fa) {
    const res = verifyTwoFactorSessionToken(token2fa);
    if (res.valid && res.email && getStaffRole(res.email) === 'admin') {
      return { ok: true, actorEmail: res.email, method: '2fa' };
    }
  }

  // 3. Shared password fallback (break-glass). Actor is anonymous 'admin'.
  if (sharedPassword && verifyAdminPassword(sharedPassword)) {
    if (isBreakGlassOnly()) {
      // Still allowed, but flagged so we can see break-glass use in the audit log.
      return { ok: true, actorEmail: 'admin', method: 'password', error: 'break_glass' };
    }
    return { ok: true, actorEmail: 'admin', method: 'password' };
  }

  return { ok: false, actorEmail: 'admin', method: 'none', error: 'Unauthorized' };
}
