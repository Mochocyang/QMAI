// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const MODE_KEY = "qmai-ui-test-mode"

async function loadUiTestModule(force: "0" | "1", stored?: "0" | "1") {
  localStorage.clear()
  if (stored !== undefined) localStorage.setItem(MODE_KEY, stored)
  vi.stubEnv("VITE_QMAI_UI_TEST", force)
  vi.resetModules()
  return import("./ui-test")
}

describe("UI 版本切换偏好", () => {
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

  it("正式包没有保存偏好时默认进入旧版界面", async () => {
    const uiTest = await loadUiTestModule("0")
    expect(uiTest.IS_UI_TEST_BUILD).toBe(false)
  })

  it("测试构建没有保存偏好时默认进入新版界面", async () => {
    const uiTest = await loadUiTestModule("1")
    expect(uiTest.IS_UI_TEST_BUILD).toBe(true)
  })

  it("本机明确保存新版偏好后进入新版界面", async () => {
    const uiTest = await loadUiTestModule("0", "1")
    expect(uiTest.IS_UI_TEST_BUILD).toBe(true)
  })

  it("本机明确保存旧版偏好后，即使测试构建默认开启也保持旧版", async () => {
    const uiTest = await loadUiTestModule("1", "0")
    expect(uiTest.IS_UI_TEST_BUILD).toBe(false)
  })

  it("设置界面版本时写入本机偏好", async () => {
    const uiTest = await loadUiTestModule("0")
    uiTest.setUiTestMode(true)
    expect(localStorage.getItem(MODE_KEY)).toBe("1")
  })
})
