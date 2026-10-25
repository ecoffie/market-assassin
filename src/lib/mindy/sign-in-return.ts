/**
 * Where a RETURNING user goes after signing in on /app, when they arrived with `?next=`.
 *
 * Google/Microsoft already honoured `next` (via /app/onboarding). Password and email-code sign-in
 * did not: they finished on /app no matter where the user started, so "Sign in" from a Learn
 * tutorial dropped them on the dashboard instead of the tutorial (Joseph Boyd, 2026-10-25).
 *
 * Returns the destination only when `next` passes `safeNext` (internal path, no protocol-relative
 * or backslash tricks, never /app) and is not a legacy surface. Anything else → null, meaning
 * "stay on /app" — the pre-existing behaviour, never an external site.
 */
import { isSafeNext, safeNext, withNext } from './safe-next';
import { isLegacyDestination, postSignupPath, WELCOME_PATH } from './post-signup-destination';

/**
 * The ONE sign-in action link: Mindy's only sign-in surface is /app, which now returns to `next`.
 * Pages that must never link INTO the legacy app as a destination (/welcome/company) may still
 * offer sign-in through this — the user comes back to the page they were on, not to /app.
 */
export const SIGN_IN_PATH = '/app';
export function signInHref(rawNext: string | null | undefined): string {
  return withNext(SIGN_IN_PATH, rawNext);
}

export function signInReturnPath(rawNext: string | null | undefined): string | null {
  if (!isSafeNext(rawNext) || isLegacyDestination(rawNext)) return null;
  return postSignupPath({ next: rawNext });
}

/**
 * MAGIC LINK. The emailed link lands on bare /app (Supabase `redirectTo`); its `next` cannot ride
 * along without changing Supabase's redirect allow-list, and a URL Supabase rejects falls back to
 * the Site URL — breaking magic-link sign-in outright. So /app remembers the requested `next` in
 * THIS browser when the link is requested and honours it when the link is opened. Opened on a
 * different device → no pending value → /app, exactly as before. Stored value is re-validated
 * on read (it is user-writable), expires with the link, and is used once.
 */
export const PENDING_NEXT_KEY = 'mindy_signin_next';
export const PENDING_NEXT_TTL_MS = 60 * 60 * 1000;

export function encodePendingNext(rawNext: string | null | undefined, now: number): string | null {
  const dest = signInReturnPath(rawNext);
  return dest ? JSON.stringify({ next: dest, at: now }) : null;
}

export function readPendingNext(stored: string | null | undefined, now: number): string | null {
  if (!stored) return null;
  try {
    const v = JSON.parse(stored) as { next?: unknown; at?: unknown };
    if (typeof v.next !== 'string' || typeof v.at !== 'number') return null;
    if (v.at > now || now - v.at > PENDING_NEXT_TTL_MS) return null;
    return signInReturnPath(v.next);
  } catch {
    return null;
  }
}

/**
 * A NEW account is sent to the /welcome intent router before anything else. It must carry the
 * destination the user signed in for: /welcome's "show me the map" link and its company-setup
 * step both already return to a safe `next` (welcome/page.tsx). Without one → bare /welcome.
 */
export function onboardingRedirectPath(returnPath: string | null): string {
  return withNext(WELCOME_PATH, returnPath);
}

/**
 * OAuth `redirectTo` for /app/onboarding, carrying `next` only when `safeNext` accepts it.
 * Replaces an inline `startsWith('/') && !startsWith('//')` check that let `/\evil.com` through
 * (onboarding re-guarded it, but the first hop should not carry it at all).
 */
export function oauthOnboardingRedirect(origin: string, rawNext: string | null | undefined): string {
  const base = `${origin}/app/onboarding`;
  return isSafeNext(rawNext) ? `${base}?next=${encodeURIComponent(safeNext(rawNext))}` : base;
}
