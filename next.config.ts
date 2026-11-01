import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';
const config: NextConfig = {
  distDir: process.env.REVLINE_DIST_DIR || ".next",
  turbopack: { root: process.cwd() },
  experimental: { agentUpgrade: 'security' },
  // The MCP consent page grants account access with one click; never let another site frame it.
  async headers() {
    return [{ source: '/connect', headers: [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }] }];
  },
  // Launch post link for Revline Sharingan.
  async redirects() {
    return [{ source: '/sharingan', destination: '/#inspo', permanent: false }];
  },
};
export default process.env.NEXT_PUBLIC_TELEMETRY_ENABLED === 'true' && process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(config, { org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN, silent: true,
    sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN } })
  : config;
