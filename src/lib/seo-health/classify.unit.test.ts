import { describe, expect, it } from 'vitest';
import { classifyCrawl, classifyInspection, MIN_CONTENT_WORDS } from './classify';

const URL_ = 'https://getmindy.ai/contractors/acme';
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const page = (opts: { robots?: string; canonical?: string; h1?: boolean; body?: string } = {}) => `<!doctype html><html><head>
${opts.robots ? `<meta name="robots" content="${opts.robots}">` : ''}
${opts.canonical !== undefined ? `<link rel="canonical" href="${opts.canonical}">` : ''}
<script>var x = "${words(500)}";</script></head><body>${opts.h1 === false ? '' : '<h1>Acme Inc</h1>'}<p>${opts.body ?? words(400)}</p></body></html>`;

describe('classifyCrawl', () => {
  it('distinguishes each failure class', () => {
    expect(classifyCrawl({ requestedUrl: URL_, transportError: 'ETIMEDOUT' }).outcome).toBe('transport_failure');
    expect(classifyCrawl({ requestedUrl: URL_, status: 503 }).outcome).toBe('http_5xx');
    expect(classifyCrawl({ requestedUrl: URL_, status: 404 }).outcome).toBe('http_404');
    expect(classifyCrawl({ requestedUrl: URL_, status: 410 }).outcome).toBe('http_404');
    expect(classifyCrawl({ requestedUrl: URL_, status: 403 }).outcome).toBe('http_4xx');
    expect(classifyCrawl({ requestedUrl: URL_, status: 308, headers: { location: '/x' } })).toMatchObject({ outcome: 'redirect', detail: { location: '/x' } });
    expect(classifyCrawl({ requestedUrl: URL_, status: 200, html: page({ robots: 'noindex, follow' }) }).outcome).toBe('noindex');
    expect(classifyCrawl({ requestedUrl: URL_, status: 200, headers: { 'x-robots-tag': 'noindex' }, html: page() })).toMatchObject({ outcome: 'noindex', detail: { via: 'header' } });
    expect(classifyCrawl({ requestedUrl: URL_, status: 200, html: page({ canonical: 'https://getmindy.ai/contractors/acme-parent' }) }).outcome).toBe('canonical_mismatch');
    expect(classifyCrawl({ requestedUrl: URL_, status: 200, html: page({ h1: false }) }).outcome).toBe('empty_content');
    expect(classifyCrawl({ requestedUrl: URL_, status: 200, html: page({ body: words(MIN_CONTENT_WORDS - 20) }) }).outcome).toBe('empty_content');
  });

  it('passes a substantive, self-canonical, indexable page', () => {
    expect(classifyCrawl({ requestedUrl: URL_, status: 200, html: page({ canonical: URL_ }) }).outcome).toBe('ok');
    expect(classifyCrawl({ requestedUrl: URL_, status: 200, html: page({ canonical: '/contractors/acme' }) }).outcome).toBe('ok');
    expect(classifyCrawl({ requestedUrl: URL_, status: 200, html: page({ canonical: URL_ + '/' }) }).outcome).toBe('ok');
  });

  it('does not count script text as visible content', () => {
    const r = classifyCrawl({ requestedUrl: URL_, status: 200, html: page({ body: 'tiny' }) });
    expect(r.outcome).toBe('empty_content');
  });

  it('applies precedence: a 5xx is not also judged on content', () => {
    expect(classifyCrawl({ requestedUrl: URL_, status: 500, html: page({ robots: 'noindex' }) }).outcome).toBe('http_5xx');
  });
});

describe('classifyInspection', () => {
  it("maps Google's coverage states", () => {
    expect(classifyInspection(URL_, { verdict: 'PASS', coverageState: 'Submitted and indexed', googleCanonical: URL_ }).outcome).toBe('indexed');
    expect(classifyInspection(URL_, { verdict: 'NEUTRAL', coverageState: 'Crawled - currently not indexed' }).outcome).toBe('crawled_not_indexed');
    expect(classifyInspection(URL_, { verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed' }).outcome).toBe('discovered_not_indexed');
    expect(classifyInspection(URL_, { coverageState: "Excluded by 'noindex' tag", indexingState: 'BLOCKED_BY_META_TAG' }).outcome).toBe('excluded_noindex');
    expect(classifyInspection(URL_, { coverageState: 'Not found (404)', pageFetchState: 'NOT_FOUND' }).outcome).toBe('not_found');
    expect(classifyInspection(URL_, { pageFetchState: 'SOFT_404', coverageState: 'Soft 404' }).outcome).toBe('soft_404');
    expect(classifyInspection(URL_, { robotsTxtState: 'DISALLOWED' }).outcome).toBe('blocked_robots');
    expect(classifyInspection(URL_, { verdict: 'NEUTRAL', coverageState: 'Duplicate', googleCanonical: 'https://getmindy.ai/contractors/other' }).outcome).toBe('google_canonical_differs');
    expect(classifyInspection(URL_, { coverageState: 'URL is unknown to Google' }).outcome).toBe('other');
  });

  it('records API failures as inspection_error, never as a Google decision', () => {
    expect(classifyInspection(URL_, null, 'HTTP 429 quota').outcome).toBe('inspection_error');
  });
});
