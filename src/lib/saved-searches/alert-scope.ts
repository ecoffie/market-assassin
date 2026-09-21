import type { SavedSearchFilters } from './types';
import type { SavedSearchMode } from './constants';

function isRequestedFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
}

/** True when either the dataset mode or horizon filters ask for recompete data. */
export function savedSearchRequestsRecompetes(
  mode: SavedSearchMode,
  filters: SavedSearchFilters,
): boolean {
  if (mode === 'recompete') return true;
  const horizons = filters?.horizons;
  if (!horizons || typeof horizons !== 'object' || Array.isArray(horizons)) return false;
  return isRequestedFlag((horizons as Record<string, unknown>).recompete);
}

/** Mirrors wantsForecasts() in saved-search-alerts cron. */
export function savedSearchWantsForecasts(_mode: SavedSearchMode, filters: SavedSearchFilters): boolean {
  const h = filters?.horizons;
  if (h && typeof h === 'object' && !Array.isArray(h)) {
    return (h as Record<string, unknown>).forecast === true;
  }
  return false;
}

/**
 * Mirrors the saved-search-alerts cron dispatch gate:
 *   doOpen = mode === 'open'
 *   doForecast = wantsForecasts(...)
 *   if (!doOpen && !doForecast) continue  // silent skip today
 */
export function cronWillDeliverAlerts(mode: SavedSearchMode, filters: SavedSearchFilters): boolean {
  const doOpen = mode === 'open';
  const doForecast = savedSearchWantsForecasts(mode, filters);
  return doOpen || doForecast;
}

/** Any recompete request is unsupported until the cron gains a recompete corpus. */
export function isUnsupportedAlertScope(mode: SavedSearchMode, filters: SavedSearchFilters): boolean {
  return savedSearchRequestsRecompetes(mode, filters);
}

export function unsupportedAlertScopeMessage(): string {
  return (
    'Saved-search email alerts do not support recompete data yet. ' +
    'Remove the recompete mode/horizon or wait until the saved-search-alerts cron supports recompetes; ' +
    'Mindy will not silently substitute open opportunities or forecasts.'
  );
}

export function isProfileScopedFilters(filters: SavedSearchFilters): boolean {
  const scope = filters?.scope;
  if (typeof scope !== 'string') return false;
  return scope.trim().toLowerCase() === 'profile';
}
