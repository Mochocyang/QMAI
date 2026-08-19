import { afterEach, describe, expect, it, vi } from "vitest"
import {
  resetWritingWakeLockForTests,
  withWritingWakeLock,
  type WritingWakeLockBindings,
} from "./writing-wake-lock"

function bindings(invoke: WritingWakeLockBindings["invoke"], tauri = true) {
  return {
    isTauri: () => tauri,
    invoke,
    warn: vi.fn(),
  } satisfies WritingWakeLockBindings
}

describe("withWritingWakeLock", () => {
  afterEach(() => {
    resetWritingWakeLockForTests()
  })

  it("acquires before the operation and releases after it completes", async () => {
    const events: string[] = []
    const invoke = vi.fn(async <T>(command: string) => {
      events.push(command)
      return (command === "acquire_writing_wake_lock" ? "token-1" : undefined) as T
    })

    const result = await withWritingWakeLock(true, async () => {
      events.push("operation")
      return "正文"
    }, bindings(invoke))

    expect(result).toBe("正文")
    expect(events).toEqual([
      "acquire_writing_wake_lock",
      "operation",
      "release_writing_wake_lock",
    ])
    expect(invoke).toHaveBeenLastCalledWith("release_writing_wake_lock", { token: "token-1" })
  })

  it("releases after an aborted or failed operation and preserves the original error", async () => {
    const abortError = new DOMException("cancelled", "AbortError")
    const invoke = vi.fn(async <T>(command: string) => {
      if (command === "release_writing_wake_lock") throw new Error("release failed")
      return "token-abort" as T
    })
    const testBindings = bindings(invoke)

    await expect(withWritingWakeLock(true, async () => {
      throw abortError
    }, testBindings)).rejects.toBe(abortError)

    expect(invoke).toHaveBeenLastCalledWith("release_writing_wake_lock", { token: "token-abort" })
    expect(testBindings.warn).toHaveBeenCalledTimes(1)
  })

  it("continues generation when acquisition fails", async () => {
    const invoke = vi.fn(async <T>() => {
      throw new Error("unsupported")
    })
    const testBindings = bindings(invoke)

    await expect(withWritingWakeLock(true, async () => "正文", testBindings)).resolves.toBe("正文")
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(testBindings.warn).toHaveBeenCalledTimes(1)
  })

  it("does not let a release failure mask the operation result", async () => {
    const invoke = vi.fn(async <T>(command: string) => {
      if (command === "release_writing_wake_lock") throw new Error("release failed")
      return "token-release" as T
    })
    const testBindings = bindings(invoke)

    await expect(withWritingWakeLock(true, async () => "正文", testBindings)).resolves.toBe("正文")
    expect(testBindings.warn).toHaveBeenCalledTimes(1)
  })

  it("is a no-op outside Tauri or when disabled", async () => {
    const invoke = vi.fn()

    await expect(withWritingWakeLock(true, async () => "browser", bindings(invoke, false))).resolves.toBe("browser")
    await expect(withWritingWakeLock(false, async () => "disabled", bindings(invoke))).resolves.toBe("disabled")
    expect(invoke).not.toHaveBeenCalled()
  })

  it("nests holds so only the first acquire and last release talk to Tauri", async () => {
    const invoke = vi.fn(async <T>(command: string) => {
      return (command === "acquire_writing_wake_lock" ? "shared-token" : undefined) as T
    })
    const testBindings = bindings(invoke)

    await withWritingWakeLock(true, async () => {
      await withWritingWakeLock(true, async () => {
        expect(invoke).toHaveBeenCalledTimes(1)
        expect(invoke).toHaveBeenCalledWith("acquire_writing_wake_lock")
      }, testBindings)
      expect(invoke).toHaveBeenCalledTimes(1)
    }, testBindings)

    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenLastCalledWith("release_writing_wake_lock", { token: "shared-token" })
  })

  it("serializes concurrent acquires so only one IPC token is created", async () => {
    let releaseFirst!: () => void
    const firstAcquire = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let acquireCalls = 0
    const invoke = vi.fn(async <T>(command: string) => {
      if (command === "acquire_writing_wake_lock") {
        acquireCalls += 1
        if (acquireCalls === 1) await firstAcquire
        return "concurrent-token" as T
      }
      return undefined as T
    })
    const testBindings = bindings(invoke)

    const first = withWritingWakeLock(true, async () => "a", testBindings)
    const second = withWritingWakeLock(true, async () => "b", testBindings)
    await Promise.resolve()
    expect(invoke).toHaveBeenCalledTimes(1)
    releaseFirst()
    await expect(Promise.all([first, second])).resolves.toEqual(["a", "b"])
    expect(invoke.mock.calls.filter(([command]) => command === "acquire_writing_wake_lock")).toHaveLength(1)
    expect(invoke.mock.calls.filter(([command]) => command === "release_writing_wake_lock")).toHaveLength(1)
  })
})
