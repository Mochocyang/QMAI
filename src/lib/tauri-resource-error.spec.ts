import { describe, expect, it } from "vitest"
import {
  asAbortError,
  isTauriInvalidResourceIdError,
  shouldDropSentryEvent,
} from "./tauri-resource-error"

describe("tauri-resource-error", () => {
  it("detects the raw plugin-http string", () => {
    expect(isTauriInvalidResourceIdError("The resource id 2199732775 is invalid.")).toBe(true)
  })

  it("detects Error and Sentry UnhandledRejection wrappers", () => {
    expect(isTauriInvalidResourceIdError(new Error("The resource id 1 is invalid."))).toBe(true)
    expect(
      isTauriInvalidResourceIdError(
        "UnhandledRejection: Non-Error promise rejection captured with value: The resource id 4231939784 is invalid.",
      ),
    ).toBe(true)
  })

  it("ignores unrelated failures", () => {
    expect(isTauriInvalidResourceIdError(new Error("Failed to fetch"))).toBe(false)
    expect(isTauriInvalidResourceIdError("Request cancelled")).toBe(false)
    expect(isTauriInvalidResourceIdError(undefined)).toBe(false)
  })

  it("builds an AbortError for caller-facing cancel paths", () => {
    expect(asAbortError().name).toBe("AbortError")
  })

  it("drops Sentry events for this race", () => {
    expect(
      shouldDropSentryEvent(
        {
          exception: {
            values: [
              {
                type: "UnhandledRejection",
                value: "Non-Error promise rejection captured with value: The resource id 4231939784 is invalid.",
              },
            ],
          },
        },
      ),
    ).toBe(true)
    expect(shouldDropSentryEvent({ message: "Failed to fetch" })).toBe(false)
  })
})
