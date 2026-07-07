export const DEFAULT_PROFILE_NAICS = ['541512', '541611', '541330', '541990', '561210'];

// The full set of PLACEHOLDER/seed NAICS a user never actually chose — the 541 IT
// onboarding sweep PLUS the healthcare nudge defaults (config/defaults.ts). Kept here
// as the single source of truth so the capability vector, the in-app nudge, and the
// email strip all agree on "did this user set a real profile?" (memory:
// prefilled_naics_not_real_signal). Import this, don't re-hardcode a subset.
export const SEED_NAICS_CODES = [
  ...DEFAULT_PROFILE_NAICS,
  // config/defaults.ts DEFAULT_NAICS_CODES (healthcare nudge)
  '621111', '621210', '621511', '621610', '622110', '622310', '623110', '623312', '624120',
];
const SEED_NAICS_SET = new Set(SEED_NAICS_CODES);

// Generic keywords that ride along with the seed sweeps — real keyword signal
// requires at least one term NOT in this set. Exported so the capability-vector blob
// builder filters the same generic terms it won't count as signal.
export const GENERIC_KEYWORDS_FOR_BLOB = new Set([
  'computer', 'systems', 'design', 'administrative', 'management', 'engineering',
  'professional', 'scientific', 'technical', 'facilities', 'services', 'support',
]);
const GENERIC_KEYWORDS = GENERIC_KEYWORDS_FOR_BLOB;

/**
 * True when the NAICS set is ONLY seed/placeholder codes (or empty) — i.e. the user
 * never edited it. A user who kept the sweep but ADDED a real code is NOT seed-only.
 */
export function isSeedNaicsOnly(naicsCodes: string[] | null | undefined): boolean {
  const naics = (naicsCodes || []).map(c => String(c).trim()).filter(Boolean);
  if (naics.length === 0) return true;
  return naics.every(code => SEED_NAICS_SET.has(code));
}

/** True when at least one keyword is a real (non-generic) term. */
export function hasRealKeyword(keywords: string[] | null | undefined): boolean {
  return (keywords || []).some(k => {
    const t = String(k).trim().toLowerCase();
    return t.length > 2 && !GENERIC_KEYWORDS.has(t);
  });
}

/**
 * THE canonical "did this user set a real, non-placeholder profile?" check.
 * True when they have a real (non-seed) NAICS OR a real keyword. This is exactly the
 * capability-vector eligibility signal, so the Hidden Work nudge shows precisely for
 * the users who get NO semantic matches — and vanishes the instant they fix it.
 */
export function hasRealProfile(
  user: { naics_codes?: string[] | null; keywords?: string[] | null }
): boolean {
  return !isSeedNaicsOnly(user.naics_codes) || hasRealKeyword(user.keywords);
}

/** Profile-setup CTAs on alert emails during this window, then access-only mode. */
export const ALERT_CONVERSION_WINDOW_DAYS = 30;

/** Fallback when enrolled_at is missing — stop nudging after this many alerts. */
export const ALERT_CONVERSION_MAX_ALERTS = 25;

export interface AlertProfileFields {
  naics_codes?: string[] | null;
  keywords?: string[] | null;
  business_description?: string | null;
}

export interface AlertEnrollmentFields {
  created_at?: string | null;
  total_alerts_sent?: number | null;
}

/** True when NAICS codes are still the generic onboarding defaults only. */
export function hasOnlyDefaultNaics(naicsCodes: string[] | null | undefined): boolean {
  const naics = naicsCodes || [];
  return (
    naics.length === 0 ||
    (naics.length <= DEFAULT_PROFILE_NAICS.length &&
      naics.every(code => DEFAULT_PROFILE_NAICS.includes(code)))
  );
}

/**
 * True when alert filters are still too thin for keyword-first matching AND for
 * semantic Hidden Work discovery. Uses the canonical hasRealProfile check — so a user
 * carrying ONLY a seed sweep (541 IT or healthcare defaults) or generic keywords still
 * counts as "needs setup", not just the exact 541-sweep case. This aligns the email
 * strip audience with the capability-vector eligibility + the in-app Hidden Work nudge.
 */
export function userNeedsMindySetup(user: AlertProfileFields): boolean {
  return !hasRealProfile({ naics_codes: user.naics_codes, keywords: user.keywords });
}

/** Auto-fill description when user saves keywords but skips the textarea. */
export function deriveBusinessDescriptionFromKeywords(keywords: string[]): string | null {
  const clean = keywords.map(k => k.trim()).filter(Boolean).slice(0, 6);
  if (clean.length === 0) return null;
  return `Federal contractor: ${clean.join(', ')}.`;
}

/** First ~30 days after enrollment — show signup/profile CTAs on alert emails. */
export function isInAlertConversionWindow(user: AlertEnrollmentFields): boolean {
  if (user.created_at) {
    const enrolledAt = new Date(user.created_at).getTime();
    if (!Number.isNaN(enrolledAt)) {
      const daysSince = (Date.now() - enrolledAt) / (1000 * 60 * 60 * 24);
      return daysSince < ALERT_CONVERSION_WINDOW_DAYS;
    }
  }

  const sent = user.total_alerts_sent ?? 0;
  if (sent >= ALERT_CONVERSION_MAX_ALERTS) {
    return false;
  }

  // No enrollment signal — assume new subscriber.
  return true;
}

/**
 * Show aggressive Mindy signup / keyword-setup nudges on alert emails.
 * After the conversion window, established users get access-only messaging
 * even if they never completed their profile.
 */
export function shouldShowAlertSetupNudges(
  user: AlertProfileFields & AlertEnrollmentFields
): boolean {
  return isInAlertConversionWindow(user) && userNeedsMindySetup(user);
}
