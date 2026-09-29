/**
 * Network observation: read the PUBLIC sitemap, crawl URLs, pull Search Console trends.
 *
 * Every request is a GET to the public site, except the read-only Search Console calls
 * (searchAnalytics/query and urlInspection are POST by API design; neither changes state).
 * The sitemap is read over HTTP exactly as Google reads it, never through the sitemap
 * generator code, so observing it cannot trigger a sitemap rebuild or a BigQuery scan.
 */
import { classifyCrawl } from './classify';
import { CRAWL_USER_AGENT, SITE_ORIGIN, URL_TIMEOUT_MS, stratumOf, type Stratum, type UrlCheck } from './types';

export type FetchFn = typeof fetch;

const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;

function locs(xml: string): string[] {
  return [...xml.matchAll(LOC_RE)].map((m) => m[1].replace(/&amp;/g, '&'));
}

/**
 * All page URLs advertised by the live sitemap(s), same-origin only.
 * Throws if the index or any child sitemap cannot be read, because a partial list
 * would silently shrink the population and shift the rotation.
 */
export async function fetchSitemapUrls(fetchFn: FetchFn, origin = SITE_ORIGIN): Promise<string[]> {
  const get = async (url: string) => {
    const res = await fetchFn(url, { method: 'GET', headers: { 'User-Agent': CRAWL_USER_AGENT }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`sitemap ${url} -> HTTP ${res.status}`);
    return res.text();
  };
  const index = await get(`${origin}/sitemap-index.xml`);
  const isIndex = /<sitemapindex\b/i.test(index);
  const childUrls = isIndex ? locs(index) : [];
  const docs = isIndex ? await Promise.all(childUrls.map(get)) : [index];
  const host = new URL(origin).host;
  const pages = docs.flatMap(locs).filter((u) => {
    try {
      return new URL(u).host === host;
    } catch {
      return false;
    }
  });
  if (!pages.length) throw new Error('sitemap contained no page URLs');
  return pages;
}

/** GET one URL without following redirects; classify. Never throws. */
export async function crawlUrl(fetchFn: FetchFn, url: string, extraDetail: Record<string, unknown> = {}): Promise<UrlCheck> {
  const started = Date.now();
  const base = { url, stratum: stratumOf(url), source: 'crawl' as const };
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': CRAWL_USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(URL_TIMEOUT_MS),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    const html = res.status >= 200 && res.status < 300 ? await res.text() : '';
    const latency = Date.now() - started;
    const verdict = classifyCrawl({ requestedUrl: url, status: res.status, headers, html });
    return { ...base, outcome: verdict.outcome, http_status: res.status, latency_ms: latency, detail: { ...verdict.detail, ...extraDetail } };
  } catch (e) {
    const verdict = classifyCrawl({ requestedUrl: url, transportError: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
    return { ...base, outcome: verdict.outcome, http_status: null, latency_ms: Date.now() - started, detail: { ...verdict.detail, ...extraDetail } };
  }
}

/**
 * Run `worker` over `items` with a concurrency cap, starting no new item after the
 * deadline. Results come back in input order; items never started are simply absent,
 * which the cursor logic treats as "not observed" (so they are retried next run).
 */
export async function pooled<T, R>(items: T[], concurrency: number, deadline: number, now: () => number, worker: (item: T) => Promise<R>): Promise<Array<R | undefined>> {
  const results: Array<R | undefined> = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length && now() < deadline) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(lanes);
  return results;
}

export interface StratumDayRow { day: string; stratum: Stratum; clicks: number; impressions: number; pages: number }

/** Search Console date x page rows -> per-day, per-stratum totals. */
export function aggregateStrata(rows: Array<{ keys: string[]; clicks: number; impressions: number }>): StratumDayRow[] {
  const agg = new Map<string, StratumDayRow>();
  for (const r of rows) {
    const [day, page] = r.keys;
    const stratum = stratumOf(page);
    const k = `${day}|${stratum}`;
    const cur = agg.get(k) ?? { day, stratum, clicks: 0, impressions: 0, pages: 0 };
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    cur.pages += 1;
    agg.set(k, cur);
  }
  return [...agg.values()].sort((a, b) => (a.day + a.stratum).localeCompare(b.day + b.stratum));
}

export type GscRow = { keys: string[]; clicks: number; impressions: number };

export interface PagedGscResult {
  rows: GscRow[];
  pages: number;
  rowCount: number;
  /** True only when the final page was a partial page and no request failed. */
  complete: boolean;
  error?: string;
}

// Search Console returns at most 25,000 rows per request.
export const GSC_PAGE_SIZE = 25_000;
// Hard stop so a runaway pager cannot loop forever; a hit is reported as incomplete.
export const GSC_MAX_PAGES = 40;

/**
 * searchAnalytics date x page, paginated with startRow until a final partial page.
 * Never throws: failures come back as complete=false with the rows fetched so far,
 * and callers must not compute trends from an incomplete result.
 */
export async function fetchDatePageRowsPaged(
  query: (body: Record<string, unknown>) => Promise<{ rows?: GscRow[] }>,
  startDate: string,
  endDate: string,
  pageSize = GSC_PAGE_SIZE,
): Promise<PagedGscResult> {
  const rows: GscRow[] = [];
  for (let page = 0; page < GSC_MAX_PAGES; page++) {
    let batch: GscRow[];
    try {
      batch = (await query({ startDate, endDate, dimensions: ['date', 'page'], rowLimit: pageSize, startRow: page * pageSize, dataState: 'final' })).rows ?? [];
    } catch (e) {
      return { rows, pages: page, rowCount: rows.length, complete: false, error: `page ${page + 1} failed: ${(e as Error).message}` };
    }
    rows.push(...batch);
    if (batch.length < pageSize) return { rows, pages: page + 1, rowCount: rows.length, complete: true };
  }
  return { rows, pages: GSC_MAX_PAGES, rowCount: rows.length, complete: false, error: `stopped after ${GSC_MAX_PAGES} full pages` };
}
