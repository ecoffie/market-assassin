/**
 * Client-side helpers for persisting the Mindy access email.
 *
 * Two storage backends must stay in sync:
 *   - localStorage('briefings_access_email')  — read by /briefings page on mount
 *   - document.cookie('ma_access_email')      — read by every cookie-auth API
 *
 * Historically these were written inline at many call sites and the cookie was
 * easy to forget, which is what caused Pro users like Juliette to be bounced
 * back to onboarding (the preferences API returned 401, the UI interpreted
 * that as "no saved profile" and forced re-onboarding). Always use these
 * helpers so the two stores can't drift apart.
 */

const LOCAL_KEY = 'briefings_access_email';
const COOKIE_KEY = 'ma_access_email';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Write the access email to BOTH localStorage and the auth cookie.
 * Safe to call multiple times. Trims + lowercases before storing.
 */
export function persistAccessEmail(email: string): void {
  if (typeof window === 'undefined') return;
  const normalized = (email || '').toLowerCase().trim();
  if (!normalized) return;

  try {
    window.localStorage.setItem(LOCAL_KEY, normalized);
  } catch {
    // localStorage can throw in private windows; cookie alone is enough
  }
  document.cookie = `${COOKIE_KEY}=${normalized}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

/**
 * Read the access email from localStorage. Returns null if missing.
 */
export function readStoredAccessEmail(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(LOCAL_KEY);
  } catch {
    return null;
  }
}

/**
 * Read the access email from document.cookie. Returns null if missing.
 */
export function readAccessCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)ma_access_email=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Reconcile the two stores on app mount. If one has the email and the other
 * doesn't, copy it over. This is the recovery path for users who got
 * stranded mid-session — they reload and we restore the auth cookie from
 * localStorage so the next API call works.
 *
 * Returns the reconciled email, or null if neither store has one.
 */
export function reconcileAccessEmail(): string | null {
  const stored = readStoredAccessEmail();
  const cookie = readAccessCookie();

  if (stored && !cookie) {
    document.cookie = `${COOKIE_KEY}=${stored}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
    return stored;
  }
  if (cookie && !stored) {
    try {
      window.localStorage.setItem(LOCAL_KEY, cookie);
    } catch {
      // ignored
    }
    return cookie;
  }
  return stored || cookie || null;
}

/**
 * Clear both stores. Used on sign-out / access-denied.
 */
export function clearAccessEmail(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LOCAL_KEY);
  } catch {
    // ignored
  }
  document.cookie = `${COOKIE_KEY}=; path=/; max-age=0; SameSite=Lax`;
}
