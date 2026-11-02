// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 「关闭后不会再发出任何统计请求」的完整兑现。
 *
 * 界面原文（analytics-privacy-toggle.tsx）就是这么承诺的，隐私政策也写了
 * 「可以在设置中关闭使用统计上报」。但开关有两处绕过点：
 *   1. 关窗时的 sendBeacon(/close)：同步回调，读不了 store；
 *   2. 心跳定时器：关掉后不清掉，每 5 分钟还会进一次发送路径。
 * 主发送路径 sendAnalytics 有门控挡着， beacon 却绕过了它——所以必须缓存
 * 一份开关的同步镜像（cachedEnabled）给 beforeunload 用。
 *
 * 现有 analytics-opt-out.spec 只测了「启动时已关闭 → initAnalytics 不发请求」，
 * 测不到「运行中关闭 → 关窗仍发」这条真实漏网路径。这里补上。
 */

const store = new Map<string, unknown>()
let beacon: ReturnType<typeof vi.fn>
let heartbeatInterval: number | null = null

vi.mock("@/lib/web-store", () => ({
  getStore: vi.fn(async () => ({
    get: async (key: string) => store.get(key),
    set: async (key: string, value: unknown) => void store.set(key, value),
  })),
}))

vi.mock("@/lib/platform", () => ({ isTauri: vi.fn(() => false) }))

beforeEach(() => {
  vi.resetModules()
  store.clear()
  beacon = vi.fn(() => true)
  heartbeatInterval = null
  // 真实 setInterval 在 jsdom 里可用；这里只保证不真的等 5 分钟。
  vi.stubGlobal("navigator", { sendBeacon: beacon })
  vi.stubGlobal("crypto", { randomUUID: () => "uuid-fixed" })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function flush(): Promise<void> {
  await act()
}

/** 等若干微任务 + 宏任务，让动态 import 与 store 读写都落地。 */
function act(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe("运行中关闭统计开关", () => {
  it("关窗的 /close beacon 不再发出（旧实现会漏发这一次）", async () => {
    const { initAnalytics, setAnalyticsEnabled } = await import("./analytics")
    const fetchMock = vi.fn(async () => new Response("{}"))
    vi.stubGlobal("fetch", fetchMock)

    await initAnalytics()
    expect(fetchMock).toHaveBeenCalled() // /open 已发

    await setAnalyticsEnabled(false)
    await flush()
    fetchMock.mockClear()

    window.dispatchEvent(new Event("beforeunload"))
    await flush()

    expect(beacon).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("关闭时清掉心跳定时器（否则每 5 分钟空转一次）", async () => {
    const { initAnalytics, setAnalyticsEnabled } = await import("./analytics")
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")))
    const clearSpy = vi.spyOn(window, "clearInterval")

    await initAnalytics()
    await setAnalyticsEnabled(false)
    await flush()

    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  it("启动时就是关闭的：beforeunload 同样静默", async () => {
    store.set("analytics_enabled", false)
    const { initAnalytics } = await import("./analytics")
    const fetchMock = vi.fn(async () => new Response("{}"))
    vi.stubGlobal("fetch", fetchMock)

    await initAnalytics()
    await flush()
    window.dispatchEvent(new Event("beforeunload"))
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(beacon).not.toHaveBeenCalled()
  })

  it("开着时关窗仍正常上报 /close（别把功能修没了）", async () => {
    const { initAnalytics } = await import("./analytics")
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")))

    await initAnalytics()
    await flush()
    window.dispatchEvent(new Event("beforeunload"))

    expect(beacon).toHaveBeenCalledTimes(1)
    expect(String(beacon.mock.calls[0]?.[0])).toContain("/close")
  })

  it("没在界面上动过开关时维持默认=开（存储里没有键）", async () => {
    const { initAnalytics } = await import("./analytics")
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")))

    await initAnalytics()
    await flush()
    window.dispatchEvent(new Event("beforeunload"))

    expect(beacon).toHaveBeenCalled()
  })
})
