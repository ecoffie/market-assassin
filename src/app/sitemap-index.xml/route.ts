/**
 * The sitemap INDEX, served at /sitemap-index.xml (robots.txt) and /sitemap.xml.
 *
 * /sitemap.xml has been registered in Search Console since May 2026 (as a single urlset) and
 * robots.txt points at /sitemap-index.xml; both resolve to the same index of per-family children.
 * Children carry no index-level lastmod: computing one would mean generating every child here,
 * and "now" would be the build-time lastmod this phase removes.
 */
import { sitemapIndexResponse } from '@/lib/seo/sitemap-sections';

export const revalidate = 86400;

export function GET() {
  return sitemapIndexResponse();
}
