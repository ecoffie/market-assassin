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
          source: '/about',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/about',
        },
        {
          source: '/free-resources',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/free-resources',
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
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  // Redirects for legacy URLs and convenience
  async redirects() {
    return [
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
