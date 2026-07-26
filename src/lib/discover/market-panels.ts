/**
 * Discover "Market Panels" — two precomputed feeds for the Mindy landing page.
 *
 *   1. NAICS Leaderboard — the biggest federal markets by 3-FY contract spend, with
 *      REAL FY-over-FY rank movement (▲▼) so it reads like a stock board.
 *   2. Underserved markets — high-spend NAICS where a FEW vendors take MOST of the money
 *      (top-5 recipient concentration). NOT "few bidders" — a concentration proxy: where
 *      the incumbent grip is loose enough that the dollars are worth chasing.
 *
 * GROUNDED (Eric's #1 rule — no fabricated numbers): every figure comes from USASpending
 * via the CANONICAL market query lib (src/lib/market/spend-query.ts). We never hand-roll
 * the filter — that split is exactly what killed the Spending-by-Agency chart (#245).
 *
 * Built by /api/cron/build-discover-panels; the page reads cheap from discover_panel_cache.
 */
import {
  fetchSpendingCategory,
  buildSpendingFilters,
  CONTRACT_AWARD_TYPE_CODES,
} from '@/lib/market/spend-query';
import { naicsTitle } from '@/lib/discover/scope';
import { MARKET_SPEND_WINDOW } from '@/lib/utils/usaspending-helpers';
import { fiscalYearTimePeriod, latestCompleteFiscalYear } from '@/lib/utils/fiscal-year';
import { getReadClient, getWriteClient } from '@/lib/supabase/server-clients';

/** One row on the NAICS leaderboard (biggest federal markets by 3-FY spend). */
export interface NaicsLeaderRow {
  code: string;
  title: string;
  amount: number;
  rank: number;
  /**
   * FY-over-FY rank change: +N moved up N places, -N moved down, 0 unchanged.
   * 'new' = unranked in the prior FY's top list; null = unknown (absent this FY's list).
   */
  movement: number | 'new' | null;
}

/** One row of the "underserved" (concentration-proxy) panel. */
export interface UnderservedRow {
  code: string;
  title: string;
  amount: number;
  /** top-5 recipients' share of this NAICS's 3-FY spend, 0..1 (higher = more concentrated). */
  topVendorShare: number;
  rank: number;
}

export interface MarketPanels {
  naicsLeaderboard: NaicsLeaderRow[];
  underserved: UnderservedRow[];
  builtAt: string | null;
}

const PANEL_LEADERBOARD = 'naics_leaderboard';
const PANEL_UNDERSERVED = 'underserved';

/** The canonical 3-FY time_period used everywhere market spend is aggregated. */
const THREE_FY_TIME_PERIOD = [
  { start_date: MARKET_SPEND_WINDOW.start_date, end_date: MARKET_SPEND_WINDOW.end_date },
];

/** How many top NAICS to scan for the underserved concentration proxy. */
const UNDERSERVED_SCAN = 25;
/** How many underserved rows to keep for display. */
const UNDERSERVED_KEEP = 6;
/** How many leaderboard rows to keep for display. */
const LEADERBOARD_KEEP = 8;
/** Single-FY list depth used to rank movement (deeper than we display so climbers register). */
const MOVEMENT_LIST_LIMIT = 20;

/**
 * Read both panels from the cache table. Returns empty arrays + builtAt:null when unbuilt.
 * Binds { data, error } and SURFACES errors — a null read must never be silently coerced
 * to "empty" (that fabricates a "no markets" state; see Bug Prevention Rule #11).
 */
export async function getMarketPanels(): Promise<MarketPanels> {
  const { data, error } = await getReadClient()
    .from('discover_panel_cache')
    .select('panel, data, built_at')
    .in('panel', [PANEL_LEADERBOARD, PANEL_UNDERSERVED]);

  if (error) throw new Error(`getMarketPanels: ${error.message}`);

  const rows = (data ?? []) as Array<{ panel: string; data: unknown; built_at: string }>;
  const leader = rows.find((r) => r.panel === PANEL_LEADERBOARD);
  const under = rows.find((r) => r.panel === PANEL_UNDERSERVED);

  return {
    naicsLeaderboard: (leader?.data as NaicsLeaderRow[]) ?? [],
    underserved: (under?.data as UnderservedRow[]) ?? [],
    // Shared built_at — both rows are upserted together, so either is fine.
    builtAt: leader?.built_at ?? under?.built_at ?? null,
  };
}

/** Rank a spending_by_category('naics') list into a code → rank map (1-based). */
async function fetchNaicsRankMap(
  timePeriod: Array<{ start_date: string; end_date: string }>,
  limit: number,
  tag: string,
): Promise<Map<string, number>> {
  const rows = await fetchSpendingCategory(
    'naics',
    { award_type_codes: CONTRACT_AWARD_TYPE_CODES, time_period: timePeriod },
    limit,
    tag,
  );
  const map = new Map<string, number>();
  for (const r of rows) {
    // For the 'naics' category USASpending returns the code in `code` and the title in `name`.
    const code = (r.code || '').trim();
    if (code && !map.has(code)) map.set(code, r.rank);
  }
  return map;
}

