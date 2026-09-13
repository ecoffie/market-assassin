/**
 * Shared MI session constants. Tiny file so cookie + HMAC modules
 * can share names/TTL without a circular import.
 */

/** First-party Mindy identity cookie. */
export const MI_AUTH_COOKIE = 'mi_auth';

/** 30-day Mindy session — HMAC payload `exp` and cookie maxAge share this. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
