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
};

export default nextConfig;
