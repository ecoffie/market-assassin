/**
 * Who may write through POST /api/alerts/save-profile (P0 security, 2026-09-28).
 *
 * INVARIANT: only a VERIFIED identity may mutate a user's saved targeting/profile state.
 * Never authorized by: the request-body email, a query email, the plaintext
 * `ma_access_email` cookie, or a claimed staff address. Verification is the canonical
 * STRONG path — `verifyUserOwnsEmail(…, { requireStrongAuth: true })` (Supabase session,
 * signed email-action token, or the signed Mindy session token), the same gate the Vault uses.
 *
 * Before this, the four "free" sources skipped auth entirely, so an anonymous POST could
 * overwrite ANY existing user's NAICS/agencies/business type/locations — and
 * `source: 'paid_existing'` granted the KV `briefings:` key (the real Pro gate) to any email.
 *
 * Outcomes:
 *   verified   — a strong credential proves the caller owns THIS email → may create or update.
 *   invite     — `paid_existing` only: a database-backed, unused, unexpired invitation whose
 *                email IS this email (the magic link was mailed to it) → may activate.
 *   anonymous  — no credential at all → may only CREATE a row for an email with no saved state
 *                (lead capture / first signup). The route enforces "no existing row" and uses a
 *                pure INSERT, so an existing user's state is never touched anonymously.
 *   rejected   — a credential was presented and did not verify for this email (invalid, expired,
 *                or user A claiming user B). Never falls back to anonymous.
 */
import type { NextRequest } from 'next/server';
import crypto from 'crypto';
import { verifyUserOwnsEmail } from '@/lib/api-auth';

export type SaveProfileIdentity =
  | { kind: 'verified'; email: string }
  | { kind: 'invite'; email: string }
  | { kind: 'anonymous'; email: string }
  | { kind: 'rejected'; status: 401; code: string; error: string };

/** True when the request carries ANY credential — so a failed one can never degrade to anonymous. */
export function hasPresentedCredential(request: NextRequest): boolean {
  const h = request.headers;
  if (h.get('x-mi-auth-token') || h.get('x-mi-2fa-token')) return true;
  const auth = h.get('authorization');
  if (auth && auth.trim()) return true;
  const q = request.nextUrl.searchParams;
  return !!(q.get('token') || q.get('ts'));
}

export interface InvitationRow { email: string | null; used_at: string | null; expires_at: string | null }
export type InvitationLookup = (token: string) => Promise<{ row: InvitationRow | null; error: string | null }>;

/**
 * A magic-link invitation bound to `email`: valid HMAC (same scheme as /api/invitations/verify),
 * ≤ 30 days old, AND a database row that is unused, unexpired and addressed to this email.
 * A token with no database row carries no email, so it can prove nothing about who is asking.
 */
export async function verifyBoundInvitation(
  token: string | null | undefined,
  email: string,
  lookup: InvitationLookup,
  now: number = Date.now(),
  secret: string = (process.env.STRIPE_SECRET_KEY || '').slice(-32),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'no invitation token' };
  if (!secret) return { ok: false, reason: 'invitation signing is not configured' };
  let parts: string[];
  try { parts = Buffer.from(token, 'base64url').toString().split(':'); } catch { return { ok: false, reason: 'malformed token' }; }
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' };
  const [customerId, ts, hmac] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${customerId}:${ts}`).digest('hex').slice(0, 16);
  const a = Buffer.from(hmac || ''), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad signature' };
  const t = parseInt(ts, 10);
  if (!Number.isFinite(t) || now - t > 30 * 24 * 60 * 60 * 1000) return { ok: false, reason: 'expired token' };
  const { row, error } = await lookup(token);
  if (error) return { ok: false, reason: 'invitation lookup failed' };
  if (!row) return { ok: false, reason: 'invitation not on record' };
  if (row.used_at) return { ok: false, reason: 'invitation already used' };
  if (!row.expires_at || new Date(row.expires_at).getTime() < now) return { ok: false, reason: 'invitation expired' };
  if (!row.email || row.email.toLowerCase().trim() !== email) return { ok: false, reason: 'invitation is for a different email' };
  return { ok: true };
}

export async function resolveSaveProfileIdentity(
  request: NextRequest,
  claimedEmail: string,
  opts: { source?: string; inviteToken?: string | null; lookupInvitation: InvitationLookup },
): Promise<SaveProfileIdentity> {
  const email = String(claimedEmail || '').toLowerCase().trim();

  let verified = false;
  if (hasPresentedCredential(request)) {
    const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
    if (!(auth.authenticated && auth.email === email)) {
      return { kind: 'rejected', status: 401, code: 'invalid_credentials', error: 'Your sign-in could not be verified for this email. Please sign in again.' };
    }
    verified = true;
  }

  // paid_existing grants the Pro gate, so it ALWAYS needs the bound invitation — a signed-in
  // session proves who you are, not that you were invited as a paying subscriber.
  if (opts.source === 'paid_existing') {
    const inv = await verifyBoundInvitation(opts.inviteToken, email, opts.lookupInvitation);
    if (inv.ok) return { kind: 'invite', email };
    return { kind: 'rejected', status: 401, code: 'invite_required', error: 'This activation link is invalid or has expired. Please contact support.' };
  }

  return verified ? { kind: 'verified', email } : { kind: 'anonymous', email };
}

export const SIGN_IN_REQUIRED = {
  code: 'sign_in_required',
  error: 'This email already has a Mindy profile. Sign in to update it.',
} as const;
