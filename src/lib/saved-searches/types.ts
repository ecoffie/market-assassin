import type { SavedSearchAlertFrequency, SavedSearchMode } from './constants';

export type SavedSearchBBox = { w: number; s: number; e: number; n: number };

export type SavedSearchFilters = Record<string, unknown>;

export type SavedSearchRow = {
  id: string;
  user_email: string;
  name: string;
  mode: SavedSearchMode;
  filters: SavedSearchFilters;
  bbox: SavedSearchBBox | null;
  alerts_enabled: boolean;
  alert_frequency: SavedSearchAlertFrequency;
  last_alerted_at: string | null;
  last_seen_notice_ids: string[];
  total_alerts_sent: number;
  created_at: string;
  updated_at: string;
};

export type CreateSavedSearchInput = {
  userEmail: string;
  name: string;
  mode?: SavedSearchMode;
  filters: SavedSearchFilters;
  bbox?: SavedSearchBBox | null;
  alertsEnabled?: boolean;
  alertFrequency?: SavedSearchAlertFrequency;
};

export type UpdateSavedSearchInput = {
  userEmail: string;
  id: string;
  name?: string;
  alertsEnabled?: boolean;
  alertFrequency?: SavedSearchAlertFrequency;
};

export type DeleteSavedSearchOptions = {
  /** MCP delete requires explicit confirmation. Map API omits this. */
  confirm?: boolean;
  requireConfirm?: boolean;
};

export type SavedSearchServiceErrorCode =
  | 'invalid_actor'
  | 'invalid_name'
  | 'invalid_filters'
  | 'invalid_mode'
  | 'invalid_frequency'
  | 'not_found'
  | 'confirmation_required'
  | 'unsupported_alert_scope'
  | 'profile_scope_unavailable'
  | 'scheduler_unavailable';

export type SavedSearchServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: SavedSearchServiceErrorCode; message: string };
