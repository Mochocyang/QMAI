// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { isMacOS } from "./platform"

const original = {
  platform: navigator.platform,
  userAgent: navigator.userAgent,
  userAgentData: Object.getOwnPropertyDescriptor(navigator, "userAgentData"),
}

function setNavigator(values: { platform: string; userAgent: string; userAgentData?: { platform?: string } }) {
  Object.defineProperty(navigator, "platform", { configurable: true, value: values.platform })
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: values.userAgent })
  Object.defineProperty(navigator, "userAgentData", { configurable: true, value: values.userAgentData })
}

afterEach(() => {
  Object.defineProperty(navigator, "platform", { configurable: true, value: original.platform })
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: original.userAgent })
  if (original.userAgentData) Object.defineProperty(navigator, "userAgentData", original.userAgentData)
  else delete (navigator as Navigator & { userAgentData?: unknown }).userAgentData
})

describe("isMacOS", () => {
  it("优先相信 userAgentData", () => {
    setNavigator({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0)", userAgentData: { platform: "macOS" } })
    expect(isMacOS()).toBe(true)
    setNavigator({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", userAgentData: { platform: "Windows" } })
    expect(isMacOS()).toBe(false)
  })

  it("没有 client hint 时回退到 platform 和 userAgent", () => {
    setNavigator({ platform: "MacIntel", userAgent: "Mozilla/5.0" })
    expect(isMacOS()).toBe(true)
    setNavigator({ platform: "Win32", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" })
    expect(isMacOS()).toBe(true)
    setNavigator({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0)" })
    expect(isMacOS()).toBe(false)
  })
})
