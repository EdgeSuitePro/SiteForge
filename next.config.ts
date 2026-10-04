import type { NextConfig } from 'next';

/** Headers applied to every response. The CSP is set per request in proxy.ts (nonce-based). */
const securityHeaders = [
  // The operator app is private: never index anything.
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // PGlite ships WASM + data files that must be loaded from node_modules at runtime, not bundled.
  serverExternalPackages: ['@electric-sql/pglite'],
  // PGlite migrations are read from db/migrations at runtime; include them in serverless bundles.
  outputFileTracingIncludes: {
    '/**': ['./db/migrations/**/*'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
