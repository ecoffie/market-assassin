/**
 * Unique "new" matches for a saved search.
 *
 * A match is NEW only if:
 *   1. The search has been baselined, AND
 *   2. Its notice_id is not in last_seen_notice_ids.
 *
 * Baseline happens on CREATE (current matches are the starting set, not "new")
 * and again when the user opens Watchlist (mark_seen). A never-baselined
 * search — empty last_seen AND no last_alerted_at — returns 0 so a just-saved
 * search cannot flash its whole current corpus as unseen.
 *
 * Counts are DISTINCT notice_ids. Duplicate rows in one search, and the same
 * notice matching two saved searches, must not inflate the KPI. Fetch cap is
 * shared with badge / mark_seen / brief so "new" can never be 300−200=100.
 */
import { parseMapFilters, applyMapFilters } from './map-filters';

export const SAVED_SEARCH_MATCH_CAP = 300;
export const SAVED_SEARCH_SEEN_CAP = 500; // stored last_seen slice; must be ≥ MATCH_CAP

export function uniqueNoticeIds(ids: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function isSearchBaselined(lastSeen: unknown, lastAlertedAt?: string | null): boolean {
  const seen = uniqueNoticeIds(Array.isArray(lastSeen) ? lastSeen : []);
  return seen.length > 0 || !!lastAlertedAt;
}

/**
 * Distinct notice_ids in `matchIds` that are not in `lastSeen`.
 * Empty when the search has never been baselined (just saved / never opened).
 */
export function unseenUniqueNoticeIds(
  matchIds: Array<string | null | undefined>,
  lastSeen: unknown,
  opts?: { lastAlertedAt?: string | null },
): string[] {
  if (!isSearchBaselined(lastSeen, opts?.lastAlertedAt)) return [];
  const seen = new Set(uniqueNoticeIds(Array.isArray(lastSeen) ? lastSeen : []));
  return uniqueNoticeIds(matchIds).filter((id) => !seen.has(id));
}

export function unseenUniqueCount(
  matchIds: Array<string | null | undefined>,
  lastSeen: unknown,
  opts?: { lastAlertedAt?: string | null },
): number {
  return unseenUniqueNoticeIds(matchIds, lastSeen, opts).length;
}

export function mergeSeenIds(existing: unknown, currentMatchIds: string[]): string[] {
  return uniqueNoticeIds([
    ...(Array.isArray(existing) ? existing : []),
    ...currentMatchIds,
  ]).slice(0, SAVED_SEARCH_SEEN_CAP);
}

export function parseSavedSearchFilters(raw: unknown) {
  const filters =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const f = parseMapFilters((k) => {
    const v = filters[k];
    if (v == null) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    return null;
  });
  f.postedDays = f.postedDays || 30;
  return f;
}

/**
 * Current unique notice_ids for a saved filter set, newest first, capped.
 * On query error returns [] (honest miss — never fabricate a "new" pile).
 */
export async function fetchSavedSearchNoticeIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  rawFilters: unknown,
): Promise<string[]> {
  const f = parseSavedSearchFilters(rawFilters);
  let q = db.from('sam_opportunities').select('notice_id').limit(SAVED_SEARCH_MATCH_CAP);
  q = applyMapFilters(q, f);
  const { data, error } = await q.order('posted_date', { ascending: false });
  if (error) return [];
  return uniqueNoticeIds((data || []).map((r: { notice_id?: string | null }) => r.notice_id));
}
