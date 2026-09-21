/**
 * Typed Search Console performance queries (site-agnostic; the resolved property is chosen in client.ts).
 *
 * GSC reports clicks, impressions, CTR, and average position. Data
 * lags ~2-3 days, so date ranges here end 3 days before "today".
 */
import { gscQuery } from './client';

export interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number; // 0..1
  position: number; // average rank
}

interface GscResponse {
  rows?: GscRow[];
}

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;
}

/** UTC date string N days before the given reference date. */
export function daysAgo(ref: Date, n: number): string {
  const d = new Date(ref.getTime() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * The trailing 28-day window and the 28 days before it, both ending
 * `lagDays` before `ref` (GSC data lags). Used for period-over-period.
 */
export function trailing28Windows(ref: Date, lagDays = 3): {
  current: DateRange;
  previous: DateRange;
} {
  const end = daysAgo(ref, lagDays);
  const start = daysAgo(ref, lagDays + 27);
  const prevEnd = daysAgo(ref, lagDays + 28);
  const prevStart = daysAgo(ref, lagDays + 55);
  return {
    current: { startDate: start, endDate: end },
    previous: { startDate: prevStart, endDate: prevEnd },
  };
}

async function runQuery(
  range: DateRange,
  dimensions: string[],
  rowLimit = 1000
): Promise<GscRow[]> {
  const resp = await gscQuery<GscResponse>({
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions,
    rowLimit,
    dataState: 'final',
  });
  return resp.rows ?? [];
}

/** Site-wide totals for a date range (no dimensions). */
export async function getTotals(range: DateRange): Promise<{
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}> {
  const rows = await runQuery(range, []);
  const r = rows[0];
  if (!r) return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  return { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position };
}

export async function getTopPages(range: DateRange, limit = 25): Promise<GscRow[]> {
  const rows = await runQuery(range, ['page']);
  return rows.sort((a, b) => b.clicks - a.clicks).slice(0, limit);
}

export async function getTopQueries(range: DateRange, limit = 25): Promise<GscRow[]> {
  const rows = await runQuery(range, ['query']);
  return rows.sort((a, b) => b.clicks - a.clicks).slice(0, limit);
}

/**
 * Pages with high impressions but low CTR — the biggest opportunity
 * to win clicks by improving titles/descriptions. Filters to pages
 * with meaningful impression volume so we don't surface noise.
 */
export async function getCtrLosers(
  range: DateRange,
  minImpressions = 100,
  limit = 25
): Promise<GscRow[]> {
  const rows = await runQuery(range, ['page']);
  return rows
    .filter((r) => r.impressions >= minImpressions)
    .sort((a, b) => {
      // Rank by "missed clicks" potential: impressions weighted by how
      // far CTR is below a 5% baseline.
      const missedA = a.impressions * Math.max(0, 0.05 - a.ctr);
      const missedB = b.impressions * Math.max(0, 0.05 - b.ctr);
      return missedB - missedA;
    })
    .slice(0, limit);
}

/**
 * Queries ranking on page 2 (positions 11-20) — close to page 1, where
 * a small push often yields outsized click gains.
 */
export async function getStriking(range: DateRange, limit = 25): Promise<GscRow[]> {
  const rows = await runQuery(range, ['query']);
  return rows
    .filter((r) => r.position > 10 && r.position <= 20 && r.impressions >= 50)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}

export interface PageDelta {
  page: string;
  clicks: number;
  prevClicks: number;
  clicksDelta: number;
  impressions: number;
  position: number;
  prevPosition: number;
}

/** Period-over-period movement by page (28d vs prior 28d). */
export async function getPageDeltas(
  current: DateRange,
  previous: DateRange
): Promise<PageDelta[]> {
  const [cur, prev] = await Promise.all([
    runQuery(current, ['page']),
    runQuery(previous, ['page']),
  ]);
  const prevMap = new Map(prev.map((r) => [r.keys[0], r]));
  const curMap = new Map(cur.map((r) => [r.keys[0], r]));
  const allPages = new Set([...curMap.keys(), ...prevMap.keys()]);

  const deltas: PageDelta[] = [];
  for (const page of allPages) {
    const c = curMap.get(page);
    const p = prevMap.get(page);
    deltas.push({
      page,
      clicks: c?.clicks ?? 0,
      prevClicks: p?.clicks ?? 0,
      clicksDelta: (c?.clicks ?? 0) - (p?.clicks ?? 0),
      impressions: c?.impressions ?? 0,
      position: c?.position ?? 0,
      prevPosition: p?.position ?? 0,
    });
  }
  return deltas;
}
