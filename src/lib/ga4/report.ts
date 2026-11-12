/**
 * Google Analytics 4 (property "Mindy — Web", stream getmindy.ai) — daily visitors.
 *
 * Auth reuses the same service account as BigQuery / Search Console (GCP_SA_JSON).
 * One-time prerequisites (outside code):
 *   1. GA4 Admin → Property access management → add the service-account email as a Viewer.
 *   2. Google Cloud project of that service account → enable "Google Analytics Data API".
 * The property id defaults to 547384187 (from the GA URL `…a105253466p547384187…`);
 * GA4_PROPERTY_ID overrides it.
 */
import { GoogleAuth } from 'google-auth-library';
import { getServiceAccountEmail, parseSaJson } from '@/lib/gsc/client';

export const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || '547384187';
const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

let _auth: GoogleAuth | null = null;
function auth(): GoogleAuth {
  if (_auth) return _auth;
  const raw = process.env.GCP_SA_JSON;
  _auth = raw ? new GoogleAuth({ credentials: parseSaJson(raw) as never, scopes: SCOPES }) : new GoogleAuth({ scopes: SCOPES });
  return _auth;
}

type ReportResponse = {
  rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>;
};

export async function runGa4Report(body: Record<string, unknown>): Promise<ReportResponse> {
  const token = await auth().getAccessToken();
  if (!token) throw new Error('GA4 auth: could not obtain an access token');
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 400);
    const hint = res.status === 403
      ? ` — add ${getServiceAccountEmail()} as a Viewer on GA4 property ${GA4_PROPERTY_ID}, and enable the Google Analytics Data API in its Cloud project.`
      : '';
    throw new Error(`GA4 API ${res.status}${hint} ${text}`);
  }
  return (await res.json()) as ReportResponse;
}

export type DayRow = { date: string; visitors: number; newVisitors: number; sessions: number; pageViews: number };

/** GA4 `date` is YYYYMMDD. Returns oldest → newest; days GA did not return are absent, never 0. */
export function parseDailyRows(resp: ReportResponse): DayRow[] {
  return (resp.rows ?? [])
    .map((r) => {
      const d = r.dimensionValues?.[0]?.value ?? '';
      const m = (i: number) => Number(r.metricValues?.[i]?.value ?? NaN);
      return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, visitors: m(0), newVisitors: m(1), sessions: m(2), pageViews: m(3) };
    })
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.visitors))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function parsePairs(resp: ReportResponse): Array<{ name: string; value: number }> {
  return (resp.rows ?? []).map((r) => ({ name: r.dimensionValues?.[0]?.value || '(not set)', value: Number(r.metricValues?.[0]?.value ?? 0) }));
}

export function summarize(days: DayRow[]) {
  const full = days.slice(0, -1); // today is partial
  const avg = full.length ? Math.round(full.reduce((s, d) => s + d.visitors, 0) / full.length) : null;
  return { averageDailyVisitors: avg, fullDaysCounted: full.length, today: days.at(-1) ?? null };
}

export async function getDailyVisitors(days: number) {
  const dateRanges = [{ startDate: `${days - 1}daysAgo`, endDate: 'today' }];
  const [daily, pages, sources] = await Promise.all([
    runGa4Report({
      dateRanges, dimensions: [{ name: 'date' }],
      metrics: [{ name: 'activeUsers' }, { name: 'newUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 400,
    }),
    runGa4Report({ dateRanges, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 15 }),
    runGa4Report({ dateRanges, dimensions: [{ name: 'sessionSource' }], metrics: [{ name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }], limit: 10 }),
  ]);
  const rows = parseDailyRows(daily);
  return { propertyId: GA4_PROPERTY_ID, days: rows, ...summarize(rows), topPages: parsePairs(pages), topSources: parsePairs(sources) };
}
