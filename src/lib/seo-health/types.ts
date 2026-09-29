/**
 * Daily SEO health — OBSERVE-ONLY. Shared types and budgets.
 *
 * This module family observes and reports. It must never repair: no sitemap
 * edits, no noindex changes, no page regeneration, no cache warming, no
 * IndexNow, no BigQuery. guard.unit.test.ts enforces that on the import graph
 * and on every outbound request.
 */

export const SITE_ORIGIN = 'https://getmindy.ai';

// Sampling is STRATIFIED: each stratum has its own population, its own cursor per
// stream, and its own per-run allocation, so no week's sample is dominated by one page
// type and indexed share is only ever compared within a stratum.
export const STRATA = [
  'hub',                  // home, pricing, index pages: 0-1 path segments
  'contractor_root',      // /contractors/{slug}
  'contractor_contracts', // /contractors/{slug}/contracts
  'contractor_agencies',  // /contractors/{slug}/agencies
  'contractor_naics',     // /contractors/{slug}/naics
  'programmatic_other',   // every other page with 2+ segments (opportunity, awards, top, agencies/…)
] as const;
export type Stratum = (typeof STRATA)[number];

// Per-run allocation per stratum. Totals: crawl 200/run, inspect 150/run (Google allows
// 2,000 inspections/day/property). Coverage per stratum = population / allocation runs,
// reported in every digest; see coverageDays().
export const CRAWL_ALLOCATION: Record<Stratum, number> = {
  hub: 20, contractor_root: 60, contractor_contracts: 30, contractor_agencies: 30, contractor_naics: 30, programmatic_other: 30,
};
export const INSPECT_ALLOCATION: Record<Stratum, number> = {
  hub: 10, contractor_root: 50, contractor_contracts: 20, contractor_agencies: 20, contractor_naics: 20, programmatic_other: 30,
};
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
  stratum: Stratum;
  source: Stream;
  outcome: Outcome;
  http_status: number | null;
  latency_ms: number | null;
  detail: Record<string, unknown>;
}

export interface Cursor {
  stream: Stream;
  stratum: Stratum;
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

/**
 * The stratum of a URL: a pure function of its path, so a URL never changes stratum
 * between runs. Used for sampling, crawl failure rates, Google indexed share and
 * Search Console trends alike.
 */
export function stratumOf(url: string): Stratum {
  let path: string;
  try {
    path = new URL(url, SITE_ORIGIN).pathname;
  } catch {
    return 'programmatic_other';
  }
  const seg = path.split('/').filter(Boolean).map((s) => s.toLowerCase());
  if (seg[0] === 'contractors' && seg.length === 2) return 'contractor_root';
  if (seg[0] === 'contractors' && seg.length === 3) {
    if (seg[2] === 'contracts') return 'contractor_contracts';
    if (seg[2] === 'agencies') return 'contractor_agencies';
    if (seg[2] === 'naics') return 'contractor_naics';
  }
  return seg.length <= 1 ? 'hub' : 'programmatic_other';
}

/** Days for one full pass over a stratum at one run per day. */
export function coverageDays(population: number, perRun: number): number | null {
  if (population === 0) return 0;
  return perRun > 0 ? Math.ceil(population / perRun) : null;
}
