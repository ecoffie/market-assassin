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
          //
          // REVIEWED 2026-09-21 and deliberately KEPT. Contract-number (PIID)
          // lookups are the site's #1 query class by impressions and its worst
          // by conversion: "19aqmm24f2376" drew 430 impressions at average
          // position 1.8 and ZERO clicks; across six months the whole site took
          // 13,976 impressions and 32 clicks, 28 of them the branded query
          // "getmindy.ai". Pasting a PIID into Google is a reference lookup, not
          // a buyer. Opening this path would buy more of the traffic that
          // already does not convert.
          //
          // Noted while reviewing, NOT fixed here: /contracts/<piid> currently
          // 307s to the generic /awards index rather than to that award's own
          // /awards/[id] page, so the identifier is dropped. Harmless today
          // because the path is blocked, but it is a broken vanity redirect.
          '/contracts/',
          // /reports/* are PRIVATE capability-URL deliverables (Mindy Intelligence —
          // the unguessable id IS the access control). They must never be indexed.
          // This is the crawl-layer half of the Class-A/Class-B publishing split:
          // /research/* (The Mindy Institute — public, permanent) stays crawlable;
          // /reports/* (private, customer-specific) is disallowed.
          '/reports/',
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
