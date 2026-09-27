/**
 * Decide what (if anything) a profile save writes to `alerts_enabled`.
 *
 * Shared invariant: a partial update changes only explicitly submitted fields.
 * POST /api/app/profile (== /api/mindy/profile) used to hardcode
 * `alerts_enabled: true` on EVERY save, so an unrelated save — Market Research
 * "save to profile", the Map settings drawer, the capability nudge — silently
 * turned a user's alerts back ON after they had turned them off.
 *
 * Returns the value to write, or `undefined` = leave the column untouched.
 * A brand-new row still gets the default via freeNotificationSettingsInsert().
 */
export const ACTIVE_ALERT_FREQUENCIES = ['daily', 'weekdays', 'weekends', 'weekly'] as const;

export interface AlertsEnabledWriteInput {
  /** Explicit toggle from the caller. Only a real boolean counts. */
  alertsEnabled?: unknown;
  /** alertFrequency submitted in this request (may be absent). */
  alertFrequency?: unknown;
  /** alert_frequency currently stored on the row (null for a new row). */
  storedFrequency?: string | null;
}

export function resolveAlertsEnabledWrite(input: AlertsEnabledWriteInput): boolean | undefined {
  const { alertsEnabled, alertFrequency, storedFrequency } = input;
  // Choosing Paused always disables (keeps the daily-alerts cron from emailing a
  // user who paused) — it wins over a contradictory explicit true.
  if (alertFrequency === 'paused') return false;
  if (typeof alertsEnabled === 'boolean') return alertsEnabled;
  // Moving OFF paused to an active frequency is an explicit enable. Re-sending the
  // SAME stored active frequency (the Map drawer round-trips it) is not.
  if (
    storedFrequency === 'paused' &&
    typeof alertFrequency === 'string' &&
    (ACTIVE_ALERT_FREQUENCIES as readonly string[]).includes(alertFrequency)
  ) {
    return true;
  }
  return undefined;
}
