/**
 * ONE definition of "where do we send the user after auth", and the guard that makes it safe.
 *
 * WHY: signup from a Maps route lost its origin at the very first hop. The corridor is
 *
 *     Maps route → modal signup → email → /app/setup-password → /app/onboarding → ???
 *
 * and every stage dropped the destination, so a new user who signed up from
 * /opportunity-map/pursuits finished inside the LEGACY /app. Each stage now forwards `next`,
 * and this module owns both the validation and the fallback so the rule cannot drift between
 * the five places that need it.
 *
 * THE RULE:  an explicit SAFE next wins; otherwise the Maps front door.
 *
 * ⚠️ OPEN-REDIRECT GUARD. `next` arrives from a URL the user can edit, so it is untrusted
 * input. It must be an internal path and nothing else:
 *   - must start with a single "/"           → rejects https://evil.com
 *   - must NOT start with "//" or "/\"       → rejects protocol-relative //evil.com
 *   - must NOT contain a backslash           → rejects /\evil.com
 *   - must NOT re-enter the legacy app       → the whole point is to stop landing in /app
 * Anything failing these becomes the fallback rather than an error: a bad `next` should send
 * the user somewhere sensible, never to an attacker's site and never to a dead end.
 */
import { MAPS_HOME_PATH } from './maps-home';

/** Where a user goes when there is no usable `next`. */
export const DEFAULT_POST_AUTH_PATH = MAPS_HOME_PATH;

/** Control characters are never legitimate in a path we are about to navigate to.
 *  Checked by CODEPOINT rather than a literal character class: writing the raw bytes into
 *  the source is how NUL/0x1f ended up embedded in this very file on the first attempt. */
function hasControlChars(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * Validate an untrusted `next` and fall back when it is unusable.
 * Returns a path that is always safe to hand to router.push()/location.href.
 */
export function safeNext(raw: string | null | undefined, fallback: string = DEFAULT_POST_AUTH_PATH): string {
  const v = (raw || '').trim();
  if (!v) return fallback;
  if (!v.startsWith('/')) return fallback;                          // absolute/external URL
  if (v.startsWith('//') || v.startsWith('/\\')) return fallback;   // protocol-relative
  if (v.includes('\\')) return fallback;                            // backslash tricks
  if (/^\/+app(\/|\?|#|$)/i.test(v)) return fallback;               // never re-enter the legacy app
  if (hasControlChars(v)) return fallback;
  return v;
}

/** True when `raw` is a usable internal destination (i.e. safeNext would keep it). */
export function isSafeNext(raw: string | null | undefined): boolean {
  const v = (raw || '').trim();
  return v.length > 0 && safeNext(v, 'SENTINEL') !== 'SENTINEL';
}

/** Append `next` to a URL only when it is genuinely safe and present. */
export function withNext(url: string, raw: string | null | undefined): string {
  if (!isSafeNext(raw)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}next=${encodeURIComponent(safeNext(raw))}`;
}
