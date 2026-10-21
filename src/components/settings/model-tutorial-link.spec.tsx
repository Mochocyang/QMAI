// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"

const openExternalUrl = vi.hoisted(() => vi.fn<() => Promise<void>>())

vi.mock("@/i18n", () => ({ default: { language: "zh-CN" } }))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}))
vi.mock("@/lib/platform", () => ({ isTauri: () => false }))
vi.mock("@/lib/open-external-url", () => ({ openExternalUrl }))
// 面板本身不是本用例的观察对象；把重的兄弟模块也 mock 掉，只留页签行与教程链接。
vi.mock("@/components/settings/sections/llm-provider-section", () => ({
  LlmProviderSection: () => <div data-testid="llm-panel" />,
}))
vi.mock("@/components/settings/sections/default-model-settings-panel", () => ({
  DefaultModelSettingsPanel: () => <div data-testid="default-panel" />,
}))
vi.mock("@/components/uitest/models/retrieval-models", () => ({
  UiTestRerankModels: () => <div data-testid="rerank-panel" />,
  UiTestEmbeddingModels: () => <div data-testid="embedding-panel" />,
}))

import { UiTestModelSettingsSection } from "./settings-view"
import { MODEL_SETTINGS_TUTORIAL_URL } from "./model-tutorial-link"

let host: HTMLDivElement
let root: Root

beforeEach(async () => {
  openExternalUrl.mockReset().mockResolvedValue(undefined)
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useWikiStore.setState({ activeModelSettingsTab: null, project: null })
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<UiTestModelSettingsSection draft={{} as never} setDraft={(() => {}) as never} />)
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

const tutorialLink = () => host.querySelector<HTMLAnchorElement>(`a[href="${MODEL_SETTINGS_TUTORIAL_URL}"]`)

async function switchTab(tab: "llm" | "rerank" | "embedding" | "default") {
  const button = host.querySelector<HTMLButtonElement>(`[data-ui-model-tab="${tab}"]`)
  expect(button, tab).toBeTruthy()
  await act(async () => button!.click())
}

describe("模型设置教程链接", () => {
  it("默认的「大语言模型」页签就显示教程链接，文案与地址正确", () => {
    const link = tutorialLink()
    expect(link).not.toBeNull()
    expect(link!.textContent).toContain("模型设置教程")
    expect(link!.getAttribute("href")).toBe(MODEL_SETTINGS_TUTORIAL_URL)
    // 新窗口打开 + noreferrer，避免把应用窗口本身导航走。
    expect(link!.getAttribute("target")).toBe("_blank")
    expect(link!.getAttribute("rel")).toBe("noreferrer")
  })

  it("「重排模型」「向量模型」页签同样显示，且同一时刻只有一个", async () => {
    await switchTab("rerank")
    expect(host.querySelector('[data-testid="rerank-panel"]')).not.toBeNull()
    expect(host.querySelectorAll(`a[href="${MODEL_SETTINGS_TUTORIAL_URL}"]`)).toHaveLength(1)

    await switchTab("embedding")
    expect(host.querySelector('[data-testid="embedding-panel"]')).not.toBeNull()
    expect(host.querySelectorAll(`a[href="${MODEL_SETTINGS_TUTORIAL_URL}"]`)).toHaveLength(1)

    await switchTab("llm")
    expect(host.querySelector('[data-testid="llm-panel"]')).not.toBeNull()
    expect(tutorialLink()).not.toBeNull()
  })

  it("「默认模型」页签不显示教程链接", async () => {
    await switchTab("default")
    expect(host.querySelector('[data-testid="default-panel"]')).not.toBeNull()
    expect(tutorialLink()).toBeNull()
  })

  it("点击链接交给系统浏览器打开，不让应用内部跳转", async () => {
    const link = tutorialLink()!
    const event = new MouseEvent("click", { bubbles: true, cancelable: true })
    await act(async () => {
      link.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(openExternalUrl).toHaveBeenCalledTimes(1)
    expect(openExternalUrl).toHaveBeenCalledWith(MODEL_SETTINGS_TUTORIAL_URL)
  })

  it("教程链接不占用页签角色，仍在 tablist 之外", () => {
    const tablist = host.querySelector('[role="tablist"]')!
    expect(tablist.querySelector(`a[href="${MODEL_SETTINGS_TUTORIAL_URL}"]`)).toBeNull()
  })
})
