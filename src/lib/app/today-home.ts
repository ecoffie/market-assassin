/**
 * "Today" — one home screen after sign-in (DRAFT for Eric, ships OFF).
 *
 * Customers have five starting points (App, Map, Opportunities, Ask Mindy, the AI connector) and asked
 * "coffee in the morning, what's my first screen?". Today answers that with three things, built ONLY
 * from APIs the app already serves:
 *   1. Your saved searches + what is new since your last visit — GET /api/app/watchlist-brief (the same
 *      call the Map's Watchlist page makes; `newCount` is its badge rule). Today never calls
 *      `mark_seen`, so opening Today does not clear the Watchlist badge.
 *   2. Three open opportunities for your profile, closing soonest — GET /api/mi-dashboard?limit=3
 *      (the Today's Intel feed source), each with "Ask Mindy about this" (the existing Map → Ask Mindy
 *      handoff: sessionStorage `mindy_map_selected_opp`, then the chat panel).
 *   3. One link to the Map panel.
 *
 * Switch: NEXT_PUBLIC_TODAY_HOME === 'on'. Anything else (unset included) = OFF, and the app behaves
 * exactly as before: Today is not a panel, not in the sidebar, and ?panel=today is ignored.
 *
 * Unknown is never zero (CLAUDE.md rule 5): a list that fails to load is `unavailable`, never an empty
 * list or a 0 count. Pure: no window, no fetch — unit-tested in today-home.unit.test.ts.
 */

export const TODAY_PANEL = 'today' as const;

/** The code-level switch. Default OFF. `process.env.NEXT_PUBLIC_*` must be referenced literally to inline. */
export function isTodayHomeEnabled(value: string | undefined = process.env.NEXT_PUBLIC_TODAY_HOME): boolean {
  return value === 'on';
}

/** The panel a signed-in user lands on (and returns to on reload). */
export function homePanel<P extends string>(enabled: boolean, fallback: P): P | typeof TODAY_PANEL {
  return enabled ? TODAY_PANEL : fallback;
}

/** ?panel=today is honoured only while the switch is on. */
export function isTodayPanelParam(param: string | null | undefined, enabled: boolean): boolean {
  return enabled && param === TODAY_PANEL;
}

// ── Saved searches (from /api/app/watchlist-brief) ────────────────────────────────────────────────

export interface TodaySearch {
  id: string;
  name: string;
  /** New matches since the last Watchlist visit. 0 also when the search was never baselined. */
  newCount: number;
  matchedCount: number;
  /** matchedCount hit the server cap (300), so it is a floor. */
  capped: boolean;
}

export type Loadable<T> = { state: 'ok'; value: T } | { state: 'unavailable' };

function finiteCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

/** Parse a watchlist-brief response. Anything but a successful payload is `unavailable`. */
export function parseTodaySearches(json: unknown): Loadable<TodaySearch[]> {
  if (!json || typeof json !== 'object') return { state: 'unavailable' };
  const d = json as { success?: unknown; searches?: unknown };
  if (d.success !== true || !Array.isArray(d.searches)) return { state: 'unavailable' };
  const out: TodaySearch[] = [];
  for (const raw of d.searches) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    const newCount = finiteCount(s.newCount);
    const matchedCount = finiteCount(s.matchedCount);
    if (typeof s.id !== 'string' || !s.id || newCount === null || matchedCount === null) continue;
    out.push({
      id: s.id,
      name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : 'Saved search',
      newCount,
      matchedCount,
      capped: s.capped === true,
    });
  }
  return { state: 'ok', value: out };
}

/**
 * The one line under a saved search. "New since your last visit" is shown only when it is > 0: the
 * server reports 0 both for "nothing new" and for "never baselined", so a 0 is not claimed as news.
 */
export function savedSearchLine(s: TodaySearch): string {
  const matched = `${s.matchedCount}${s.capped ? '+' : ''} open ${s.matchedCount === 1 && !s.capped ? 'match' : 'matches'}`;
  if (s.newCount > 0) return `${s.newCount} new since your last visit · ${matched}`;
  return matched;
}

// ── Top matches (from /api/mi-dashboard) ──────────────────────────────────────────────────────────

export interface TodayMatch {
  noticeId: string;
  title: string;
  buyer: string;
  deadline: string;
}

const NOTICE_ID = /^[0-9a-f]{32}$/;

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Parse an mi-dashboard response into at most three matches. Anything but a successful payload is `unavailable`. */
export function parseTodayMatches(json: unknown): Loadable<TodayMatch[]> {
  if (!json || typeof json !== 'object') return { state: 'unavailable' };
  const d = json as { success?: unknown; opportunities?: unknown };
  if (d.success !== true || !Array.isArray(d.opportunities)) return { state: 'unavailable' };
  const out: TodayMatch[] = [];
  for (const raw of d.opportunities) {
    if (out.length >= 3) break;
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const noticeId = str(o.notice_id).toLowerCase();
    const title = str(o.title);
    if (!NOTICE_ID.test(noticeId) || !title) continue;
    out.push({
      noticeId,
      title,
      buyer: str(o.department) || str(o.agency) || str(o.sub_tier),
      deadline: str(o.response_deadline).slice(0, 10),
    });
  }
  return { state: 'ok', value: out };
}

/** The request URLs Today reads (exported so a test pins them to the existing APIs). */
export function todayRequests(email: string): { searches: string; matches: string } {
  const e = encodeURIComponent(email);
  return {
    searches: `/api/app/watchlist-brief?email=${e}`,
    matches: `/api/mi-dashboard?email=${e}&limit=3`,
  };
}
