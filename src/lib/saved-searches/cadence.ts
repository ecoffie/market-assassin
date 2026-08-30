import type { SavedSearchAlertFrequency } from './constants';

/** Frequencies due in this daily invocation. The drain pages these, it does not stop at one batch. */
export function dueSavedSearchFrequenciesAt(
  now: Date = new Date(),
): readonly SavedSearchAlertFrequency[] {
  return now.getUTCDay() === 1 ? ['daily', 'weekly'] : ['daily'];
}

/**
 * Delivery cadence used by the existing saved-search-alerts cron.
 * Daily runs whenever the daily cron fires; weekly runs Monday UTC only; paused never runs.
 */
export function isSavedSearchDueAt(
  frequency: SavedSearchAlertFrequency | string,
  now: Date = new Date(),
): boolean {
  if (frequency === 'paused') return false;
  if (frequency === 'weekly') return now.getUTCDay() === 1;
  return frequency === 'daily';
}
