import type { SavedSearchAlertFrequency } from './constants';

export type NormalizedAlertPreferences = {
  alertsEnabled: boolean;
  alertFrequency: SavedSearchAlertFrequency;
};

/**
 * Canonical alert state — no contradictory paused/enabled pairs.
 * Active alerting: alerts_enabled=true with daily|weekly cadence.
 * Paused: alerts_enabled=false (frequency stored as paused for MCP clarity).
 */
export function normalizeAlertPreferences(opts: {
  alertsEnabled?: boolean;
  alertFrequency?: SavedSearchAlertFrequency;
}): NormalizedAlertPreferences {
  let alertFrequency: SavedSearchAlertFrequency = opts.alertFrequency ?? DEFAULT_ALERT_FREQUENCY;
  let alertsEnabled = opts.alertsEnabled !== false;

  if (alertFrequency === 'paused') {
    alertsEnabled = false;
  }

  if (!alertsEnabled) {
    return { alertsEnabled: false, alertFrequency: 'paused' };
  }

  if (alertFrequency === 'paused') {
    alertFrequency = 'daily';
  }

  return { alertsEnabled: true, alertFrequency };
}

/** The alert frequency a new saved search gets when none is chosen (the Map save dialog preselects it). */
export const DEFAULT_ALERT_FREQUENCY = 'daily' as const;
