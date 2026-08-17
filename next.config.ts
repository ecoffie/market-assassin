import type { NextConfig } from "next";

/**
 * CONFIGURATION NOTES
 * ===================
 * Content Generator is now integrated locally at /public/content-generator/
 * API calls go directly to govcon-content-generator.vercel.app
 * No proxy rewrites needed - simplifies architecture
 */

const nextConfig: NextConfig = {
  // Skip type checking during builds (we run tsc separately)
  typescript: {
    ignoreBuildErrors: false,
  },
  // Experimental features for React 19 compatibility
  experimental: {
    // Use React Compiler if available
  },
  // Packages that must NOT be bundled by the Next compiler — they
  // need to be required at runtime from node_modules so their
  // internals (WASM, dynamic imports, eval'd workers) work right.
  // pdf-parse and mammoth both rely on dynamic loading patterns
  // that webpack mangles. mammoth was working accidentally; pdf-parse
  // was throwing 'DOMMatrix is not defined' until we added this
  // (paired with the polyfills in src/lib/sam/pdf-extract.ts).
  // @sparticuz/chromium + puppeteer-core ship a native Chromium binary that the
  // bundler must NOT try to trace or rewrite — externalize them so the brotli
  // archive reaches the lambda intact. Without this the DIBBS direct fetcher
  // (lib/dibbs/direct.ts) fails at runtime with "Could not find Chrome".
  serverExternalPackages: ['pdf-parse', 'mammoth', '@sparticuz/chromium', 'puppeteer-core'],
  // Force-include pdfjs-dist worker files in the serverless bundle.
  // Vercel's output tracer doesn't pick up dynamic require() paths
  // inside pdfjs-dist, so 'pdf.worker.mjs' wasn't getting deployed,
  // causing 'Setting up fake worker failed: Cannot find module...'
  // when pdf-parse tried to spawn its worker. Glob covers both
  // legacy/ and build/ variants so we don't have to guess which
  // pdf-parse 2.x is actually using.
  outputFileTracingIncludes: {
    '/api/**/*': [
      './node_modules/pdfjs-dist/**/*.mjs',
      './node_modules/pdfjs-dist/**/*.js',
      './node_modules/pdfjs-dist/legacy/build/*',
      './node_modules/pdfjs-dist/build/*',
    ],
    // @sparticuz/chromium ships its browser as BROTLI ARCHIVES in bin/ —
    // chromium.br (~65MB), al2023.tar.br, fonts.tar.br. Nothing require()s them, so
    // the tracer never sees them and they do not reach the lambda. Externalizing the
    // package (serverExternalPackages above) is NOT enough on its own: that stops the
    // bundler relocating the module, but the binary still has to be traced in.
    //
    // Symptom when this is missing (prod, 2026-08-02):
    //   The input directory "/var/task/node_modules/@sparticuz/chromium/bin"
    //   does not exist.
    // Scoped to the ONE route that needs a browser rather than '/api/**/*' — 65MB on
    // every API function would be wasteful and risks the function size ceiling.
    '/api/cron/sync-dibbs/**/*': ['./node_modules/@sparticuz/chromium/bin/**/*'],
    // Same requirement, second browser route: the Market Research memo renders
    // HTML -> PDF for a contracting officer. Verified on prod 2026-08-17 — the
    // export answered `content-type: text/html` with the identical
    // "/var/task/node_modules/@sparticuz/chromium/bin does not exist" error,
    // because the trace above is scoped to the DIBBS route only. Each route
    // needing a browser must be listed HERE; externalizing the package does not
    // carry the binary across routes.
    '/api/gov-buyer/market-research/export/**/*': ['./node_modules/@sparticuz/chromium/bin/**/*'],
  },
  // Rewrites for host-based routing
  async rewrites() {
    return {
      // beforeFiles rewrites run BEFORE filesystem checks
      // This allows host-based routing to override page.tsx
      beforeFiles: [
        // MCP OAuth discovery metadata. Next ignores `.well-known` folders in the
        // app dir, so serve the RFC 8414 / RFC 9728 docs from API routes at the
        // spec-required well-known paths. Both the apex and the mcp subdomain.
        {
          source: '/.well-known/oauth-authorization-server',
          destination: '/api/oauth/metadata/authorization-server',
        },
        {
          source: '/.well-known/oauth-authorization-server/:path*',
          destination: '/api/oauth/metadata/authorization-server',
        },
        {
          source: '/.well-known/oauth-protected-resource',
          destination: '/api/oauth/metadata/protected-resource',
        },
        {
          source: '/.well-known/oauth-protected-resource/:path*',
          destination: '/api/oauth/metadata/protected-resource',
        },
        // mcp.getmindy.ai — hosted MCP edge. The handler lives at
        // src/app/mcp/[transport]/route.ts (basePath '/mcp'), so raw endpoints
        // are /mcp/mcp, /mcp/sse, /mcp/message. These rewrites let remote MCP
        // clients use the clean subdomain paths instead of the doubled prefix.
        {
          source: '/mcp',
          has: [{ type: 'host', value: 'mcp.getmindy.ai' }],
          destination: '/mcp/mcp',
        },
        {
          source: '/sse',
          has: [{ type: 'host', value: 'mcp.getmindy.ai' }],
          destination: '/mcp/sse',
        },
        {
          source: '/message',
          has: [{ type: 'host', value: 'mcp.getmindy.ai' }],
          destination: '/mcp/message',
        },
        // getmindy.ai root serves the Mindy landing page.
        // ⛔ DO NOT change this destination to '/opportunity-map' (the "map as homepage" flip) —
        // it is OFF THE TABLE until Eric personally green-lights it after his QC pass (Eric, Jul 26:
        // "do not merge homepage with anything, I don't want to accidentally turn it on"). The flip
        // is a PARKED proposal only — see docs/strategy/PRD-map-as-homepage.md. Leave this as
        // '/mindy-landing'. Changing this one line IS the flip; do not touch it without Eric's explicit go.
        {
          source: '/',
          has: [
            {
              type: 'host',
              value: 'getmindy.ai',
            },
          ],
          destination: '/mindy-landing',
        },
      {
        source: '/signin',
        has: [{ type: 'host', value: 'getmindy.ai' }],
        destination: '/app',
      },
        {
          source: '/signup',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/app/signup',
        },
        {
          source: '/onboarding',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/app/onboarding',
        },
        {
          source: '/setup-password',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/app/setup-password',
        },
        {
          source: '/setup-account',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/app/setup-account',
        },
        {
          source: '/forgot-password',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/app/forgot-password',
        },
        {
          source: '/reset-password',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/app/reset-password',
        },
        {
          source: '/auth/callback',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/app/auth/callback',
        },
        {
          source: '/market-intelligence',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/market-intelligence',
        },
        {
          source: '/opportunity-hunter',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/opportunity-hunter',
        },
        {
          source: '/expiring-contracts',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/expiring-contracts',
        },
        {
          source: '/forecasts',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/forecasts',
        },
        {
          source: '/bd-assist',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/bd-assist',
        },
        {
          source: '/compare/govwin',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/compare/govwin',
        },
        {
          source: '/compare/sam-gov',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/compare/sam-gov',
        },
        {
          source: '/pricing',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/pricing',
        },
        {
          source: '/about',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/about',
        },
        {
          source: '/free-resources',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/free-resources',
        },
        // Glossary — SEO surface targeting "what is a CAGE code"-style
        // definition queries. Index + per-term detail pages, all static.
        {
          source: '/glossary',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/glossary',
        },
        {
          source: '/glossary/:slug*',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/glossary/:slug*',
        },
        {
          source: '/privacy',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/privacy',
        },
        {
          source: '/terms',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/terms',
        },
        // Blog — index + dynamic post pages. Pattern mirrors /glossary
        // above (index + :slug*) so getmindy.ai/blog and
        // getmindy.ai/blog/<slug> both resolve to the Next routes.
        {
          source: '/blog',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/blog',
        },
        {
          source: '/blog/:slug*',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/blog/:slug*',
        },
        // NAICS directory — top-100-by-spend index + per-code detail
        // pages. Static prerender at build; pattern mirrors /glossary
        // and /blog (index + :code*) so both /naics and /naics/<code>
        // route to the matching Next surface on the getmindy.ai host.
        {
          source: '/naics',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/naics',
        },
        {
          source: '/naics/:code*',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/naics/:code*',
        },
        // Agencies directory — buyer-intent SEO surface for
        // "[agency] contract opportunities" / "who sells to [agency]"
        // queries. Index + per-agency detail pages, statically
        // prerendered. Same index + :slug* pattern as /glossary,
        // /blog, /naics so getmindy.ai/agencies and
        // getmindy.ai/agencies/<slug> both route to the Next pages.
        {
          source: '/agencies',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/agencies',
        },
        {
          source: '/agencies/:slug*',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/agencies/:slug*',
        },
        // Set-asides — high-intent SEO for "8a contracts",
        // "hubzone contracts", "sdvosb contracts", "wosb contracts".
        // Four explicit program pages (no dynamic route) plus an
        // index, all statically prerendered.
        {
          source: '/set-asides',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/set-asides',
        },
        {
          source: '/set-asides/:program*',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/set-asides/:program*',
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  // Redirects for legacy URLs and convenience
  async redirects() {
    return [
      // ── RETIRED LEGACY STOREFRONT (Eric, 2026-07-28) ────────────────────────────────
      // These 7 routes are pure SALES pages for products we no longer sell. Their Stripe
      // payment links were deactivated the same day (10 links: GovCon Starter Bundle $697,
      // Pro Giant Bundle $997, Market Assassin Standard $297 / Premium $497 / Premium
      // Upgrade $200, Content Generator Standard $197 / Full Fix $397 / Full Fix Upgrade
      // $200, Recompete Tracker $397, Opportunity Hunter Pro $49), so every buy-button on
      // them now leads to a Stripe "no longer available" page. Redirecting is kinder than
      // showing a checkout that cannot complete.
      //
      // ⚠️ DELIBERATELY NOT REDIRECTED — these are LIVE CUSTOMER TOOLS, not sales pages,
      // and shop.govcongiants.com/activate sends paying customers straight to them:
      //     /opportunity-hunter  /content-generator  /federal-market-assassin
      //     /recompete           /contractor-database
      // ~15 customers still hold access (measured 2026-07-28: 8 contractor-db, 7 MA,
      // 7 recompete, 7 hunter-pro, 4 content-gen). /federal-market-assassin in particular
      // is a working tool — it generates 8 strategic reports against /api/reports/*.
      // Redirecting any of those five would break people who paid. Their now-dead
      // buy-buttons are cosmetic and should be stripped in a separate, surgical pass.
      //
      // 308 (permanent) — these products are not coming back.
      ...[
        '/store',
        '/bundles/starter',
        '/bundles/pro',
        '/content-generator-product',   // the SALES page; /content-generator is the tool
        '/expiring-contracts',
        '/market-assassin',             // the SALES page; /federal-market-assassin is the tool
        // NOT '/market-assassin-locked' — it looks like a sales page but is the ACCESS GATE.
        // Verified 2026-07-28: proxy.ts redirects unentitled users there, the tool itself
        // router.replace()s there in 3 places, and /api/ma-access/[token] sends both its
        // error paths there. Retiring it would drop a paying customer with a transient auth
        // failure onto the homepage with no explanation of what happened. Same reasoning
        // applies to /database-locked (the contractor-database gate) — left alone.
      ].map((source) => ({
        source,
        has: [{ type: 'host' as const, value: 'getmindy.ai' }],
        destination: '/',
        permanent: true,
      })),

      // The standalone $397 Recompete Tracker is DISCONTINUED (Eric, 2026-07-16) —
      // recompete is a Pro feature now. Its page was still live and ungated, serving
      // `public/contracts-data.js`: a Jun-22 snapshot, 9,450 grouped records, NO UEI —
      // while `recompete_opportunities` holds 129,249 real per-contract rows with ~100%
      // UEI (issue #303). Legacy buyers with a bookmark or a `recompete:{email}` KV
      // grant now land on the live in-app panel instead of 4-week-old data.
      //
      // 308 (permanent) — the product isn't coming back. Redirects run BEFORE the
      // filesystem in Next's routing order, so this wins over the static public/ file.
      //
      // ⚠️ Do NOT delete public/contracts-data.js — public/prime-lookup.html still
      // <script src>'s it and is live (that's why #302 left it in place).
      {
        source: '/recompete.html',
        destination: '/app?panel=recompetes',
        permanent: true,
      },
      // YouTube funnel entry — put getmindy.ai/youtube in every video description.
      // Redirects to the landing page with YouTube UTM baked in so AttributionTracker
      // captures the source into gca_attr (read at signup for source attribution).
      // Optional ?c=<video-slug> becomes utm_campaign so per-video conversion is
      // measurable. 307 (temporary) so we can evolve the params without SEO baggage.
      {
        source: '/youtube',
        has: [{ type: 'host', value: 'getmindy.ai' }],
        destination:
          '/?utm_source=youtube&utm_medium=video&utm_campaign=channel',
        permanent: false,
      },
      // Lead-magnet CTA: /youtube/first-contract-guide lands on the email-capture
      // page (pre-opening the guide's modal) so the video CTA actually BUILDS THE
      // LIST — not the homepage. Must precede the /youtube/:slug catch-all below.
      {
        source: '/youtube/first-contract-guide',
        has: [{ type: 'host', value: 'getmindy.ai' }],
        destination:
          '/free-resources?resource=first-contract-guide&utm_source=youtube&utm_medium=video&utm_campaign=first-contract-guide',
        permanent: false,
      },
      {
        source: '/youtube/:slug',
        has: [{ type: 'host', value: 'getmindy.ai' }],
        destination:
          '/?utm_source=youtube&utm_medium=video&utm_campaign=:slug',
        permanent: false,
      },
      // Legacy onboarding pages RETIRED — the real onboarding is /app/onboarding.
      // Nothing in the app linked to these; only old bookmarks/emails could hit them.
      // 301 (permanent) so any stale link lands on the real flow, no dead form, no lost
      // work. The page.tsx files were deleted alongside this.
      // tasks/smart-profile-dead-table-findings.md.
      {
        source: '/profile/setup',
        destination: '/app/onboarding',
        permanent: true,
      },
      {
        source: '/profile/complete',
        destination: '/app/onboarding',
        permanent: true,
      },
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: 'www.getmindy.ai',
          },
        ],
        destination: 'https://getmindy.ai/:path*',
        permanent: true,
      },
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: 'govcongiants.org',
          },
        ],
        destination: 'https://www.govcongiants.com/:path*',
        permanent: true,
      },
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: 'www.govcongiants.org',
          },
        ],
        destination: 'https://www.govcongiants.com/:path*',
        permanent: true,
      },
      {
        source: '/opportunity-scout.html',
        destination: '/opportunity-hunter',
        permanent: true,
      },
      {
        source: '/opportunity-scout',
        destination: '/opportunity-hunter',
        permanent: true,
      },
      // Content Reaper product page route
      {
        source: '/content-reaper',
        destination: '/content-generator-product',
        permanent: false,
      },
      // Redirect old /content-generator routes to new location (without trailing path)
      {
        source: '/library',
        destination: '/content-generator/library.html',
        permanent: false,
      },
      {
        source: '/calendar',
        destination: '/content-generator/calendar.html',
        permanent: false,
      },
      // Redirect store to production shop site
      {
        source: '/store',
        destination: 'https://shop.govcongiants.com',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
