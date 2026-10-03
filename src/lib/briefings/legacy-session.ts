/**
 * R1 migration (2026-10-03): how the legacy /briefings page decides WHO is reading.
 *
 * Before: the page took a remembered email (localStorage / the plaintext ma_access_email cookie),
 * a ?email= link parameter, or a typed address, called /api/briefings/verify with it, and then
 * wrote the cookie itself — so the briefing APIs accepted whatever address the browser claimed.
 * R0 measured paying customers depending on exactly that path.
 *
 * After: only a signed Mindy session names the reader. A remembered/typed/URL email is a HINT —
 * it pre-fills the secure sign-in link request and never loads anyone's briefings.
 */
export type BriefingsEntry =
  | { kind: 'session'; email: string }
  | { kind: 'needs_verification'; hintEmail: string }
  | { kind: 'anonymous' };

const norm = (v: string | null | undefined) => (v || '').toLowerCase().trim();

export function briefingsEntry(input: {
  /** Email inside the stored signed Mindy session token (verified server-side on every call). */
  sessionEmail: string | null | undefined;
  /** Remembered plaintext email (localStorage / ma_access_email cookie) — never identity. */
  legacyEmail?: string | null;
  /** ?email= on the URL — never identity. */
  urlEmail?: string | null;
}): BriefingsEntry {
  const session = norm(input.sessionEmail);
  const url = norm(input.urlEmail);
  // A link for a DIFFERENT address than the signed-in account must not silently show the
  // signed-in account's briefings as if they were the link's — ask to verify the link's address.
  if (session && (!url || url === session)) return { kind: 'session', email: session };
  const hint = url || norm(input.legacyEmail) || session;
  return hint ? { kind: 'needs_verification', hintEmail: hint } : { kind: 'anonymous' };
}

/** Store the signed session minted by /api/access-links/consume. */
export function storeVerifiedSession(sessionToken: string, email: string): void {
  if (typeof window === 'undefined' || !sessionToken) return;
  try {
    window.localStorage.setItem('mi_beta_auth_token', sessionToken);
    window.localStorage.setItem('briefings_access_email', norm(email));
  } catch {
    // Private mode: the session cannot persist; the page will ask for a link again.
  }
}