/** Small concurrency throttle — USASpending is ~1 req/s per IP; run N at a time with a gap. */
async function inBatches<T, R>(
  items: T[],
  size: number,
  gapMs: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    out.push(...(await Promise.all(batch.map(fn))));
    if (i + size < items.length && gapMs > 0) {
      await new Promise((res) => setTimeout(res, gapMs));
    }
  }
  return out;
}

/**
 * Compute both panels from live USASpending + upsert them into discover_panel_cache.
 * Returns the row counts written.
 */
export async function buildMarketPanels(): Promise<{ naics: number; underserved: number }> {
  // --- 1. NAICS leaderboard: top NAICS by 3-FY contract spend ---
  const top = await fetchSpendingCategory(
    'naics',
    { award_type_codes: CONTRACT_AWARD_TYPE_CODES, time_period: THREE_FY_TIME_PERIOD },
    Math.max(UNDERSERVED_SCAN, LEADERBOARD_KEEP),
    'discover-panels/leaderboard',
  );
  if (!top.length) {
    throw new Error('buildMarketPanels: USASpending returned 0 NAICS for the 3-FY leaderboard');
  }

  // For the 'naics' category USASpending returns the code in `code` and the title in `name`.
  const normalizedTop = top.map((r, i) => ({
    code: (r.code || '').trim(),
    amount: r.amount,
    rank: i + 1,
  }));

  // --- movement: rank current FY vs prior FY (single-FY windows) ---
  const currentFy = latestCompleteFiscalYear();
  const priorFy = currentFy - 1;
  const [currentRanks, priorRanks] = await Promise.all([
    fetchNaicsRankMap([fiscalYearTimePeriod(currentFy)], MOVEMENT_LIST_LIMIT, 'discover-panels/fy-current'),
    fetchNaicsRankMap([fiscalYearTimePeriod(priorFy)], MOVEMENT_LIST_LIMIT, 'discover-panels/fy-prior'),
  ]);

  const naicsLeaderboard: NaicsLeaderRow[] = normalizedTop
    .slice(0, LEADERBOARD_KEEP)
    .map((r) => {
      const cur = currentRanks.get(r.code);
      const prev = priorRanks.get(r.code);
      let movement: number | 'new' | null;
      if (cur == null) movement = null; // not in this FY's ranked list → unknown
      else if (prev == null) movement = 'new'; // wasn't ranked last FY
      else movement = prev - cur; // + = climbed
      return {
        code: r.code,
        title: naicsTitle(r.code) || `NAICS ${r.code}`,
        amount: r.amount,
        rank: r.rank,
        movement,
      };
    });

  // --- 2. Underserved: top-5 recipient concentration on the highest-spend NAICS ---
  const scan = normalizedTop.slice(0, UNDERSERVED_SCAN).filter((r) => r.code && r.amount > 0);
  const withShare = await inBatches(scan, 4, 1100, async (r) => {
    const recipients = await fetchSpendingCategory(
      'recipient',
      buildSpendingFilters({ naicsCodes: [r.code] }),
      5,
      `discover-panels/recipients/${r.code}`,
    );
    const top5 = recipients.reduce((sum, x) => sum + (x.amount || 0), 0);
    // Concentration = top-5 share of THIS NAICS's own 3-FY spend. Clamp to [0,1] — a tiny
    // window/rounding mismatch between the two aggregations can nudge slightly over 1.
    const share = r.amount > 0 ? Math.min(1, top5 / r.amount) : 0;
    return { code: r.code, amount: r.amount, share, recipientsReturned: recipients.length };
  });

  const underserved: UnderservedRow[] = withShare
    // Only rows where we actually got recipient data (share is meaningful).
    .filter((r) => r.recipientsReturned > 0 && r.share > 0)
    .sort((a, b) => b.share - a.share) // most concentrated first
    .slice(0, UNDERSERVED_KEEP)
    .map((r, i) => ({
      code: r.code,
      title: naicsTitle(r.code) || `NAICS ${r.code}`,
      amount: r.amount,
      topVendorShare: r.share,
      rank: i + 1,
    }));

  // --- upsert both, shared built_at ---
  const builtAt = new Date().toISOString();
  const sb = getWriteClient();
  const { error } = await sb.from('discover_panel_cache').upsert(
    [
      { panel: PANEL_LEADERBOARD, data: naicsLeaderboard, built_at: builtAt },
      { panel: PANEL_UNDERSERVED, data: underserved, built_at: builtAt },
    ],
    { onConflict: 'panel' },
  );
  if (error) throw new Error(`buildMarketPanels upsert: ${error.message}`);

  return { naics: naicsLeaderboard.length, underserved: underserved.length };
}
