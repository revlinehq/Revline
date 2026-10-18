import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from './lib/monitoring/sentry-options';

Sentry.init({ ...sentryOptions, dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN, environment: process.env.NODE_ENV });
