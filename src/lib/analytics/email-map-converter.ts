/**
 * Email → map converter — the ONE grounded read behind three surfaces (the Mission Control
 * dashboard card, the per-person ledger card, and the daily Slack digest).
 *
 * We added a tracked "Open Today's Map →" button to the daily alert email. A click writes a
 * `user_engagement` row via /api/track → recordLinkClick → logLinkClick:
 *     event_type   = 'link_click'
 *     event_source = 'daily_alert'
 *     metadata->>'link_text' IN ('todays_lens_map', 'todays_lens_map_quiet')   ← the two labels
 *     user_email   = the resolved recipient  (per-person identity)
 *     created_at   = click time
 * A map ARRIVAL is a page_view whose metadata.action = 'map_view' from the map sources.
 *
 * This is the SINGLE place that query lives (no lib-duplicate drift — the dashboard, ledger and
 * Slack digest all call computeEmailMapConverter). GROUND-IN-REAL-DATA: every read binds
 * { data, error } and THROWS on error — a null count is never coerced into a fabricated 0
 * (Bug Prevention Rule #11). A rate whose denominator is 0 is `null` ("no data yet"), never 0%.
 * Staff / testimonial / advocate emails are excluded via isExcludedFromMetrics.
 */

import { getReadClient } from '@/lib/supabase/server-clients';
import { isExcludedFromMetrics } from '@/lib/mindy/campaign-exclusions';

// The two labels set on the daily-alert map button (in-app quiet variant + the loud one).
export const MAP_BUTTON_LINK_TEXTS = ['todays_lens_map', 'todays_lens_map_quiet'] as const;
// A map ARRIVAL: page_view from the map surfaces carrying metadata.action = 'map_view'.
const MAP_ARRIVAL_SOURCES = ['opportunity_map', 'source_feed'];
// Cap the per-person ledger — newest-first, most recent N.
const RECENT_CLICKERS_CAP = 200;

export interface EmailMapConverter {
  windowDays: number;
  clicks: number; // total link_click rows on the map buttons in-window
  clickers: number; // DISTINCT users who clicked
  mapReached: number; // of those clickers, how many ALSO have a map_view in-window
  clickToReachRate: number | null; // mapReached / clickers * 100, 1dp; null when clickers===0 (never a fabricated 0%)
  recentClickers: Array<{ email: string; clicks: number; lastClickAt: string; reachedMap: boolean }>; // per-person, newest-first, capped
}

interface EngRow {
  user_email: string | null;
  created_at: string | null;
  metadata: { link_text?: string; action?: string } | null;
}

/**
 * Page the user_engagement read past PostgREST's 1000-row cap. A busy month exceeds it; an
 * unpaged query would silently undercount. { data, error } bound + thrown on error.
 */
async function readAllPages(
  build: (from: number, to: number) => PromiseLike<{ data: EngRow[] | null; error: { message: string } | null }>,
): Promise<EngRow[]> {
  const rows: EngRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    if (from > 500_000) break; // hard backstop; a month of alert clicks is far under this
  }
  return rows;
}

export async function computeEmailMapConverter(windowDays: number): Promise<EmailMapConverter> {
  const days = Math.min(Math.max(Math.floor(windowDays) || 1, 1), 365);
  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();
  const supabase = getReadClient();

  // 1) The map-button CLICKS (the query key above), paginated.
  const clickRows = await readAllPages((from, to) =>
    supabase
      .from('user_engagement')
      .select('user_email, created_at, metadata')
      .eq('event_type', 'link_click')
      .eq('event_source', 'daily_alert')
      .in('metadata->>link_text', MAP_BUTTON_LINK_TEXTS as unknown as string[])
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .range(from, to),
  );

  // 2) The map ARRIVALS in-window — distinct emails with a map_view. Paginated.
  const arrivalRows = await readAllPages((from, to) =>
    supabase
      .from('user_engagement')
      .select('user_email, created_at, metadata')
      .eq('event_type', 'page_view')
      .in('event_source', MAP_ARRIVAL_SOURCES)
      .eq('metadata->>action', 'map_view')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .range(from, to),
  );

  const mapReachedEmails = new Set<string>();
  for (const r of arrivalRows) {
    const email = (r.user_email || '').toLowerCase();
    if (!email || isExcludedFromMetrics(email)) continue;
    mapReachedEmails.add(email);
  }

  // Group clicks per clicker → { clicks, lastClickAt }. Staff excluded.
  const perClicker = new Map<string, { clicks: number; lastClickAt: string }>();
  let clicks = 0;
  for (const r of clickRows) {
    const email = (r.user_email || '').toLowerCase();
    if (!email || isExcludedFromMetrics(email)) continue;
    const at = r.created_at || '';
    clicks += 1;
    const prev = perClicker.get(email);
    if (!prev) {
      perClicker.set(email, { clicks: 1, lastClickAt: at });
    } else {
      prev.clicks += 1;
      if (at > prev.lastClickAt) prev.lastClickAt = at;
    }
  }

  const clickers = perClicker.size;
  let mapReached = 0;
  for (const email of perClicker.keys()) if (mapReachedEmails.has(email)) mapReached += 1;

  // null when there are no clickers to divide by — never a fabricated 0%.
  const clickToReachRate = clickers > 0 ? Math.round((mapReached / clickers) * 1000) / 10 : null;

  const recentClickers = [...perClicker.entries()]
    .map(([email, v]) => ({ email, clicks: v.clicks, lastClickAt: v.lastClickAt, reachedMap: mapReachedEmails.has(email) }))
    .sort((a, b) => (a.lastClickAt < b.lastClickAt ? 1 : a.lastClickAt > b.lastClickAt ? -1 : 0)) // newest-first
    .slice(0, RECENT_CLICKERS_CAP);

  return { windowDays: days, clicks, clickers, mapReached, clickToReachRate, recentClickers };
}
