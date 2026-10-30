import * as Sentry from "@sentry/react"
import {
  isTauriInvalidResourceIdError,
  shouldDropSentryEvent,
} from "@/lib/tauri-resource-error"

const SENTRY_DSN =
  import.meta.env.VITE_SENTRY_DSN ??
  "https://21511c3bd5d4d5cd36153b550347aea4@o4512089544720384.ingest.us.sentry.io/4512089608093696"

/**
 * 上报前抹掉 URL 里的凭据。
 *
 * 用户可以在「自定义模型 / 自定义搜索」里填任意 endpoint，其中很可能带
 * `?key=…` 或 `?api_key=…`；Sentry 的 fetch/XHR 面包屑与错误事件里的
 * `request.url` 会原样带上整个 URL，等于把密钥送到第三方。
 * 这里只保留结构，敏感查询参数一律替换成 REDACTED。
 */
const SENSITIVE_QUERY_NAME = /^(key|api[-_]?key|apikey|token|access[-_]?token|refresh[-_]?token|secret|client[-_]?secret|password|passwd|sig|signature|auth)$/i

function scrubUrl(raw: string): string {
  try {
    const hasOrigin = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    const url = new URL(raw, "http://scrub.invalid")
    let touched = false
    if (url.username || url.password) {
      url.username = ""
      url.password = ""
      touched = true
    }
    for (const name of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_NAME.test(name)) {
        url.searchParams.set(name, "REDACTED")
        touched = true
      }
    }
    if (!touched) return raw
    return hasOrigin ? url.toString() : `${url.pathname}${url.search}${url.hash}`
  } catch {
    return raw.replace(/((?:key|token|secret|password)=)[^&#\s]*/gi, "$1REDACTED")
  }
}

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
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.feedbackIntegration({
        autoInject: false,
        enableScreenshot: false,
        colorScheme: "system",
        showBranding: false,
        tags: { source: "settings" },
      }),
    ],
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
    // Do not attach sentry-trace headers to LLM / third-party fetches.
    tracePropagationTargets: [],
    dataCollection: {
      userInfo: false,
      httpBodies: [],
    },
    // QMAI-2: plugin-http abort races reject a bare string after the
    // native resource is already dropped. Not an app bug.
    ignoreErrors: [/The resource id \d+ is invalid/i],
    beforeBreadcrumb(breadcrumb) {
      if (typeof breadcrumb.message === "string" && breadcrumb.message.length > 200) {
        breadcrumb.message = `${breadcrumb.message.slice(0, 200)}…`
      }
      const data = breadcrumb.data
      if (data && typeof data === "object") {
        for (const field of ["url", "from", "to"] as const) {
          const value = (data as Record<string, unknown>)[field]
          if (typeof value === "string" && value.includes("?")) {
            ;(data as Record<string, unknown>)[field] = scrubUrl(value)
          }
        }
      }
      return breadcrumb
    },
    beforeSend(event, hint) {
      if (shouldDropSentryEvent(event, hint.originalException)) {
        return null
      }
      if (event.request && typeof event.request.url === "string") {
        event.request.url = scrubUrl(event.request.url)
      }
      return event
    },
  })

  window.addEventListener("unhandledrejection", (event) => {
    if (!isTauriInvalidResourceIdError(event.reason)) return
    event.preventDefault()
  })
}

export function captureAppException(error: unknown): void {
  Sentry.captureException(error)
}
