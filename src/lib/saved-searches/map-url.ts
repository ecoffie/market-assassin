import { MINDY_URL } from '@/lib/alerts/saved-search-email';

/** Canonical Map deep link for a saved search — same shape as alert emails and Watchlist. */
export function buildSavedSearchMapUrl(savedSearchId: string, opts?: { noticeId?: string; src?: string }): string {
  const qs: string[] = [];
  if (opts?.noticeId) qs.push(`opp=${encodeURIComponent(opts.noticeId)}`);
  if (savedSearchId) {
    qs.push(`ss=${encodeURIComponent(savedSearchId)}`);
    qs.push(`src=${encodeURIComponent(opts?.src || 'saved_search')}`);
  }
  return `${MINDY_URL}/opportunity-map${qs.length ? `?${qs.join('&')}` : ''}`;
}
