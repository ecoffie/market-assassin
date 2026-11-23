/**
 * A one-time sign-in link that no longer works lands on /app with an ERROR in the URL hash
 * instead of a session, e.g.
 *   /app#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired
 * (Supabase's verify endpoint redirects there when the link was already used, superseded by a
 * newer link, or expired). /app used to ignore that hash and just show the sign-in form, so the
 * user saw "invalid" in the address bar and no explanation (Mindy Day, ChatGPT connect).
 *
 * This only turns the hash into a message. It never signs anyone in or out.
 */
export const MAGIC_LINK_INVALID_MESSAGE =
  'That sign-in link is no longer valid. It may have expired or already been used. Request a new link, or sign in with your password.';

/** The message to show for an error-bearing auth hash, or null when the hash carries no link error. */
export function magicLinkErrorMessage(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  // A hash that carries a session is a successful sign-in, never an error.
  if (params.get('access_token')) return null;
  if (!params.get('error') && !params.get('error_code')) return null;
  return MAGIC_LINK_INVALID_MESSAGE;
}
