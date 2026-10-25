/**
 * Free-signup email checks — decided BEFORE any auth account exists.
 *
 * INCIDENT (2026-10-25): three HTTP 500s on /api/auth/mindy-signup were one person retrying an
 * address with two consecutive dots in the local part. The old format regex allowed `.` anywhere
 * before the @, so the address passed; `auth.admin.generateLink({type:'invite'})` then CREATED the
 * auth user (plus its user_profiles row); and only then did both email providers reject the
 * recipient (Resend 422 "Invalid `to` field", Office 365 "501 5.1.3 Invalid address"). The user saw
 * "Unable to create account" with no hint the address was wrong. 22 such orphan accounts exist
 * (2026-09-01 → 2026-10-25); none of those people ever signed up with the corrected address.
 * Record: tasks/mindy-signup-500-investigation-2026-10-25.md.
 */

const BASIC_EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

export const MISTYPED_EMAIL_MESSAGE =
  'That email address looks mistyped. Please check it and try again.';

/**
 * Format problems with a specific, human explanation. Returns null when the format is fine.
 * Unquoted local parts (RFC 5321 dot-string) may not start or end with a dot, or contain two dots
 * in a row — mail providers reject all three, so we must too, before an account is created.
 */
export function signupEmailFormatError(email: string): string | null {
  if (!BASIC_EMAIL.test(email)) return 'Invalid email format';
  const local = email.slice(0, email.lastIndexOf('@'));
  if (local.includes('..')) {
    return 'That email address looks mistyped — it has two dots in a row (..). Please check it and try again.';
  }
  if (local.startsWith('.')) {
    return 'That email address looks mistyped — it starts with a dot. Please check it and try again.';
  }
  if (local.endsWith('.')) {
    return 'That email address looks mistyped — it has a dot right before the @. Please check it and try again.';
  }
  return null;
}

/**
 * True ONLY when the send failed because the mail server PERMANENTLY rejected the RECIPIENT ADDRESS
 * itself — i.e. retrying cannot help and the user must fix what they typed.
 *
 * sendEmail tries Resend, then Office 365, and rethrows the Office 365 (nodemailer) error. So this
 * reads that error: an SMTP reply to `RCPT TO` (the recipient step) with a permanent 5xx code and an
 * address-status enhanced code (5.1.1 bad mailbox, 5.1.3 bad address syntax, 5.1.10 recipient not
 * found), or a bare 501 (syntax error in the address parameter).
 *
 * Deliberately NOT a recipient rejection (stays a server error):
 *  - 4xx replies (temporary: 421/450/451/452 — rate limits, greylisting, mailbox busy)
 *  - 5.7.x (policy / auth / relay denied), 5.4.x (routing / network), 5.3.x (system), 5.5.x
 *  - failures at any other SMTP step (connection, AUTH, MAIL FROM, DATA)
 *  - no SMTP reply at all (timeouts, ECONNECTION, ETIMEDOUT, DNS) — provider outage
 *  - anything that is not an SMTP error object (Resend outage, unknown errors)
 */
export function isInvalidRecipientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { command?: unknown; responseCode?: unknown; response?: unknown };
  if (typeof e.command !== 'string' || e.command.trim().toUpperCase() !== 'RCPT TO') return false;
  const code = e.responseCode;
  if (typeof code !== 'number' || code < 500 || code > 599) return false;
  const response = typeof e.response === 'string' ? e.response : '';
  const enhanced = response.match(/\b5\.(\d{1,3})\.(\d{1,3})\b/);
  if (enhanced) {
    const [, subject, detail] = enhanced;
    return subject === '1' && ['1', '3', '10'].includes(detail);
  }
  return code === 501;
}
