/**
 * The anonymous-visitor call to action on the public record pages /offices/[dodaac],
 * /recompetes/[slug] and /forecasts/[id].
 *
 * There is no free plan for new users since 2026-11-12: src/proxy.ts sends /app/signup and
 * /signup to /pricing, where Pro and Team start with a 14-day free trial. So these pages must
 * not promise a "free account", "free alerts" or "Sign up free", and must link straight to
 * /pricing instead of a sign-up URL that only redirects there (the redirect also dropped the
 * src/office attribution tags).
 */
export const TRIAL_HREF = '/pricing';

/** The button label shared by the three record pages. */
export const TRIAL_CTA_LABEL = 'Start your 14-day free trial →';

/** The trial link, tagged with the page family (and any extra key) for the landing-page record. */
export function recordTrialHref(src: string, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ src, ...extra });
  return `${TRIAL_HREF}?${q.toString()}`;
}
