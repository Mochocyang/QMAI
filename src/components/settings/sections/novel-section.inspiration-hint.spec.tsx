// @vitest-environment jsdom
/**
 * 写作设置里两个**交互式**入口（丙-4b 的开关 / 丙-4c 的「重新查看教程」）。
 *
 * ── 为什么不能只做源码文本断言 ──
 * `writing-settings-effectiveness.spec.ts` 那一套是**源码文本**断言：
 * 它能证明字段名/文案出现在文件里，但证明不了「这块手写的 switch 真的接到了
 * `updateNovelConfig` 这条落盘路径上」，也证明不了「点「重新查看教程」真的
 * 会置上教程的一次性请求标记」——把 onClick 删掉、把 aria-pressed 写死成
 * true、把动作换成空函数，文本断言照样绿。
 *
 * 所以这里渲染**真实的** `NovelSection`，按 aria-label / 文案找到入口，
 * 真的点一下，再看 store 与落盘函数收到了什么。
 */
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import type { SettingsDraft } from "@/components/settings/settings-types"
import { DEFAULT_NOVEL_CONFIG, useWikiStore } from "@/stores/wiki-store"
import { useChatStore } from "@/stores/chat-store"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("react-i18next", () => ({
  // store 侧会 `import "@/i18n"`，那里要 `i18n.use(initReactI18next)`；
  // 只 mock useTranslation 会让整棵模块图在这一行炸掉（同 chat-panel-mount.ts）。
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}))

vi.mock("@/lib/project-store", () => ({
  saveNovelConfig: vi.fn(async () => {}),
  saveRevisionFeedbackWindowConfig: vi.fn(async () => {}),
  saveMaxHistoryMessages: vi.fn(async () => {}),
}))

import { saveNovelConfig } from "@/lib/project-store"
import { NovelSection } from "@/components/settings/sections/novel-section"

function makeDraft(): SettingsDraft {
  return {
    novelConfig: { ...DEFAULT_NOVEL_CONFIG },
    revisionFeedbackWindowConfig: {
      currentChapterIncludeShouldImprove: true,
      previousChapterCarryEnabled: true,
      lookbackChapterCount: 2,
      lookbackIncludeMustFixOnly: true,
    },
    maxHistoryMessages: 20,
  } as unknown as SettingsDraft
}

/**
 * 用**真实 `useState`** 驱动 `draft` 的夹具（照 `interface-section.spec.tsx:100-133`）。
 *
 * ⚠️ 这一点不是风格问题：早期版本把 `setDraft` 写成「在外部对象上原地赋值」，
 * React 完全不知情 ⇒ 组件不重渲染 ⇒ 点击之后读到的还是点击前的值。
 * 那时「关掉之后 `aria-pressed` 应变成 false」这条断言会**一直失败**，
 * 看起来像产品 bug，其实是夹具没把状态接上。同理，`aria-pressed` 写死成
 * 常量的变异在旧夹具下反而「全绿」—— 夹具不重渲染，就没有任何断言能看见差异。
 */
function NovelSectionHarness() {
  const [current, setCurrent] = useState<SettingsDraft>(() => makeDraft())
  return (
    <NovelSection
      draft={current}
      setDraft={(key, value) => setCurrent((prev) => ({ ...prev, [key]: value }))}
    />
  )
}

describe("写作设置：新章节灵感提示开关", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    useWikiStore.setState({ novelConfig: { ...DEFAULT_NOVEL_CONFIG } })
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    container.remove()
  })

  async function mount() {
    await act(async () => {
      root = createRoot(container)
      root.render(<NovelSectionHarness />)
    })
  }

  function inspirationToggle() {
    return container.querySelector<HTMLButtonElement>(
      'button[aria-label="novel.settings.inspirationHintEnabled"]',
    )
  }

  it("渲染出开关，且默认开启", async () => {
    await mount()
    const toggle = inspirationToggle()
    expect(toggle, "开关必须存在，且 aria-label 走 t(\"novel.settings.inspirationHintEnabled\")").not.toBeNull()
    expect(toggle?.getAttribute("aria-pressed")).toBe("true")
  })

  it("点一下会关掉它，并沿 updateNovelConfig 那条路径落盘", async () => {
    await mount()
    const toggle = inspirationToggle()
    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(useWikiStore.getState().novelConfig.inspirationHintEnabled).toBe(false)
    expect(saveNovelConfig as Mock).toHaveBeenCalledTimes(1)
    expect((saveNovelConfig as Mock).mock.calls[0][0]).toMatchObject({
      inspirationHintEnabled: false,
    })
    /*
     * ⚠️ `aria-pressed` 必须**跟着状态走**，不能写死。
     * 只断言「默认开启时是 true」的话，把 `aria-pressed` 写成常量 `true` 也能全绿
     * —— 开关关掉之后读屏软件仍然把它念成「已开启」。
     * 这条是变异测试逼出来的：先把它改成写死的 true，用例没红（SURVIVED），
     * 补上这条断言之后同一变异变成 KILLED。
     */
    expect(
      inspirationToggle()?.getAttribute("aria-pressed"),
      "关掉之后 aria-pressed 必须变成 false（写死 true 会让读屏软件一直念「已开启」）",
    ).toBe("false")
  })
})

