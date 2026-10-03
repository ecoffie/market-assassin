/**
 * C-5 (2026-10-03): what a surface may SAY about the user's email alerts.
 *
 * `alerts_enabled` and `alert_frequency` are separate columns, and C-2 (#1734) made a profile
 * save leave `alerts_enabled` untouched. 8,674 users have alerts OFF while a daily/weekly
 * frequency is still stored, so "Saved — your daily alerts now track X" was a false claim for
 * them. A sentence may only claim delivery when the state is known to be ON; unknown never
 * becomes on.
 */
export type AlertState = 'on' | 'off' | 'unknown';

export function alertStateFrom(prefs: { alertsEnabled?: unknown; frequency?: unknown } | null | undefined): AlertState {
  if (!prefs) return 'unknown';
  if (prefs.alertsEnabled === false || prefs.frequency === 'paused') return 'off';
  if (prefs.alertsEnabled === true) return 'on';
  return 'unknown';
}

/** Confirmation after "Save this market to my profile". */
export function profileSavedMessage(state: AlertState, market: string): string {
  if (state === 'on') return `Saved — your email alerts now track “${market}”.`;
  if (state === 'off') return 'Saved to your profile. Email alerts are off, so Mindy is not emailing you about it. Turn them on in Settings.';
  return 'Saved to your profile.';
}

/** Label for the save button: never promise an alert change while alerts are off or unknown. */
export function saveToProfileLabel(state: AlertState): string {
  return state === 'on' ? 'Save this market to my profile (updates my alerts)' : 'Save this market to my profile';
}
