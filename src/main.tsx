import "./instrument"

import React from "react"
import ReactDOM from "react-dom/client"
import * as Sentry from "@sentry/react"
import App from "./App"
import "./index.css"
import "@/i18n"
import { ToastProvider } from "@/lib/toast"

ReactDOM.createRoot(document.getElementById("root") as HTMLElement, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
)
