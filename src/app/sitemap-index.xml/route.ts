/**
 * /sitemap-index.xml — the sitemap INDEX (Phase 5 indexation engineering).
 *
 * The single /sitemap.xml was at ~38k URLs and growing toward Google's 50k-URL
 * hard limit. This index points at multiple child sitemaps so we never hit the
 * cap and Google crawls the whole set:
 *   - /sitemap.xml                 — everything except the opportunity bulk
 *   - /sitemap-opportunities.xml   — the ~34k /opportunity/[slug] pages (the bulk)
 *
 * robots.txt points here. Add more child sitemaps as page families scale.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai';

export const dynamic = 'force-dynamic';
export const revalidate = 86400;

export function GET() {
  const now = new Date().toISOString();
  const children = [`${SITE_URL}/sitemap.xml`, `${SITE_URL}/sitemap-opportunities.xml`];
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    children.map((loc) => `  <sitemap>\n    <loc>${loc}</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>`).join('\n') +
    `\n</sitemapindex>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' } });
}
