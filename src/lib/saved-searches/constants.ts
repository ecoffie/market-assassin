/** Cadence presets supported by saved-search alerts (matches map + cron). */
export const ALLOWED_ALERT_FREQUENCY = ['daily', 'weekly', 'paused'] as const;
export type SavedSearchAlertFrequency = (typeof ALLOWED_ALERT_FREQUENCY)[number];

/** Map dataset mode stored on each saved search row. */
export const ALLOWED_SAVED_SEARCH_MODE = ['open', 'recompete'] as const;
export type SavedSearchMode = (typeof ALLOWED_SAVED_SEARCH_MODE)[number];

export const SAVED_SEARCH_NAME_MAX = 80;
export const LAST_SEEN_NOTICE_IDS_CAP = 500;
