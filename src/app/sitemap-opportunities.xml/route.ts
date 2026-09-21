/**
 * /sitemap-opportunities.xml — dedicated child sitemap for the ~34k
 * /opportunity/[slug] pages (Phase 5). Split out of the main /sitemap.xml so the
 * main one stays well under Google's 50k-URL cap. Listed in /sitemap-index.xml.
 *
 * Indexable (non-thin) active opps only — getOpportunitySlugsForSitemap already
 * gates thin pages. Capped at 45k (under the 50k limit).
 */
import { getOpportunitySlugsForSitemap } from '@/lib/seo/opportunities';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai';

export const dynamic = 'force-dynamic';
export const revalidate = 86400;

export async function GET() {
  let opps: { slug: string; lastModified: string }[] = [];
  try {
    opps = await getOpportunitySlugsForSitemap(45000);
  } catch {
    opps = [];
  }
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    opps
      .map(
        (o) =>
          `  <url>\n    <loc>${SITE_URL}/opportunity/${o.slug}</loc>\n    <lastmod>${o.lastModified}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.6</priority>\n  </url>`,
      )
      .join('\n') +
    `\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' } });
}
