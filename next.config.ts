import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // PGlite is a dev/test dependency only; keep it out of server bundles.
  serverExternalPackages: ['@electric-sql/pglite'],
};

export default nextConfig;
