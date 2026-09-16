/**
 * Setup saves must present the authenticated Mindy session — never a login challenge.
 *
 * Email-code sign-in (`/api/auth/two-factor/verify`) consumes the 6-digit code and
 * returns a 30-day MI session token (`payload.signature`). Complete Setup used to
 * POST `/api/mindy/profile` with `Authorization: Bearer ${accessToken}` where that
 * value was either:
 *   - empty, because onboarding discarded the stored MI token when there was no
 *     Supabase session (the email-code path), or
 *   - a Supabase access JWT (three segments) from Google / magic-link, which
 *     `requireMIAuthSession` HMAC-checks as a two-factor session and rejects with
 *     "Invalid two-factor session".
 *
 * The consumed login code cannot produce that error. Verify already burned it,
 * and this request never sends it. A repeated/resent code fails earlier, as
 * "Invalid verification code", against the latest unconsumed hash only.
 */

export const SETUP_DRAFT_KEY = 'mindy_setup_draft';

/** MI session tokens are `base64url(payload).base64url(hmac)` — exactly two segments. */
export function isMiSessionToken(token: string | null | undefined): boolean {
  const t = (token || '').trim();
  if (!t || /\s/.test(t)) return false;
  const parts = t.split('.');
  return parts.length === 2 && parts.every((p) => p.length > 8);
}

/** Supabase access tokens are JWTs (header.payload.signature). Not an MI session. */
export function isSupabaseAccessJwt(token: string | null | undefined): boolean {
  const t = (token || '').trim();
  if (!t || /\s/.test(t)) return false;
  return t.split('.').length === 3;
}

/** A login OTP is a 6-digit challenge. It is never a session credential. */
export function isLoginChallenge(value: string | null | undefined): boolean {
  return /^\d{6}$/.test((value || '').trim());
}

export type SetupCredential =
  | { kind: 'mi-session'; token: string }
  | { kind: 'needs-exchange' }
  | { kind: 'missing' };

/**
 * What Complete Setup is allowed to send.
 * A stored MI session wins. A Supabase JWT must be exchanged at `/api/auth/mi-session`
 * first — it must not be forwarded as the two-factor session. A 6-digit code is not
 * a credential at all.
 */
export function credentialForSetupSave(input: {
  storedMiToken?: string | null;
  supabaseAccessToken?: string | null;
}): SetupCredential {
  const stored = (input.storedMiToken || '').trim();
  if (isLoginChallenge(stored)) return { kind: 'missing' };
  if (isMiSessionToken(stored)) return { kind: 'mi-session', token: stored };

  const supa = (input.supabaseAccessToken || '').trim();
  if (isLoginChallenge(supa)) return { kind: 'missing' };
  if (isSupabaseAccessJwt(supa)) return { kind: 'needs-exchange' };
  if (isMiSessionToken(supa)) return { kind: 'mi-session', token: supa };
  return { kind: 'missing' };
}

/** True when a save failed because the session, not the form, was the problem. */
export function isSessionFailureMessage(error: string | null | undefined): boolean {
  const e = (error || '').toLowerCase();
  return (
    e.includes('two-factor session')
    || e.includes('missing two-factor')
    || e.includes('sign in required')
    || e.includes('strong authentication required')
  );
}

export interface SetupDraft {
  savedAt: string;
  email?: string;
  businessDescription?: string;
  selectedIndustries?: string[];
  customNaics?: string;
  selectedStates?: string[];
  selectedAgencies?: string[];
  customAgencies?: string;
  selectedSetAsides?: string[];
  frequency?: string;
  step?: number;
  mode?: string;
  next?: string | null;
}

export function serializeSetupDraft(draft: SetupDraft): string {
  return JSON.stringify({ ...draft, savedAt: draft.savedAt || new Date().toISOString() });
}

export function parseSetupDraft(raw: string | null | undefined): SetupDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SetupDraft;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}
