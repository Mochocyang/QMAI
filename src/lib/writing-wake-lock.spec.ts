import { afterEach, describe, expect, it, vi, type Mock } from "vitest"
import {
  resetWritingWakeLockForTests,
  withWritingWakeLock,
  type WritingWakeLockBindings,
} from "./writing-wake-lock"

/** Recorded shape of the IPC mock: one command, optional args, unknown result. */
type InvokeSignature = (command: string, args?: Record<string, unknown>) => Promise<unknown>
type InvokeMock = Mock<InvokeSignature>

function bindings(invokeMock: InvokeMock, tauri = true) {
  // `TauriInvoke` is generic in its result type, so the recorded mock (whose result
  // type is honestly `unknown`) is bridged through an explicitly typed generic
  // wrapper. This keeps `vi.fn` call records for assertions while satisfying the
  // production contract.
  // The rest tuple keeps the forwarded arity identical to the production call, so the
  // recorded `toHaveBeenCalledWith` assertions see the same argument list as before.
  const invoke = async <T>(...call: [command: string, args?: Record<string, unknown>]): Promise<T> =>
    (await invokeMock(...call)) as T

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
    const invoke = vi.fn<InvokeSignature>(async (command: string) => {
      events.push(command)
      return command === "acquire_writing_wake_lock" ? "token-1" : undefined
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
    const invoke = vi.fn<InvokeSignature>(async (command: string) => {
      if (command === "release_writing_wake_lock") throw new Error("release failed")
      return "token-abort"
    })
    const testBindings = bindings(invoke)

    await expect(withWritingWakeLock(true, async () => {
      throw abortError
    }, testBindings)).rejects.toBe(abortError)

    expect(invoke).toHaveBeenLastCalledWith("release_writing_wake_lock", { token: "token-abort" })
    expect(testBindings.warn).toHaveBeenCalledTimes(1)
  })

  it("continues generation when acquisition fails", async () => {
    const invoke = vi.fn<InvokeSignature>(async () => {
      throw new Error("unsupported")
    })
    const testBindings = bindings(invoke)

    await expect(withWritingWakeLock(true, async () => "正文", testBindings)).resolves.toBe("正文")
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(testBindings.warn).toHaveBeenCalledTimes(1)
  })

  it("does not let a release failure mask the operation result", async () => {
    const invoke = vi.fn<InvokeSignature>(async (command: string) => {
      if (command === "release_writing_wake_lock") throw new Error("release failed")
      return "token-release"
    })
    const testBindings = bindings(invoke)

    await expect(withWritingWakeLock(true, async () => "正文", testBindings)).resolves.toBe("正文")
    expect(testBindings.warn).toHaveBeenCalledTimes(1)
  })

  it("is a no-op outside Tauri or when disabled", async () => {
    const invoke = vi.fn<InvokeSignature>()

    await expect(withWritingWakeLock(true, async () => "browser", bindings(invoke, false))).resolves.toBe("browser")
    await expect(withWritingWakeLock(false, async () => "disabled", bindings(invoke))).resolves.toBe("disabled")
    expect(invoke).not.toHaveBeenCalled()
  })

  it("nests holds so only the first acquire and last release talk to Tauri", async () => {
    const invoke = vi.fn<InvokeSignature>(async (command: string) => {
      return command === "acquire_writing_wake_lock" ? "shared-token" : undefined
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
    const invoke = vi.fn<InvokeSignature>(async (command: string) => {
      if (command === "acquire_writing_wake_lock") {
        acquireCalls += 1
        if (acquireCalls === 1) await firstAcquire
        return "concurrent-token"
      }
      return undefined
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
