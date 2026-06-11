export const DEFAULT_PROFILE_NAICS = ['541512', '541611', '541330', '541990', '561210'];

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

/** True when the user is still on generic/default filters (no keywords, etc.). */
export function userNeedsMindySetup(user: AlertProfileFields): boolean {
  const hasKeywords = (user.keywords?.length ?? 0) > 0;
  const hasDescription = Boolean(user.business_description?.trim());
  const naics = user.naics_codes || [];
  const hasOnlyDefaults =
    naics.length === 0 ||
    (naics.length <= DEFAULT_PROFILE_NAICS.length &&
      naics.every(code => DEFAULT_PROFILE_NAICS.includes(code)));
  return !hasKeywords || !hasDescription || hasOnlyDefaults;
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
