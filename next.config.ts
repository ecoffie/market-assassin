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
          source: '/app',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/mi-beta',
        },
        {
          source: '/signin',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/briefings',
        },
        {
          source: '/signup',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/mi-beta/signup',
        },
        {
          source: '/onboarding',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/mi-beta/onboarding',
        },
        {
          source: '/setup-password',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/mi-beta/setup-password',
        },
        {
          source: '/setup-account',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/mi-beta/setup-account',
        },
        {
          source: '/forgot-password',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/mi-beta/forgot-password',
        },
        {
          source: '/reset-password',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/mi-beta/reset-password',
        },
        {
          source: '/auth/callback',
          has: [{ type: 'host', value: 'getmindy.ai' }],
          destination: '/mi-beta/auth/callback',
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
        source: '/mi-beta',
        has: [{ type: 'host', value: 'getmindy.ai' }],
        destination: 'https://getmindy.ai/app',
        permanent: false,
      },
      {
        source: '/mi-beta/signup',
        has: [{ type: 'host', value: 'getmindy.ai' }],
        destination: 'https://getmindy.ai/signup',
        permanent: false,
      },
      {
        source: '/mi-beta/onboarding',
        has: [{ type: 'host', value: 'getmindy.ai' }],
        destination: 'https://getmindy.ai/onboarding',
        permanent: false,
      },
      {
        source: '/mi-beta/setup-password',
        has: [{ type: 'host', value: 'getmindy.ai' }],
        destination: 'https://getmindy.ai/setup-password',
        permanent: false,
      },
      {
        source: '/mi-beta/setup-account',
        has: [{ type: 'host', value: 'getmindy.ai' }],
        destination: 'https://getmindy.ai/setup-account',
        permanent: false,
      },
      {
        source: '/mi-beta/forgot-password',
        has: [{ type: 'host', value: 'getmindy.ai' }],
        destination: 'https://getmindy.ai/forgot-password',
        permanent: false,
      },
      {
        source: '/mi-beta/reset-password',
        has: [{ type: 'host', value: 'getmindy.ai' }],
        destination: 'https://getmindy.ai/reset-password',
        permanent: false,
      },
      {
        source: '/mi-beta/auth/callback',
        has: [{ type: 'host', value: 'getmindy.ai' }],
        destination: 'https://getmindy.ai/auth/callback',
        permanent: false,
      },
      {
        source: '/mi-beta/signup',
        has: [{ type: 'host', value: 'mi.govcongiants.com' }],
        destination: 'https://getmindy.ai/signup',
        permanent: false,
      },
      {
        source: '/mi-beta/onboarding',
        has: [{ type: 'host', value: 'mi.govcongiants.com' }],
        destination: 'https://getmindy.ai/onboarding',
        permanent: false,
      },
      {
        source: '/mi-beta/setup-password',
        has: [{ type: 'host', value: 'mi.govcongiants.com' }],
        destination: 'https://getmindy.ai/setup-password',
        permanent: false,
      },
      {
        source: '/mi-beta/setup-account',
        has: [{ type: 'host', value: 'mi.govcongiants.com' }],
        destination: 'https://getmindy.ai/setup-account',
        permanent: false,
      },
      {
        source: '/mi-beta/forgot-password',
        has: [{ type: 'host', value: 'mi.govcongiants.com' }],
        destination: 'https://getmindy.ai/forgot-password',
        permanent: false,
      },
      {
        source: '/mi-beta/reset-password',
        has: [{ type: 'host', value: 'mi.govcongiants.com' }],
        destination: 'https://getmindy.ai/reset-password',
        permanent: false,
      },
      {
        source: '/mi-beta/auth/callback',
        has: [{ type: 'host', value: 'mi.govcongiants.com' }],
        destination: 'https://getmindy.ai/auth/callback',
        permanent: false,
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
