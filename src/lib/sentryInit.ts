import * as Sentry from "@sentry/react";

export function initSentry() {
  Sentry.init({
    dsn: "https://7c7720bcac05c957156fdc831610cc54@o4511269926338560.ingest.us.sentry.io/4511269949210624",
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.url) {
        try {
          const u = new URL(event.request.url);
          event.request.url = `${u.origin}${u.pathname}`;
        } catch {
          /* leave url as-is if unparseable */
        }
      }
      if (event.user) {
        event.user = event.user.id ? { id: "[redacted]" } : {};
      }
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data?.url && typeof breadcrumb.data.url === "string") {
        try {
          const u = new URL(breadcrumb.data.url);
          breadcrumb.data.url = `${u.origin}${u.pathname}`;
        } catch {
          /* leave url as-is if unparseable */
        }
      }
      if (breadcrumb.category === "console") {
        return null;
      }
      return breadcrumb;
    },
  });
}
