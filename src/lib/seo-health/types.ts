/**
 * Daily SEO health — OBSERVE-ONLY. Shared types and budgets.
 *
 * This module family observes and reports. It must never repair: no sitemap
 * edits, no noindex changes, no page regeneration, no cache warming, no
 * IndexNow, no BigQuery. guard.unit.test.ts enforces that on the import graph
 * and on every outbound request.
 */

export const SITE_ORIGIN = 'https://getmindy.ai';

// Per-run budgets. Crawl + inspection must finish inside the route's
// maxDuration (300s) with room to record results and post to Slack.
export const CRAWL_PER_RUN = 200;
export const INSPECT_PER_RUN = 150; // Google allows 2,000 URL inspections/day/property
export const CRAWL_CONCURRENCY = 6;
export const URL_TIMEOUT_MS = 10_000;
export const RUN_TIME_BUDGET_MS = 230_000; // stop starting new URLs after this; the rest resume next run

// Always crawled every run, outside the rotation, so a site-wide break shows up the same day.
export const CANARY_PATHS = ['/', '/today', '/contractors/the-boeing-company', '/pricing'];

// The crawler identifies itself honestly but carries the Googlebot token so pages
// render the same bot-facing variant Google receives.
export const CRAWL_USER_AGENT =
  'Mozilla/5.0 (compatible; MindySEOHealth/1.0; +https://getmindy.ai; Googlebot-compatible)';

export type CrawlOutcome =
  | 'ok'
  | 'transport_failure'
  | 'http_5xx'
  | 'http_404'
  | 'http_4xx'
  | 'redirect'
  | 'noindex'
  | 'canonical_mismatch'
  | 'empty_content';

export type InspectOutcome =
  | 'indexed'
  | 'crawled_not_indexed'
  | 'discovered_not_indexed'
  | 'excluded_noindex'
  | 'not_found'
  | 'soft_404'
  | 'google_canonical_differs'
  | 'blocked_robots'
  | 'other'
  | 'inspection_error';

export type Outcome = CrawlOutcome | InspectOutcome;
export type Stream = 'crawl' | 'inspect';

export interface UrlCheck {
  url: string;
  section: string;
  source: Stream;
  outcome: Outcome;
  http_status: number | null;
  latency_ms: number | null;
  detail: Record<string, unknown>;
}

export interface Cursor {
  stream: Stream;
  last_url: string | null;
  cycle: number;
}

/** Our-side failures: things we control on the page. Google's decisions are tracked separately. */
export const CRAWL_FAILURES: ReadonlySet<CrawlOutcome> = new Set([
  'transport_failure',
  'http_5xx',
  'http_404',
  'http_4xx',
  'redirect',
  'noindex',
  'canonical_mismatch',
  'empty_content',
]);

/** Site sections for trend reporting: first path segment, '(home)' for '/'. */
export function sectionOf(url: string): string {
  let path: string;
  try {
    path = new URL(url, SITE_ORIGIN).pathname;
  } catch {
    return '(invalid)';
  }
  const first = path.split('/').filter(Boolean)[0];
  return first ? first.toLowerCase() : '(home)';
}
