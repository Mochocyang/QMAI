// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const MODE_KEY = "qmai-ui-test-mode"

describe("UI 界面版本（只保留新版）", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    localStorage.clear()
  })

  it("只保留新版界面：无论本机偏好与构建环境如何，恒为最新版", async () => {
    // 无本机偏好、无强制环境变量
    vi.stubEnv("VITE_QMAI_UI_TEST", undefined)
    vi.resetModules()
    const a = await import("./ui-test")

    // 明确写了旧版偏好 + 构建强制开关
    localStorage.setItem(MODE_KEY, "0")
    vi.stubEnv("VITE_QMAI_UI_TEST", "0")
    vi.resetModules()
    const b = await import("./ui-test")

    expect(a.IS_UI_TEST_BUILD).toBe(true)
    expect(b.IS_UI_TEST_BUILD).toBe(true)
  })

  it("setUiTestMode 仍兼容写入本机偏好（不再改变界面选择）", async () => {
    vi.resetModules()
    const uiTest = await import("./ui-test")
    uiTest.setUiTestMode(true)
    expect(localStorage.getItem(MODE_KEY)).toBe("1")
  })
})
