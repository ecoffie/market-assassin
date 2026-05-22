/**
 * Robots — Next.js metadata-route convention.
 *
 * Auto-published at /robots.txt. Tells crawlers what they can hit
 * + where to find the sitemap.
 *
 * Strategy:
 *   - Allow everything by default (we want our SEO surfaces indexed)
 *   - Block /api/* (no value in crawling JSON endpoints, and some
 *     endpoints carry user data)
 *   - Block /admin/* (internal team tools)
 *   - Block /app/* (post-login UI — won't render anything useful
 *     to a crawler anyway, but explicit > implicit)
 *   - Point at /sitemap.xml so Googlebot finds the contractor URLs
 *     it wouldn't discover otherwise
 */
import type { MetadataRoute } from 'next';

// Canonical SEO domain — see src/app/sitemap.ts header note.
// getmindy.ai is the Google-facing hostname.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin/',
          '/app/',
          '/_next/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
