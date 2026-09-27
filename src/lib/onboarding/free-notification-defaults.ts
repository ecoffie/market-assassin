/**
 * The row a FREE user gets when a write path finds no user_notification_settings row.
 *
 * One definition, used by every free-side "create if missing" path (/api/app/profile,
 * /api/company-setup). Paying customers go through ensureNotificationSettings(), which
 * stamps paid state — never this.
 *
 * Why it exists: /api/company-setup used a bare `.update()` that matched ZERO rows for a
 * user without a settings row and still answered success, so their confirmed codes were
 * silently dropped (Learn repair board P0-E, 2026-09-26: 665 of 2,760 auth users had no row).
 */
export function freeNotificationSettingsInsert(email: string, nowIso: string = new Date().toISOString()) {
  return {
    user_email: email,
    treatment_type: 'free',
    alerts_enabled: true,
    briefings_enabled: false,
    alert_frequency: 'daily',
    timezone: 'America/New_York',
    created_at: nowIso,
  };
}
