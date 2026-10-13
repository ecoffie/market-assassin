/**
 * Signing secrets for EMAIL ACTION links (alert "Track in Mindy", preferences, the email-save
 * confirmation form, signed-link auth). Same rotation model as two-factor-session.ts.
 *
 * WHY (2026-10-13): production had no EMAIL_ACTION_SECRET, so every customer email link was
 * HMAC-signed with ADMIN_PASSWORD. That couples two unrelated secrets: rotating the admin password
 * silently breaks every link in every inbox, and the admin credential is used as a customer-facing
 * signing key.
 *
 * SIGN with EMAIL_ACTION_SECRET; fall back to ADMIN_PASSWORD only while it is unset, so deploying
 * this changes nothing until the env var is set.
 *
 * VERIFY against, in order:
 *   1. EMAIL_ACTION_SECRET            (current)
 *   2. EMAIL_ACTION_SECRET_PREVIOUS   (optional; set during a future rotation of the dedicated secret)
 *   3. ADMIN_PASSWORD                 (legacy links) — accepted UNLESS EMAIL_ACTION_ACCEPT_ADMIN_LEGACY=off.
 * Turn (3) off once every link signed with ADMIN_PASSWORD has expired. The longest-lived verifier
 * accepts links for 7 days (auth-observability), so wait at least 7 days after setting
 * EMAIL_ACTION_SECRET.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export class EmailActionSecretMissing extends Error {}

export function emailActionSigningSecret(): string {
  const s = process.env.EMAIL_ACTION_SECRET || process.env.ADMIN_PASSWORD;
  if (!s) throw new EmailActionSecretMissing('EMAIL_ACTION_SECRET not configured');
  return s;
}

export function emailActionVerificationSecrets(): string[] {
  const legacyAllowed = (process.env.EMAIL_ACTION_ACCEPT_ADMIN_LEGACY || '').trim().toLowerCase() !== 'off';
  const list = [
    process.env.EMAIL_ACTION_SECRET,
    process.env.EMAIL_ACTION_SECRET_PREVIOUS,
    // When EMAIL_ACTION_SECRET is unset, ADMIN_PASSWORD IS the signing secret, so it must verify.
    legacyAllowed || !process.env.EMAIL_ACTION_SECRET ? process.env.ADMIN_PASSWORD : undefined,
  ].filter((s): s is string => Boolean(s));
  return Array.from(new Set(list));
}

/** Constant-time comparison of two hex strings of possibly different length. */
export function hexEquals(a: string, b: string): boolean {
  if (!/^[0-9a-f]*$/i.test(a) || !/^[0-9a-f]*$/i.test(b) || a.length !== b.length || a.length % 2) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** The email-link token: first 32 hex chars of HMAC-SHA256(secret, "<email>:<ts>"). */
export function emailLinkToken(secret: string, email: string, ts: number | string): string {
  return createHmac('sha256', secret).update(`${email.toLowerCase()}:${ts}`).digest('hex').substring(0, 32);
}

/** True when `token` matches the link signature under ANY accepted verification secret. */
export function verifyEmailLinkSignature(email: string, token: string, ts: number | string): boolean {
  return emailActionVerificationSecrets().some((s) => hexEquals(emailLinkToken(s, email, ts), token));
}
