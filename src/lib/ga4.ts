/**
 * GA4 custom events.
 *
 * The GA4 base tag (G-…) loads in src/app/layout.tsx alongside Google Ads — one
 * gtag.js serves both. This module fires GA4 *events* so the funnel is visible in
 * GA4 alone, without depending on the Google Ads conversion label (which is still
 * unset; see NEXT_PUBLIC_GADS_LEAD_LABEL).
 *
 * Why this exists: GA4 answers "how many people came and from where". It does NOT
 * know whether they signed up unless we tell it. Firing sign_up here closes the
 * loop — visits → signups — using only what is already wired.
 *
 * `sign_up` is a GA4 RECOMMENDED event name, so it lands in the standard reports
 * (Engagement → Events, and it can be marked a key event) rather than needing a
 * custom definition.
 */

type Gtag = (command: string, action: string, params?: Record<string, unknown>) => void;

function getGtag(): Gtag | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { gtag?: Gtag }).gtag;
}

/**
 * Fire a GA4 event. No-ops safely when gtag is absent (SSR, or NEXT_PUBLIC_GA_ID
 * unset in a preview build) so callers never have to guard.
 */
export function trackGA4Event(name: string, params: Record<string, unknown> = {}): void {
  const gtag = getGtag();
  if (!gtag) return;
  gtag('event', name, params);
}

/**
 * Signup completed — the user submitted a valid email and the API accepted it.
 * `method` distinguishes the entry path so the funnel can be split by source.
 *
 * ONLY wired to the EMAIL path today. The Google/Microsoft buttons redirect away
 * to the provider, so there is no success moment in this component — firing on
 * click would count every abandoned OAuth attempt as a signup. Their true
 * completion point is the /app/onboarding redirect, but EXISTING users land there
 * too, so it needs a first-time check before it can fire. Deliberately left out
 * rather than shipping an inflated number.
 */
export function trackSignUp(method: 'email' | 'google' | 'microsoft' = 'email'): void {
  trackGA4Event('sign_up', { method });
}
