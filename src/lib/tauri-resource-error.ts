/**
 * Tauri drops a native resource (HTTP request/response handle) and then
 * a later IPC still uses that id. plugin-http does this on abort:
 * `fetch_cancel` / `fetch_cancel_body` are fire-and-forget, so the
 * rejection becomes an unhandled string, not a JS Error.
 *
 * Matches QMAI-2 / `Error::BadResourceId`.
 */
const INVALID_RESOURCE_ID = /The resource id \d+ is invalid/i

export function isTauriInvalidResourceIdError(error: unknown): boolean {
  if (typeof error === "string") return INVALID_RESOURCE_ID.test(error)
  if (error instanceof Error) return INVALID_RESOURCE_ID.test(error.message)
  if (error && typeof error === "object") {
    const message = "message" in error && typeof error.message === "string" ? error.message : ""
    const value = "value" in error && typeof error.value === "string" ? error.value : ""
    return INVALID_RESOURCE_ID.test(message) || INVALID_RESOURCE_ID.test(value)
  }
  return false
}

export function asAbortError(message = "The operation was aborted."): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError")
  }
  const error = new Error(message)
  error.name = "AbortError"
  return error
}

export function shouldDropSentryEvent(
  event: {
    message?: string
    exception?: { values?: Array<{ type?: string; value?: string }> }
  },
  originalException?: unknown,
): boolean {
  if (isTauriInvalidResourceIdError(originalException)) return true
  if (isTauriInvalidResourceIdError(event.message)) return true
  return (event.exception?.values ?? []).some(
    (value) =>
      isTauriInvalidResourceIdError(value.value) || isTauriInvalidResourceIdError(value.type),
  )
}
