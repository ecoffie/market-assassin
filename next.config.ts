import type { NextConfig } from "next";

/**
 * PROXY CONFIGURATION GUIDE
 * ========================
 * When adding new proxied apps/pages, ensure you add rewrites for:
 * 1. The main page(s) - e.g., /library, /calendar
 * 2. Static assets - e.g., /js/*, /css/*, /images/*
 * 3. API routes used by those pages
 *
 * Current proxied apps:
 * - GovCon Content Generator (govcon-content-generator.vercel.app)
 *   - Pages: /content-generator/*, /library, /calendar
 *   - Assets: /js/*
 *   - APIs: handled via /content-generator/api/*
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
  // Redirects for legacy URLs
  async redirects() {
    return [
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
    ];
  },
  // Rewrites to proxy content-generator to separate app
  async rewrites() {
    return [
      // Handle /content-generator without trailing slash
      {
        source: '/content-generator',
        destination: 'https://govcon-content-generator.vercel.app/',
      },
      {
        source: '/content-generator/',
        destination: 'https://govcon-content-generator.vercel.app/',
      },
      {
        source: '/content-generator/:path*',
        destination: 'https://govcon-content-generator.vercel.app/:path*',
      },
      // Direct access to calendar and library pages
      {
        source: '/calendar',
        destination: 'https://govcon-content-generator.vercel.app/calendar.html',
      },
      {
        source: '/library',
        destination: 'https://govcon-content-generator.vercel.app/library.html',
      },
      {
        source: '/library.html',
        destination: 'https://govcon-content-generator.vercel.app/library.html',
      },
      // Proxy JS files for content generator pages
      {
        source: '/js/:path*',
        destination: 'https://govcon-content-generator.vercel.app/js/:path*',
      },
      // Proxy API routes for calendar and library pages (using _proxy prefix to avoid Next.js API conflicts)
      {
        source: '/_proxy/calendar-events',
        destination: 'https://govcon-content-generator.vercel.app/api/calendar-events',
      },
      {
        source: '/_proxy/upload-carousel',
        destination: 'https://govcon-content-generator.vercel.app/api/upload-carousel',
      },
    ];
  },
};

export default nextConfig;
