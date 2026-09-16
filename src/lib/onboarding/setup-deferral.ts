/**
 * Skipping profile setup is a deferral, not a profile and not an alert enrollment.
 *
 * The /app gate used `needsOnboarding = no NAICS`. A skip that writes nothing left
 * that flag true, so the next visit sent the user straight back into setup. Writing
 * a notification row to "remember" the skip would also flip `alerts_enabled` on
 * (the insert default / profile route's baseInsert). Neither is allowed.
 *
 * The marker lives on `user_profiles.preferences.setupDeferredAt`. It is not NAICS,
 * not provenance, and not a send gate.
 */

export const SETUP_DEFERRED_AT = 'setupDeferredAt';

/** Where Settings sends someone who wants to finish what they skipped. */
export const FINISH_SETUP_PATH = '/welcome/company';

export function profileSetupRequired(input: {
  naicsCodes?: string[] | null;
  preferences?: Record<string, unknown> | null;
}): boolean {
  const codes = input.naicsCodes;
  if (Array.isArray(codes) && codes.some((c) => String(c || '').trim().length > 0)) return false;
  const at = input.preferences?.[SETUP_DEFERRED_AT];
  if (typeof at === 'string' && at.trim().length > 0) return false;
  return true;
}

/**
 * Merge the deferral stamp onto existing preferences. Does not add NAICS,
 * alert_frequency, or alerts_enabled — those fields are not on this object.
 */
export function deferralPreferencePatch(
  existing: Record<string, unknown> | null | undefined,
  nowIso: string,
): Record<string, unknown> {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  return { ...base, [SETUP_DEFERRED_AT]: nowIso };
}

/** A skip write must not contain the columns that enroll someone in alerts. */
export function skipWriteTouchesAlerts(patch: Record<string, unknown>): boolean {
  return (
    'alerts_enabled' in patch
    || 'alert_frequency' in patch
    || 'briefings_enabled' in patch
    || 'naics_codes' in patch
  );
}
