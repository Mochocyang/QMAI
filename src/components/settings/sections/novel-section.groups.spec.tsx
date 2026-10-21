// @vitest-environment jsdom
/**
 * 写作设置的重构验收：
 *   · 按功能分组（提示类单独一组），默认展开、可折叠；
 *   · 新手引导只剩一颗「播放」按钮，没有开关，也没有「从哪里开始」的阶段重播列表。
 *
 * 为什么渲染真实组件而不是源码文本断言：分组是**结构**，播放是**行为**。
 * 文本断言能证明字符串存在，却证明不了「点播放真的把引导启动并通知外壳退回书架」。
 */
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SettingsDraft } from "@/components/settings/settings-types"
import { DEFAULT_NOVEL_CONFIG, useWikiStore } from "@/stores/wiki-store"
import {
  GUIDE_STORAGE_KEY,
  readGuideSnapshot,
  useGuideStore,
  writeGuideSnapshot,
} from "@/lib/guide/guide-store"
import { GUIDE_RESTART_EVENT } from "@/lib/guide/guide-events"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("react-i18next", () => ({
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

vi.mock("@/lib/novel/de-ai-batch/chapter-concurrency", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/novel/de-ai-batch/chapter-concurrency")>(),
  notifyDeAiChapterConcurrencyChanged: vi.fn(),
}))

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

function Harness() {
  const [draft, setDraft] = useState<SettingsDraft>(() => makeDraft())
  return <NovelSection draft={draft} setDraft={(key, value) => setDraft((prev) => ({ ...prev, [key]: value }))} />
}

describe("写作设置：分组与新手引导播放", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.removeItem(GUIDE_STORAGE_KEY)
    useWikiStore.setState({ novelConfig: { ...DEFAULT_NOVEL_CONFIG }, project: null })
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    container.remove()
    localStorage.removeItem(GUIDE_STORAGE_KEY)
  })

  function seedGuide(status: "new" | "running" | "done" | "off") {
    // 组件挂载时会 hydrate()，所以持久化快照必须与内存状态一致，否则会被读回覆盖。
    writeGuideSnapshot({ status, stepIndex: 0, skippedChapters: [] })
    useGuideStore.setState({ status, stepIndex: 0, skippedChapters: [], hydrated: true, finishedAt: undefined })
  }

  async function mount() {
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness />)
    })
  }

  const groupIds = () => [...container.querySelectorAll<HTMLDetailsElement>("details[data-novel-group]")]
    .map((node) => node.dataset.novelGroup)

  function group(id: string) {
    return container.querySelector<HTMLDetailsElement>(`details[data-novel-group="${id}"]`)!
  }

  function toggleIn(scope: Element, label: string) {
    return scope.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  }

  const guideSwitch = () => container.querySelector<HTMLButtonElement>('button[aria-label="新手引导"][aria-pressed]')
  const playButton = () => [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => item.getAttribute("aria-label") === "播放新手引导")

  it("按功能分成六组，默认展开，提示类单独成组", async () => {
    await mount()
    expect(groupIds()).toEqual(["context", "generation", "hints", "community", "performance", "feedback"])
    for (const id of ["context", "generation", "hints", "community", "performance", "feedback"]) {
      expect(group(id).open, `${id} 默认展开`).toBe(true)
    }
    // 「界面提示」组只有两个提示开关，不掺生成类参数。
    expect(group("hints").querySelectorAll("button[aria-pressed]")).toHaveLength(2)
    expect(group("context").querySelectorAll("button[aria-pressed]")).toHaveLength(0)
    expect(toggleIn(group("hints"), "novel.settings.draftMemoryHintEnabled")).not.toBeNull()
    expect(toggleIn(group("hints"), "novel.settings.inspirationHintEnabled")).not.toBeNull()
  })

  it("分组折叠后仍只保留一组「写作设置」标题，不再有「其他写作设置」小字", async () => {
    await mount()
    expect(container.textContent).toContain("写作设置")
    expect(container.textContent).not.toContain("其他写作设置")
    await act(async () => {
      group("hints").open = false
      group("hints").dispatchEvent(new Event("toggle"))
    })
    expect(group("hints").open).toBe(false)
  })

  it("新手引导只有一个「播放」，没有开关也没有「从哪里开始」的列表", async () => {
    seedGuide("done")
    await mount()
    expect(guideSwitch()).toBeNull()
    expect(playButton()?.textContent).toContain("播放")
    expect(container.textContent).not.toContain("从这一步开始")
    expect(container.textContent).not.toContain("重新开始完整引导")
    expect(container.textContent).not.toContain("按阶段重播")
  })

  it.each(["new", "running", "done", "off"] as const)(
    "引导状态为 %s 时播放按钮都在（不靠状态开关显隐）",
    async (status) => {
      seedGuide(status)
      await mount()
      expect(playButton()).toBeDefined()
      expect(guideSwitch()).toBeNull()
    },
  )

  it("点播放会立刻启动引导，并通知外壳退回书架", async () => {
    seedGuide("off")
    await mount()
    const restart = vi.fn()
    window.addEventListener(GUIDE_RESTART_EVENT, restart)
    try {
      await act(async () => {
        playButton()?.click()
      })
      expect(useGuideStore.getState().status).toBe("running")
      expect(useGuideStore.getState().stepIndex).toBe(0)
      expect(restart).toHaveBeenCalledTimes(1)
      expect(readGuideSnapshot().status).toBe("running")
    } finally {
      window.removeEventListener(GUIDE_RESTART_EVENT, restart)
    }
  })
})
