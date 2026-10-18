import { sentryOptions } from './sentry-options';

const enabled = process.env.NEXT_PUBLIC_TELEMETRY_ENABLED === 'true';
let sentry: Promise<typeof import('@sentry/nextjs')> | undefined;
let started = false;

export function initializeClientMonitoring() {
  if (!enabled || started) return;
  started = true;
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    sentry = import('@sentry/nextjs').then(sdk => {
      sdk.init({ ...sentryOptions, dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        environment: process.env.NODE_ENV, replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 0 });
      return sdk;
    });
    void sentry.catch(() => console.warn('[monitoring] Error reporting could not initialize.'));
  }
  if (process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_HOST) {
    void import('posthog-js').then(({ default: posthog }) => {
      posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
        capture_pageview: 'history_change', capture_pageleave: true,
        autocapture: false, capture_dead_clicks: false, capture_exceptions: false,
        disable_session_recording: true, enable_heatmaps: false,
        disable_surveys: true, disable_external_dependency_loading: true,
        advanced_disable_feature_flags: true, person_profiles: 'never', persistence: 'memory',
        save_referrer: false, save_campaign_params: false,
        before_send: event => {
          if (!event) return event;
          for (const key of ['$current_url', '$referrer', '$initial_current_url', '$initial_referrer', '$prev_pageview_url']) {
            const value = event.properties[key];
            if (typeof value !== 'string') continue;
            try { const url = new URL(value); event.properties[key] = url.origin + url.pathname; }
            catch { delete event.properties[key]; }
          }
          return event;
        },
      });
    }).catch(() => console.warn('[monitoring] Analytics could not initialize.'));
  }
}

export function captureClientException(error: unknown) {
  initializeClientMonitoring();
  void sentry?.then(sdk => { sdk.captureException(error); }).catch(() => {});
}

export function captureClientNavigation(url: string, navigationType: string) {
  void sentry?.then(sdk => { sdk.captureRouterTransitionStart(url, navigationType); }).catch(() => {});
}
