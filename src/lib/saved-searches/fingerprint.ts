import { canonicalizeSavedSearchFilters } from './validate-filters';
import type { SavedSearchFilters } from './types';
import type { SavedSearchAlertFrequency } from './constants';
import type { SavedSearchMode } from './constants';

export type SavedSearchFingerprintInput = {
  mode: SavedSearchMode;
  filters: SavedSearchFilters;
  alertFrequency: SavedSearchAlertFrequency;
  alertsEnabled: boolean;
};

/** Stable idempotency key for create — same market scope + cadence → same fingerprint. */
export function savedSearchFingerprint(input: SavedSearchFingerprintInput): string {
  const payload = {
    mode: input.mode,
    filters: canonicalizeSavedSearchFilters(input.filters),
    alert_frequency: input.alertFrequency,
    alerts_enabled: input.alertsEnabled,
  };
  return JSON.stringify(payload);
}

export function savedSearchesMatchFingerprint(
  row: { mode: string; filters: SavedSearchFilters; alert_frequency: string; alerts_enabled: boolean },
  fingerprint: string,
): boolean {
  return (
    savedSearchFingerprint({
      mode: row.mode as SavedSearchMode,
      filters: row.filters,
      alertFrequency: row.alert_frequency as SavedSearchAlertFrequency,
      alertsEnabled: row.alerts_enabled,
    }) === fingerprint
  );
}