/*
 * 丙-4c：设置里的「重新查看教程」。
 *
 * ⚠️ 这个入口落在 `novel`（写作设置）而**不是** `usage-guide`，
 * 但理由**不是**「设置里没有这一类」—— 丙-4 计划里那句话是错的，这里订正（修复批 F8）：
 *
 *   · `usage-guide` 是一个**活的** `CategoryId`（`settings-view.tsx:50`）；
 *   · 真有一个 `UsageGuideSection`（`:37` import、`:590-591` 渲染它）；
 *   · `i18n/zh.json` 里有一整块 `settings.sections.usageGuide.*`；
 *   · `app-layout.tsx:231` 甚至就调用 `setActiveSettingsCategory("usage-guide")`。
 *
 * 它此刻**不可达**，仅仅因为左侧导航的 `CATEGORIES`（`:70-80`）没有列出它，
 * 而 `:314` 用 `CATEGORIES.some(...)` 门控了那次跳转 —— 也就是
 * 「`setActiveSettingsCategory("usage-guide")` 会被静默丢弃」。
 * 把一个用户可见的入口挂到一个**只靠一条注释**保证不可达的分类上，
 * 是不必要的耦合；教程入口留在 `novel`（紧邻同类的「新章节灵感提示」
 * 「草稿章节提取记忆提示」）是**已经拍板接受**的取舍，
 * 所以这里只订正理由，**不要**顺手把 `usage-guide` 加回 `CATEGORIES`，
 * 也**不要**搬动这个入口。
 */
describe("写作设置：重新查看教程", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    useWikiStore.setState({
      novelConfig: { ...DEFAULT_NOVEL_CONFIG },
      chatExpanded: false,
      activeView: "settings",
    })
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  afterEach(async () => {
    await act(async () => { root?.unmount() })
    container.remove()
  })

  async function mount() {
    await act(async () => {
      root = createRoot(container)
      root.render(<NovelSectionHarness />)
    })
  }

  it("点一下会置上教程的一次性请求标记，并把写作助手面板与章节视图准备好", async () => {
    useChatStore.setState({ usageTutorialRequested: false })
    await mount()
    const entry = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((item) => item.textContent?.trim() === "novel.settings.reviewUsageTutorialAction")
    expect(entry, "写作设置里应有「重新查看教程」按钮").toBeDefined()
    await act(async () => {
      entry!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    /*
     * 教程弹窗挂在 ChatPanel 里，而 ChatPanel 只在 `activeView` 是
     * wiki/sources 且 `chatExpanded` 为真时才存在（ui-test-shell.tsx 的
     * `writing` / `assistantOpen`），所以这一步必须**同时**把面板与视图准备好，
     * 否则点了「重新查看教程」什么也不会发生。
     */
    expect(useChatStore.getState().usageTutorialRequested).toBe(true)
    expect(useWikiStore.getState().chatExpanded).toBe(true)
    expect(useWikiStore.getState().activeView).toBe("wiki")
  })

  it("即使这本书的教程已经自动弹过（Seen=true），也能重新查看", async () => {
    /*
     * 「Seen」回答「这本书自动弹过没有」，「一次性请求标记」回答「这一次该不该弹」。
     * 两者语义不同、互不覆盖 —— 本用例就是这条分工的证据：
     * Seen=true 时重新查看仍然置位请求标记。
     */
    useWikiStore.setState({
      novelConfig: { ...DEFAULT_NOVEL_CONFIG, usageTutorialSeen: true },
    })
    useChatStore.setState({ usageTutorialRequested: false })
    await mount()
    const entry = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((item) => item.textContent?.trim() === "novel.settings.reviewUsageTutorialAction")
    await act(async () => {
      entry!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(useChatStore.getState().usageTutorialRequested).toBe(true)
    expect(useWikiStore.getState().novelConfig.usageTutorialSeen).toBe(true)
  })
})
