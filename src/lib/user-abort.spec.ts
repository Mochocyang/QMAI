import { describe, expect, it } from "vitest"
import { isUserAbortError, rethrowIfUserAbort, USER_ABORT_MESSAGE } from "./user-abort"

describe("user-abort", () => {
  it("detects explicit user abort message", () => {
    expect(isUserAbortError(new Error(USER_ABORT_MESSAGE))).toBe(true)
  })

  it("detects aborted signal", () => {
    const controller = new AbortController()
    controller.abort()
    expect(isUserAbortError(new Error("network"), controller.signal)).toBe(true)
  })

  it("rethrows user abort errors", () => {
    const controller = new AbortController()
    controller.abort()
    expect(() => rethrowIfUserAbort(new Error("timeout"), controller.signal)).toThrow(USER_ABORT_MESSAGE)
  })

  it("ignores unrelated errors", () => {
    expect(() => rethrowIfUserAbort(new Error("timeout"))).not.toThrow()
  })

  it("treats Tauri invalid resource id as abort", () => {
    expect(isUserAbortError("The resource id 2199732775 is invalid.")).toBe(true)
    expect(isUserAbortError(new Error("The resource id 1 is invalid."))).toBe(true)
  })
})
