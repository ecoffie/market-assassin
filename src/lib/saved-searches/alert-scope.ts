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

function isOffFlag(value: unknown): boolean {
  if (value === false || value === 0) return true;
  if (typeof value !== 'string') return false;
  return ['0', 'false', 'no'].includes(value.trim().toLowerCase());
}

/**
 * Does this saved search want OPEN alerts? (F2, 2026-10-10)
 *
 * The cron used `mode === 'open'` alone, so a watch saved with the Open chip
 * UNCHECKED (Forecast only) was emailed Open listings anyway — measured on prod:
 * 9 such watches, 6 users, 8 of them already carrying sent Open ids. The saved
 * horizon is the user's instruction. A search saved before horizons were
 * captured has no `horizons` key and stays Open, which is what its owner saw.
 */
export function savedSearchWantsOpen(mode: SavedSearchMode, filters: SavedSearchFilters): boolean {
  if (mode !== 'open') return false;
  const h = filters?.horizons;
  if (!h || typeof h !== 'object' || Array.isArray(h)) return true;
  return !isOffFlag((h as Record<string, unknown>).open);
}

/**
 * Mirrors the saved-search-alerts cron dispatch gate:
 *   doOpen = savedSearchWantsOpen(...)
 *   doForecast = wantsForecasts(...)
 *   if (!doOpen && !doForecast) continue  // silent skip today
 */
export function cronWillDeliverAlerts(mode: SavedSearchMode, filters: SavedSearchFilters): boolean {
  const doOpen = savedSearchWantsOpen(mode, filters);
  const doForecast = savedSearchWantsForecasts(mode, filters);
  return doOpen || doForecast;
}

/** Any recompete request is unsupported until the cron gains a recompete corpus. */
export function isUnsupportedAlertScope(mode: SavedSearchMode, filters: SavedSearchFilters): boolean {
  return savedSearchRequestsRecompetes(mode, filters);
}

/** Neither Open nor Forecast is on: nothing an alert could email. Distinct from a recompete request. */
export function noDeliverableHorizonMessage(): string {
  return (
    'This search has nothing email alerts can deliver. Turn on Open or Forecast, then save again — ' +
    'Recompetes are not emailed.'
  );
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

/**
 * What an alert can actually deliver for a watch, with recompete removed (F3).
 *
 *   full    — no recompete requested; deliverable as stored.
 *   partial — recompete requested alongside Open and/or Forecast; deliverable once
 *             `horizons.recompete` is false (returned in `filters`).
 *   none    — nothing emailable (recompete only, or the recompete dataset).
 *
 * Server mirror of the Map's window.__watchScopePlan. Never broadens: it only
 * removes recompete, and never turns on a horizon the user did not select.
 */
export function alertableScope(
  mode: SavedSearchMode,
  filters: SavedSearchFilters,
): { kind: 'full' | 'partial' | 'none'; filters: SavedSearchFilters | null } {
  const f = (filters && typeof filters === 'object' && !Array.isArray(filters)) ? filters : {};
  if (mode === 'recompete') return { kind: 'none', filters: null };
  if (!savedSearchRequestsRecompetes(mode, f)) {
    return cronWillDeliverAlerts(mode, f) ? { kind: 'full', filters: f } : { kind: 'none', filters: null };
  }
  const h = f.horizons as Record<string, unknown>;
  const narrowed: SavedSearchFilters = { ...f, horizons: { ...h, recompete: false } };
  return cronWillDeliverAlerts(mode, narrowed) ? { kind: 'partial', filters: narrowed } : { kind: 'none', filters: null };
}
