import type { NextConfig } from "next";

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
        destination: '/opportunity-scout',
        permanent: true,
      },
    ];
  },
  // Rewrites to proxy content-generator to separate app
  async rewrites() {
    return [
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
    ];
  },
};

export default nextConfig;
