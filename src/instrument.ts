import * as Sentry from "@sentry/react"

const SENTRY_DSN =
  import.meta.env.VITE_SENTRY_DSN ??
  "https://21511c3bd5d4d5cd36153b550347aea4@o4512089544720384.ingest.us.sentry.io/4512089608093696"

if (import.meta.env.MODE !== "test") {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.PROD ? "production" : "development",
    release: `qmai@${__APP_VERSION__}`,
    // Developer includes errors + tracing. Logs/metrics APIs default on in SDK 10
    // but we do not use them; profiling is PAYG-only; replay is unused.
    enableLogs: false,
    enableMetrics: false,
    profilesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
    // Do not attach sentry-trace headers to LLM / third-party fetches.
    tracePropagationTargets: [],
    dataCollection: {
      userInfo: false,
      httpBodies: [],
    },
    beforeBreadcrumb(breadcrumb) {
      if (typeof breadcrumb.message === "string" && breadcrumb.message.length > 200) {
        breadcrumb.message = `${breadcrumb.message.slice(0, 200)}…`
      }
      return breadcrumb
    },
  })
}

export function captureAppException(error: unknown): void {
  Sentry.captureException(error)
}
