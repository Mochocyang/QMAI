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

describe("UI ??????", () => {
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

  it("??????????????????", async () => {
    const uiTest = await loadUiTestModule("0")
    expect(uiTest.IS_UI_TEST_BUILD).toBe(false)
  })

  it("???????????????????", async () => {
    const uiTest = await loadUiTestModule("1")
    expect(uiTest.IS_UI_TEST_BUILD).toBe(true)
  })

  it("?????????????????", async () => {
    const uiTest = await loadUiTestModule("0", "1")
    expect(uiTest.IS_UI_TEST_BUILD).toBe(true)
  })

  it("???????????????????????????", async () => {
    const uiTest = await loadUiTestModule("1", "0")
    expect(uiTest.IS_UI_TEST_BUILD).toBe(false)
  })

  it("?????????????", async () => {
    const uiTest = await loadUiTestModule("0")
    uiTest.setUiTestMode(true)
    expect(localStorage.getItem(MODE_KEY)).toBe("1")
  })
})
