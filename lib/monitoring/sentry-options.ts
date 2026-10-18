import type { ErrorEvent } from '@sentry/nextjs';

/** Error diagnostics only. Editing content and authenticated request data stay out. */
export const sentryOptions = {
  tracesSampleRate: 0,
  beforeSendLog: () => null,
  beforeSendMetric: () => null,
  maxBreadcrumbs: 0,
  dataCollection: {
    userInfo: false, cookies: false, httpHeaders: false, httpBodies: [],
    urlQueryParams: false, genAI: { inputs: false, outputs: false },
    graphQL: { document: false, variables: false },
    databaseQueryData: false, queues: false, stackFrameVariables: false,
  },
  beforeSend(event: ErrorEvent) {
    delete event.user;
    delete event.extra;
    event.breadcrumbs = [];
    if (event.request) {
      const { url, method } = event.request;
      let cleanUrl: string | undefined;
      try { const parsed = new URL(url!); cleanUrl = parsed.origin + parsed.pathname; } catch { /* No URL is safer than an unparsed request. */ }
      event.request = { ...(cleanUrl ? { url: cleanUrl } : {}), ...(method ? { method } : {}) };
    }
    return event;
  },
} satisfies Parameters<typeof import('@sentry/nextjs').init>[0];
