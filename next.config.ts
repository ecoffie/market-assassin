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
  serverExternalPackages: ['pdf-parse', 'mammoth'],
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
  },
  // Rewrites for host-based routing
  async rewrites() {
    return {
      // beforeFiles rewrites run BEFORE filesystem checks
      // This allows host-based routing to override page.tsx
      beforeFiles: [
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
        // getmindy.ai root serves the Mindy landing page
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
