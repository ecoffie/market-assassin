/**
 * Conversion numbers for /api/admin/conversions: page visitors from GA4 (property "Mindy — Web").
 * "Visitors" = GA4 active users who viewed that page in the window.
 */
import { runGa4Report } from './report';

/** True when a GA4 pageReferrer is the getmindy.ai homepage (any query string, any trailing slash). */
export function isHomepageReferrer(ref: string): boolean {
  return /^https?:\/\/(www\.)?getmindy\.ai\/?(\?.*)?(#.*)?$/i.test(ref.trim());
}

/** A GA4 date window: YYYY-MM-DD dates (inclusive), or GA4 relative dates like '29daysAgo' / 'today'. */
export type Ga4Dates = { startDate: string; endDate: string };

/** Visitors per page path for the window. Paths not returned by GA4 are absent (never 0-filled). */
export async function pageVisitors(paths: string[], dates: Ga4Dates): Promise<Record<string, number>> {
  const resp = await runGa4Report({
    dateRanges: [dates],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'activeUsers' }],
    dimensionFilter: { filter: { fieldName: 'pagePath', inListFilter: { values: paths } } },
    limit: 100,
  });
  const out: Record<string, number> = {};
  for (const r of resp.rows ?? []) {
    const path = r.dimensionValues?.[0]?.value ?? '';
    const n = Number(r.metricValues?.[0]?.value);
    if (path && Number.isFinite(n)) out[path] = n;
  }
  return out;
}

/** Visitors who reached `path` straight from the homepage (by GA4 pageReferrer). */
export async function visitorsFromHomepage(path: string, dates: Ga4Dates): Promise<number> {
  const resp = await runGa4Report({
    dateRanges: [dates],
    dimensions: [{ name: 'pageReferrer' }],
    metrics: [{ name: 'activeUsers' }],
    dimensionFilter: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'EXACT', value: path } } },
    limit: 1000,
  });
  let total = 0;
  for (const r of resp.rows ?? []) {
    if (isHomepageReferrer(r.dimensionValues?.[0]?.value ?? '')) total += Number(r.metricValues?.[0]?.value) || 0;
  }
  return total;
}

/** "17.3%" — or "—" when the base is missing or zero. */
export function rate(part: number | null, whole: number | null): string {
  if (part === null || whole === null || !(whole > 0)) return '—';
  return `${((part / whole) * 100).toFixed(1)}%`;
}
