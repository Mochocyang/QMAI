import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 「关闭使用统计」必须真的关得掉。
 *
 * 背景：隐私政策对用户承诺了「你可以在设置中关闭使用统计上报」。
 * 第一版实现里开关渲染出来了，但 `initAnalytics` 从不读它 ——
 * 关掉之后照样发 /open、照样每 5 分钟心跳、关闭时还发 /close。
 * 那就是一个假开关：用户以为停了，实际一个请求都没少。
 *
 * 这组用例锁的是「关掉之后一个请求都不发」，而不是「有一个开关」。
 */

const store = new Map<string, unknown>()

vi.mock("@/lib/web-store", () => ({
  getStore: vi.fn(async () => ({
    get: async (key: string) => store.get(key),
    set: async (key: string, value: unknown) => void store.set(key, value),
  })),
}))

vi.mock("@/lib/platform", () => ({ isTauri: vi.fn(() => false) }))

describe("使用统计开关", () => {
  beforeEach(() => {
    store.clear()
    vi.resetModules()
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")))
    vi.stubGlobal("navigator", { userAgent: "Windows", sendBeacon: vi.fn() })
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-fixed" })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("默认开启（未设置时按开启处理）", async () => {
    const { isAnalyticsEnabled } = await import("./analytics")
    expect(await isAnalyticsEnabled()).toBe(true)
  })

  it("显式关闭后读取为关闭", async () => {
    const { isAnalyticsEnabled, setAnalyticsEnabled } = await import("./analytics")
    await setAnalyticsEnabled(false)
    expect(await isAnalyticsEnabled()).toBe(false)
  })

  it("关闭后 initAnalytics 一个请求都不发", async () => {
    const { initAnalytics, setAnalyticsEnabled } = await import("./analytics")
    await setAnalyticsEnabled(false)
    const fetchMock = vi.fn(async () => new Response("{}"))
    vi.stubGlobal("fetch", fetchMock)

    await initAnalytics()

    // 关键断言：不是「少发了几个」，而是一个都没有。
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("开启时 initAnalytics 会发出 /open", async () => {
    const { initAnalytics } = await import("./analytics")
    const fetchMock = vi.fn(async () => new Response("{}"))
    vi.stubGlobal("fetch", fetchMock)

    await initAnalytics()

    expect(fetchMock).toHaveBeenCalled()
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/open")
  })

  it("关闭时不删除已有 uuid，再次开启沿用同一标识", async () => {
    const { setAnalyticsEnabled } = await import("./analytics")
    store.set("analytics_device_uuid", "uuid-existing")

    await setAnalyticsEnabled(false)
    await setAnalyticsEnabled(true)

    expect(store.get("analytics_device_uuid")).toBe("uuid-existing")
  })
})
