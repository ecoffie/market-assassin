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

/**
 * People who clicked a 14-day trial button on `path`: our own `trial_click` event, or GA4's automatic
 * outbound-link `click` to Stripe checkout (buy.stripe.com). Counted as distinct users, so someone who
 * fires both is one person. Returns { people, clicks }.
 */
export async function trialButtonClickers(path: string, dates: Ga4Dates): Promise<{ people: number; clicks: number }> {
  const onPage = { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'EXACT', value: path } } };
  const ours = { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'trial_click' } } };
  const outbound = {
    andGroup: {
      expressions: [
        { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'click' } } },
        { filter: { fieldName: 'linkDomain', stringFilter: { matchType: 'CONTAINS', value: 'buy.stripe.com' } } },
      ],
    },
  };
  const resp = await runGa4Report({
    dateRanges: [dates],
    metrics: [{ name: 'activeUsers' }, { name: 'eventCount' }],
    dimensionFilter: { andGroup: { expressions: [onPage, { orGroup: { expressions: [ours, outbound] } }] } },
  });
  const row = resp.rows?.[0];
  return { people: Number(row?.metricValues?.[0]?.value) || 0, clicks: Number(row?.metricValues?.[1]?.value) || 0 };
}

/** Average engaged time per visitor on `path`, in seconds (GA4 userEngagementDuration ÷ activeUsers). Null with no visitors. */
export async function avgEngagedSeconds(path: string, dates: Ga4Dates): Promise<number | null> {
  const resp = await runGa4Report({
    dateRanges: [dates],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'userEngagementDuration' }, { name: 'activeUsers' }],
    dimensionFilter: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'EXACT', value: path } } },
  });
  const row = resp.rows?.[0];
  const secs = Number(row?.metricValues?.[0]?.value);
  const users = Number(row?.metricValues?.[1]?.value);
  return users > 0 && Number.isFinite(secs) ? secs / users : null;
}

/** "1m 05s" / "42s" — or "—" when unknown. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const s = Math.round(seconds);
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/** "17.3%" — or "—" when the base is missing or zero. */
export function rate(part: number | null, whole: number | null): string {
  if (part === null || whole === null || !(whole > 0)) return '—';
  return `${((part / whole) * 100).toFixed(1)}%`;
}
