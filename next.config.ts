import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';
const config: NextConfig = {
  distDir: process.env.REVLINE_DIST_DIR || ".next",
  turbopack: { root: process.cwd() },
};
export default process.env.NEXT_PUBLIC_TELEMETRY_ENABLED === 'true' && process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(config, { org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN, silent: true,
    sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN } })
  : config;
