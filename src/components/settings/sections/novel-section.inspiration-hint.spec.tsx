// @vitest-environment jsdom
/**
 * 写作设置里的**交互式**入口（丙-4b「新章节灵感提示」开关）。
 *
 * ── 为什么不能只做源码文本断言 ──
 * `writing-settings-effectiveness.spec.ts` 那一套是**源码文本**断言：
 * 它能证明字段名/文案出现在文件里，但证明不了「这块手写的 switch 真的接到了
 * `updateNovelConfig` 这条落盘路径上」——把 onClick 删掉、把 aria-pressed 写死成
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
