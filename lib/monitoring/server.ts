import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from './sentry-options';

/** Sentry for the Node.js and edge runtimes; Next loads each through its own config file. */
export function initServerSentry() {
  Sentry.init({ ...sentryOptions, dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN, environment: process.env.NODE_ENV });
}
