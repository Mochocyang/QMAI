// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ChangelogSection } from "./changelog-section"
import * as notice from "@/lib/app-update-notice"

/**
 * 「有更新时自动提醒」开关的界面行为。
 *
 * 只验三件事：开关默认开着、点一下能关掉并落盘、关闭后文案改成"不打扰"。
 * 红点逻辑本身在 app-update-notice.test.ts 里覆盖。
 */

const saveMock = vi.fn(async () => undefined)
const storeValues = new Map<string, unknown>()

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "zh" },
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? "",
  }),
}))

vi.mock("@/lib/platform", () => ({
  isTauri: () => true,
}))

vi.mock("@/lib/app-update-support", () => ({
  isAppAutoUpdateSupported: () => true,
  APP_AUTO_UPDATE_UNSUPPORTED_MESSAGE: "当前平台暂不支持应用内自动更新，请前往 GitHub Releases 手动下载安装包。",
  APP_AUTO_UPDATE_RELEASES_URL: "https://github.com/Mochocyang/QMAI/releases",
}))

vi.mock("@/lib/web-store", () => ({
  getStore: async () => ({
    get: async (key: string) => storeValues.get(key),
    set: async (key: string, value: unknown) => {
      storeValues.set(key, value)
    },
    delete: async (key: string) => {
      storeValues.delete(key)
    },
    save: saveMock,
  }),
}))

describe("ChangelogSection 自动提醒开关", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    storeValues.clear()
    saveMock.mockClear()
    notice.resetAppUpdateNoticeForTests()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    notice.resetAppUpdateNoticeForTests()
  })

  it("默认开启，且不显示多余的说明文字", async () => {
    await act(async () => {
      root.render(<ChangelogSection />)
    })

    const sw = host.querySelector('[data-ui="app-update-auto-prompt-switch"]')
    expect(sw).not.toBeNull()
    expect(sw?.getAttribute("aria-checked")).toBe("true")
    expect(host.textContent).toContain("有更新时自动提醒")
    // 开启状态下不再显示「会弹窗询问是否下载安装。」这句话
    expect(host.textContent).not.toContain("会弹窗询问是否下载安装")
  })

  it("点击开关后关闭，并写入设置", async () => {
    await act(async () => {
      root.render(<ChangelogSection />)
    })

    const sw = host.querySelector<HTMLButtonElement>('[data-ui="app-update-auto-prompt-switch"]')
    await act(async () => {
      sw?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(notice.getAppUpdateAutoPrompt()).toBe(false)
    expect(storeValues.get("appUpdateAutoPrompt")).toBe(false)
    expect(saveMock).toHaveBeenCalled()
    expect(host.querySelector('[data-ui="app-update-auto-prompt-switch"]')?.getAttribute("aria-checked")).toBe("false")
    expect(host.textContent).toContain("不再弹窗打扰")
  })
})
