import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';
import { NEW_PROJECT_PATH, SIGNED_IN_HOME_PATH } from './lib/workspace-routes';
const config: NextConfig = {
  distDir: process.env.REVLINE_DIST_DIR || ".next",
  turbopack: { root: process.cwd() },
  // A page loaded ahead of its click (the sidebar links) stays usable for five minutes. That is Next's own default,
  // written out because the hosted build (vinext) otherwise drops it after 30 seconds and asks the server again on the click.
  experimental: { agentUpgrade: 'security', staleTimes: { static: 300 } },
  // The MCP consent page grants account access with one click; never let another site frame it.
  async headers() {
    return [{ source: '/connect', headers: [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }] }];
  },
  // Retired routes. Temporary (307), matching the page-level redirect() they replace; query strings pass through.
  async redirects() {
    return [
      { source: '/chat', destination: NEW_PROJECT_PATH, permanent: false },
      { source: '/dashboard/chat', destination: NEW_PROJECT_PATH, permanent: false },
      // The conversation view of a project was removed; its links open the project in the editor.
      { source: '/chat/:projectId', destination: '/editor/:projectId', permanent: false },
      // There is no /dashboard page; the signed-in home is the AI Editor's start page.
      { source: '/dashboard', destination: SIGNED_IN_HOME_PATH, permanent: false },
      // The retired project list now lives with the conversation history.
      { source: '/projects', destination: '/chats', permanent: false },
      // Inspo Motion (Sharingan) was retired; old share links land on the home page.
      { source: '/sharingan', destination: '/', permanent: false },
      // Brand kits and Campaigns were removed; old links land on the home.
      { source: '/brand-kits/:path*', destination: SIGNED_IN_HOME_PATH, permanent: false },
      { source: '/campaigns', destination: SIGNED_IN_HOME_PATH, permanent: false },
      { source: '/campaigns/:path*', destination: SIGNED_IN_HOME_PATH, permanent: false },
    ];
  },
};
export default process.env.NEXT_PUBLIC_TELEMETRY_ENABLED === 'true' && process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(config, { org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN, silent: true,
    sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN } })
  : config;
