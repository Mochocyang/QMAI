import { afterEach, describe, expect, it, vi } from "vitest"
import { isDocumentVisible, yieldToBrowserFrame } from "./yield-to-browser"

function stubDocument(visibilityState: DocumentVisibilityState) {
  vi.stubGlobal("document", { visibilityState })
}

describe("yieldToBrowserFrame", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("resolves immediately without rAF when the document is hidden", async () => {
    const raf = vi.fn()
    vi.stubGlobal("requestAnimationFrame", raf)
    stubDocument("hidden")

    expect(isDocumentVisible()).toBe(false)
    await yieldToBrowserFrame()
    expect(raf).not.toHaveBeenCalled()
  })

  it("waits for a frame then a timeout when the document is visible", async () => {
    vi.useFakeTimers()
    const raf = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal("window", {
      requestAnimationFrame: raf,
      setTimeout: globalThis.setTimeout.bind(globalThis),
    })
    stubDocument("visible")

    expect(isDocumentVisible()).toBe(true)
    const done = yieldToBrowserFrame()
    expect(raf).toHaveBeenCalledTimes(1)
    await vi.runAllTimersAsync()
    await done
  })
})

