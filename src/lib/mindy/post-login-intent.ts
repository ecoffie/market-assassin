/**
 * POST-LOGIN INTENT — where a magic-link sign-in should land.
 *
 * A magic link returns to the fixed `/app` URL issued by the identity provider (its redirect
 * allow-list decides what may appear there, so the destination is not carried through it). The
 * view the customer was on — e.g. `/app?panel=research&redeem=CODE` from a report-code link — was
 * therefore lost: they signed in and landed on the default feed.
 *
 * `/app` saves the intended view here when the link is REQUESTED and re-applies it once sign-in
 * completes. localStorage (not sessionStorage) so it survives the email client opening the link
 * in a NEW tab of the same browser. Opened on another device, it falls back to /app's normal
 * landing — nothing breaks.
 *
 * SAFETY: only the `/app` path, only `panel` / `notice` / `redeem`, each a short token; anything
 * else is dropped, so a stored value can never become an external or legacy destination. It
 * expires after an hour and is consumed once.
 */
export const POST_LOGIN_INTENT_KEY = 'mindy_post_login_intent';
export const POST_LOGIN_INTENT_TTL_MS = 60 * 60 * 1000;
const ALLOWED = ['panel', 'notice', 'redeem'] as const;
const TOKEN = /^[A-Za-z0-9_-]{1,64}$/;

/** Reduce a URL to a safe `/app?panel=…&notice=…&redeem=…`, or null if nothing worth keeping. */
export function sanitizeIntent(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let u: URL;
  try { u = new URL(raw, 'https://mindy.invalid'); } catch { return null; }
  if (u.origin !== 'https://mindy.invalid' || u.pathname !== '/app') return null;
  const out = new URLSearchParams();
  for (const k of ALLOWED) {
    const v = u.searchParams.get(k);
    if (v && TOKEN.test(v)) out.set(k, v);
  }
  const qs = out.toString();
  return qs ? `/app?${qs}` : null;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): Store | null => { try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; } };

export function savePostLoginIntent(currentUrl: string, now = Date.now(), s: Store | null = store()): boolean {
  const intent = sanitizeIntent(currentUrl);
  if (!s || !intent) return false;
  try { s.setItem(POST_LOGIN_INTENT_KEY, JSON.stringify({ intent, at: now })); return true; } catch { return false; }
}

/** Return the saved intent once (then forget it); null if absent, expired or malformed. */
export function consumePostLoginIntent(now = Date.now(), s: Store | null = store()): string | null {
  if (!s) return null;
  let raw: string | null = null;
  try { raw = s.getItem(POST_LOGIN_INTENT_KEY); s.removeItem(POST_LOGIN_INTENT_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const { intent, at } = JSON.parse(raw) as { intent?: string; at?: number };
    if (typeof at !== 'number' || now - at > POST_LOGIN_INTENT_TTL_MS || now < at) return null;
    return sanitizeIntent(intent);
  } catch { return null; }
}
