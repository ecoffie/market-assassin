/**
 * Pure classification of one crawl response and one URL Inspection result.
 * No I/O. Each observation gets exactly one outcome, by precedence, so a
 * 5xx is never also counted as empty content.
 */
import type { CrawlOutcome, InspectOutcome } from './types';

export interface CrawlResponse {
  requestedUrl: string;
  transportError?: string; // DNS/TLS/timeout/reset: no HTTP response at all
  status?: number;
  headers?: Record<string, string>; // lower-cased names
  html?: string;
}

export interface CrawlVerdict {
  outcome: CrawlOutcome;
  detail: Record<string, unknown>;
}

// Below this many words of visible text, a 200 page is treated as empty/degraded.
// Real contractor pages measured 1,000–2,100 words; the homepage well above this.
export const MIN_CONTENT_WORDS = 150;

function normalizeUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = '';
    const path = x.pathname.length > 1 ? x.pathname.replace(/\/+$/, '') : x.pathname;
    return `${x.protocol}//${x.host.toLowerCase()}${path}${x.search}`;
  } catch {
    return u;
  }
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[2] ?? m[3] ?? '') : null;
}

/** Robots directives from <meta name="robots|googlebot"> tags. */
export function metaRobots(html: string): string {
  const out: string[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = (attr(tag, 'name') ?? '').toLowerCase();
    if (name === 'robots' || name === 'googlebot') out.push((attr(tag, 'content') ?? '').toLowerCase());
  }
  return out.join(', ');
}

export function canonicalHref(html: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if ((attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/).includes('canonical')) return attr(tag, 'href');
  }
  return null;
}

/** Visible-text word count: drops script/style/noscript/template bodies and all tags. */
export function visibleWordCount(html: string): number {
  const text = html
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');
  return text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
}

export function hasH1(html: string): boolean {
  return /<h1\b[^>]*>[\s\S]*?\S[\s\S]*?<\/h1>/i.test(html);
}

export function classifyCrawl(r: CrawlResponse): CrawlVerdict {
  if (r.transportError || r.status === undefined) {
    return { outcome: 'transport_failure', detail: { error: (r.transportError ?? 'no response').slice(0, 200) } };
  }
  const s = r.status;
  if (s >= 500) return { outcome: 'http_5xx', detail: {} };
  if (s === 404 || s === 410) return { outcome: 'http_404', detail: {} };
  if (s >= 400) return { outcome: 'http_4xx', detail: {} };
  if (s >= 300) return { outcome: 'redirect', detail: { location: r.headers?.location ?? null } };

  const html = r.html ?? '';
  const headerRobots = (r.headers?.['x-robots-tag'] ?? '').toLowerCase();
  const robots = [metaRobots(html), headerRobots].filter(Boolean).join(', ');
  if (/\bnoindex\b|\bnone\b/.test(robots)) return { outcome: 'noindex', detail: { robots, via: headerRobots.includes('noindex') ? 'header' : 'meta' } };

  const canonical = canonicalHref(html);
  if (canonical) {
    const abs = new URL(canonical, r.requestedUrl).toString();
    if (normalizeUrl(abs) !== normalizeUrl(r.requestedUrl)) return { outcome: 'canonical_mismatch', detail: { canonical: abs } };
  }

  const words = visibleWordCount(html);
  const h1 = hasH1(html);
  if (!h1 || words < MIN_CONTENT_WORDS) return { outcome: 'empty_content', detail: { words, h1 } };

  return { outcome: 'ok', detail: { words, canonical: canonical ? 'self' : 'none' } };
}

/** Subset of Search Console URL Inspection `indexStatusResult` we rely on. */
export interface IndexStatusResult {
  verdict?: string;
  coverageState?: string;
  robotsTxtState?: string;
  indexingState?: string;
  pageFetchState?: string;
  googleCanonical?: string;
  userCanonical?: string;
  lastCrawlTime?: string;
}

export function classifyInspection(url: string, r: IndexStatusResult | null | undefined, error?: string): { outcome: InspectOutcome; detail: Record<string, unknown> } {
  if (error || !r) return { outcome: 'inspection_error', detail: { error: (error ?? 'empty result').slice(0, 200) } };
  const cov = (r.coverageState ?? '').toLowerCase();
  const detail = { coverageState: r.coverageState ?? null, verdict: r.verdict ?? null, lastCrawlTime: r.lastCrawlTime ?? null, googleCanonical: r.googleCanonical ?? null };

  if (r.robotsTxtState === 'DISALLOWED' || cov.includes('blocked by robots')) return { outcome: 'blocked_robots', detail };
  if (r.indexingState && r.indexingState.startsWith('BLOCKED_BY')) return { outcome: 'excluded_noindex', detail };
  if (cov.includes('noindex')) return { outcome: 'excluded_noindex', detail };
  if (r.pageFetchState === 'SOFT_404' || cov.includes('soft 404')) return { outcome: 'soft_404', detail };
  if (r.pageFetchState === 'NOT_FOUND' || cov.includes('not found')) return { outcome: 'not_found', detail };
  if (r.googleCanonical && normalizeUrl(r.googleCanonical) !== normalizeUrl(url)) return { outcome: 'google_canonical_differs', detail };
  if (cov.includes('crawled') && cov.includes('not indexed')) return { outcome: 'crawled_not_indexed', detail };
  if (cov.includes('discovered') && cov.includes('not indexed')) return { outcome: 'discovered_not_indexed', detail };
  if (r.verdict === 'PASS' || cov.includes('indexed')) return { outcome: 'indexed', detail };
  return { outcome: 'other', detail };
}
