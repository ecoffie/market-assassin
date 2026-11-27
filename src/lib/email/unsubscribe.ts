/**
 * One unsubscribe for every Mindy email (Eric, 2026-11-27: "we need an easy way for people to cancel or unsubscribe;
 * this becomes a customer service issue").
 *
 * What was broken: footers pointed at a 404 (/briefings/unsubscribe, /unsubscribe), at the app HOME, or at
 * /api/alerts/unsubscribe?email=<anyone> — a GET that unsubscribed whatever address it was given (anyone could
 * unsubscribe anyone, and mail scanners that pre-fetch links could unsubscribe the recipient). No email carried a
 * List-Unsubscribe header, which Gmail and Yahoo require of bulk senders.
 *
 * The contract:
 *   - Templates put UNSUBSCRIBE_URL_PLACEHOLDER in the footer. sendEmail() — which knows the recipient — replaces it
 *     with that recipient's signed URL and adds RFC 8058 one-click headers to every non-transactional send.
 *     A template never builds an unsubscribe link itself (unsubscribe-links.unit.test.ts greps for that).
 *   - The URL carries the address and an HMAC of it (EMAIL_ACTION_SECRET, rotation-aware). No expiry: an
 *     unsubscribe link must keep working for as long as the email sits in an inbox.
 *   - GET shows a confirmation page and writes NOTHING (link scanners). POST — the page's button, or the mailbox
 *     provider's one-click "List-Unsubscribe=One-Click" request — performs the unsubscribe.
 */
import { createHmac } from 'node:crypto';
import { emailActionSigningSecret, emailActionVerificationSecrets, hexEquals } from '@/lib/email-action-secret';
import { MINDY_SITE_URL } from '@/lib/mindy/email-branding';

/** Footer placeholder; sendEmail() substitutes the recipient's signed URL. Never sent as-is. */
export const UNSUBSCRIBE_URL_PLACEHOLDER = '%%MINDY_UNSUBSCRIBE_URL%%';

export const UNSUBSCRIBE_PATH = '/api/unsubscribe';
const VERSION = 'unsubscribe:v1';

const norm = (email: string) => email.trim().toLowerCase();

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { return null; }
}

export function unsubscribeToken(email: string, secret: string = emailActionSigningSecret()): string {
  return createHmac('sha256', secret).update(`${VERSION}:${norm(email)}`).digest('hex');
}

/** Strict: throws EmailActionSecretMissing when no signing secret is configured (sendEmail handles that). */
function signedUrl(email: string, emailType?: string | null): string {
  const qs = new URLSearchParams({ e: b64url(norm(email)), t: unsubscribeToken(email) });
  if (emailType) qs.set('s', emailType.slice(0, 64));
  return `${MINDY_SITE_URL}${UNSUBSCRIBE_PATH}?${qs.toString()}`;
}

/**
 * The recipient's one-click unsubscribe URL, for templates that render it themselves. `emailType` is carried for
 * attribution only; it is not signed. With no signing secret it returns the preferences page (never an unsigned
 * link) and logs loudly, so a render never fails.
 */
export function unsubscribeUrl(email: string, emailType?: string | null): string {
  try {
    return signedUrl(email, emailType);
  } catch (e) {
    console.error('[unsubscribe] cannot sign link; falling back to preferences:', e instanceof Error ? e.message : e);
    return `${MINDY_SITE_URL}/alerts/preferences`;
  }
}

/** The verified address, or null when the link was not issued by us (or was tampered with). */
export function verifyUnsubscribe(e: string | null | undefined, t: string | null | undefined): string | null {
  if (!e || !t) return null;
  const email = unb64url(e);
  if (!email || !email.includes('@')) return null;
  for (const secret of emailActionVerificationSecrets()) {
    if (hexEquals(unsubscribeToken(email, secret), t)) return norm(email);
  }
  return null;
}

/**
 * RFC 8058 one-click headers. HTTPS only by default: a mailto: target is added only when UNSUBSCRIBE_MAILTO names a
 * mailbox that is actually processed — an unread mailto would be an unsubscribe that silently does nothing.
 */
export function listUnsubscribeHeaders(email: string, emailType?: string | null): Record<string, string> {
  const targets = [`<${signedUrl(email, emailType)}>`]; // strict: no header rather than a non-one-click target
  const mailto = process.env.UNSUBSCRIBE_MAILTO?.trim();
  if (mailto) targets.push(`<mailto:${mailto}?subject=unsubscribe>`);
  return { 'List-Unsubscribe': targets.join(', '), 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

/** Replace the footer placeholder (HTML-escaped where it sits inside markup is not needed: the URL is URL-safe). */
export function fillUnsubscribePlaceholder(text: string, email: string, emailType?: string | null): string {
  return text.includes(UNSUBSCRIBE_URL_PLACEHOLDER)
    ? text.split(UNSUBSCRIBE_URL_PLACEHOLDER).join(signedUrl(email, emailType).replace(/&/g, '&amp;'))
    : text;
}

/** Plain-text variant: no HTML entity escaping. */
export function fillUnsubscribePlaceholderText(text: string, email: string, emailType?: string | null): string {
  return text.includes(UNSUBSCRIBE_URL_PLACEHOLDER)
    ? text.split(UNSUBSCRIBE_URL_PLACEHOLDER).join(signedUrl(email, emailType))
    : text;
}
