/**
 * Sitemap XML serialization + the lastmod rule (2026-11-12).
 *
 * LASTMOD MUST BE A DATA DATE, OR ABSENT.
 * Until this change every contractor and static URL carried lastmod = the build time, so all
 * 22,389 URLs claimed to have changed today, every day. Google learns to ignore a lastmod that
 * is always "now", which removed the one recrawl signal a sitemap carries — while the July 2026
 * collapse left thousands of URLs waiting for a recrawl that never came.
 *
 * So: a URL gets lastmod only from a timestamp that records its CONTENT changing (an award
 * action date, a served-table as-of date, a SAM posting/enrichment date, a blog updatedAt).
 * No such timestamp → no lastmod (Google treats it as unknown, which is honest).
 */
export type ChangeFrequency = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';

export interface SitemapEntry {
  url: string;
  /** A data-modification date (YYYY-MM-DD or ISO). Omit when no verified date exists. */
  lastModified?: string | null;
  changeFrequency?: ChangeFrequency;
  priority?: number;
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);

/**
 * Normalize a data date to W3C YYYY-MM-DD, or null if it is not a real, past date.
 * A future date is rejected: a lastmod in the future is not a modification time.
 */
export function toLastmod(value: string | Date | null | undefined, now: Date = new Date()): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() > now.getTime() + 24 * 3600 * 1000) return null;
  return d.toISOString().slice(0, 10);
}

/** Latest of several data dates, as YYYY-MM-DD, or null when none is valid. */
export function latestLastmod(values: Array<string | Date | null | undefined>, now: Date = new Date()): string | null {
  let best: string | null = null;
  for (const v of values) {
    const d = toLastmod(v, now);
    if (d && (!best || d > best)) best = d;
  }
  return best;
}

export function renderUrlset(entries: SitemapEntry[]): string {
  const body = entries
    .map((e) => {
      const parts = [`    <loc>${esc(e.url)}</loc>`];
      if (e.lastModified) parts.push(`    <lastmod>${esc(e.lastModified)}</lastmod>`);
      if (e.changeFrequency) parts.push(`    <changefreq>${e.changeFrequency}</changefreq>`);
      if (typeof e.priority === 'number') parts.push(`    <priority>${e.priority.toFixed(1)}</priority>`);
      return `  <url>\n${parts.join('\n')}\n  </url>`;
    })
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}${body ? '\n' : ''}</urlset>\n`
  );
}

export function renderSitemapIndex(children: Array<{ loc: string; lastModified?: string | null }>): string {
  const body = children
    .map((c) => `  <sitemap>\n    <loc>${esc(c.loc)}</loc>${c.lastModified ? `\n    <lastmod>${esc(c.lastModified)}</lastmod>` : ''}\n  </sitemap>`)
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`
  );
}

/** Google's per-file limit. Children must stay under it. */
export const SITEMAP_URL_LIMIT = 50_000;

/**
 * Response for a child sitemap. Cached at the CDN for 6h with a day of stale-while-revalidate,
 * so crawler traffic never re-runs the KV/Supabase reads per request. A generation FAILURE
 * answers 503 + no-store: Google retries a 5xx sitemap and keeps the last good copy, whereas an
 * empty 200 would tell it every URL in the family had disappeared.
 */
export function sitemapResponse(xml: string): Response {
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=21600, stale-while-revalidate=86400',
    },
  });
}

export function sitemapFailure(name: string, err: unknown): Response {
  console.error(`[sitemap] ${name} generation failed:`, err instanceof Error ? err.message : err);
  return new Response('sitemap temporarily unavailable', {
    status: 503,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'Retry-After': '3600' },
  });
}
