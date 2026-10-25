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
import { isSafeNext, safeNext } from './safe-next';
import { isLegacyDestination, postSignupPath } from './post-signup-destination';

export function signInReturnPath(rawNext: string | null | undefined): string | null {
  if (!isSafeNext(rawNext) || isLegacyDestination(rawNext)) return null;
  return postSignupPath({ next: rawNext });
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
