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
 *   - Block /_next/ in general, but EXPLICITLY ALLOW /_next/static/ and
 *     /_next/image so Googlebot can fetch the JS/CSS/images it needs to
 *     render pages. Blocking these resources outright (the old behavior)
 *     made GSC flag ~1,140 "Blocked by robots.txt" chunk URLs and can
 *     degrade how Google renders/indexes the page. Allow is matched by
 *     most-specific rule, so the narrower /_next/static/ wins over /_next/.
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
        // /_next/static/ (hashed JS/CSS) and /_next/image must stay
        // crawlable so Google can render pages — these Allow rules are
        // more specific than the /_next/ Disallow below and win.
        allow: ['/', '/_next/static/', '/_next/image'],
        disallow: [
          '/api/',
          '/admin/',
          '/app/',
          '/_next/',
          // /contracts/* is a redirect-only vanity surface (→ /awards/[id]),
          // not an indexable destination. Blocking it protects crawl budget
          // and prevents bots from hammering the PIID lookup at scale — the
          // canonical award pages under /awards/ stay fully crawlable.
          '/contracts/',
        ],
      },
    ],
    // Point at the sitemap INDEX (Phase 5) — lists /sitemap.xml +
    // /sitemap-opportunities.xml so the full page set is crawled without
    // hitting the 50k-URL single-sitemap cap.
    sitemap: `${SITE_URL}/sitemap-index.xml`,
    host: SITE_URL,
  };
}
