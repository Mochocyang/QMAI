// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FrameworkBindingDialog } from "./framework-binding-dialog"
import {
  EMPTY_STORY_BEAT,
  convertPlotFrameworkToStoryFramework,
} from "@/lib/novel/story-simulation/plot-framework-bridge"
import type { PlotFramework } from "@/lib/novel/plot-framework"
import type { StoryFramework } from "@/lib/novel/story-simulation/types"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  saveBinding: vi.fn(async () => ({
    frameworkId: "plot-wb-story-book-1", frameworkTitle: "测试作品 · 故事机制",
    targetChapterCount: 10, chapterAllocation: [], boundAt: "2026-10-11T00:00:00.000Z",
  })),
  clearBinding: vi.fn(async () => {}),
  setBinding: vi.fn(),
  bumpBindingVersion: vi.fn(),
}))

vi.mock("@/lib/novel/story-simulation/framework-binding", () => ({
  saveBinding: mocks.saveBinding,
  clearBinding: mocks.clearBinding,
}))
vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: Object.assign((selector: (state: unknown) => unknown) => selector({
    project: { id: "p", name: "测试项目", path: "/project" },
    bumpBindingVersion: mocks.bumpBindingVersion,
  }), { getState: () => ({}) }),
}))
vi.mock("@/stores/story-simulation-store", () => ({
  useStorySimulationStore: Object.assign((selector: (state: unknown) => unknown) => selector({
    binding: null,
    setBinding: mocks.setBinding,
  }), { getState: () => ({}) }),
}))

function plotFramework(overrides: Partial<PlotFramework> = {}): PlotFramework {
  return {
    id: "wb-story-book-1", title: "测试作品 · 故事机制", line: "main",
    beats: { hook: "开局钩子", buildup: "铺垫", payoff: "爽点", endingHook: "结尾钩子" },
    rangeChapterIds: ["c1"], characters: [], foreshadowing: [], reusableTemplate: "",
    directionHints: "", handcraftHints: "", createdAt: 1700000000000, updatedAt: 1700000000000,
    ...overrides,
  }
}

function fallbackFramework(): StoryFramework {
  return convertPlotFrameworkToStoryFramework(plotFramework({
    beats: {
      hook: EMPTY_STORY_BEAT, buildup: EMPTY_STORY_BEAT,
      payoff: EMPTY_STORY_BEAT, endingHook: EMPTY_STORY_BEAT,
    },
  }))
}

describe("FrameworkBindingDialog：内容退化提示", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    // Base UI 的 Dialog 走 Portal（渲染到 body），所以断言查 body 而不是 host。
    document.body.innerHTML = ""
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    mocks.saveBinding.mockClear()
  })

  afterEach(() => {
    act(() => { root.unmount() })
    host.remove()
    document.body.innerHTML = ""
  })

  async function render(framework: StoryFramework): Promise<void> {
    await act(async () => {
      root.render(
        <FrameworkBindingDialog
          open
          onOpenChange={() => {}}
          framework={framework}
          onBound={() => {}}
        />,
      )
    })
  }

  function warning(): HTMLElement | null {
    return document.body.querySelector('[data-testid="framework-content-warning"]')
  }

  it("四个环节都是占位句时，在确认绑定之前提示用户内容等于空", async () => {
    await render(fallbackFramework())

    const element = warning()
    expect(element).not.toBeNull()
    expect(element!.getAttribute("role")).toBe("status")
    expect(element!.textContent).toContain("占位话")
    expect(element!.textContent).toContain("等于空")
    // 是提示不是拦截：绑定按钮仍然可用（结构合法的框架不该被禁止绑定）。
    expect(document.body.textContent).toContain("确认绑定")
    expect(
      [...document.body.querySelectorAll("button")].some((button) => button.textContent?.includes("确认绑定") && !button.disabled),
    ).toBe(true)
  })

  it("内容正常的故事框架不显示任何提示（正向对照）", async () => {
    await render(convertPlotFrameworkToStoryFramework(plotFramework()))

    expect(warning()).toBeNull()
    expect(document.body.textContent).toContain("测试作品 · 故事机制")
  })

  it("各节点内容相同但不是占位句时，用的是另一句提示", async () => {
    await render(convertPlotFrameworkToStoryFramework(plotFramework({
      beats: { hook: "同一句", buildup: "同一句", payoff: "同一句", endingHook: "同一句" },
    })))

    const element = warning()
    expect(element).not.toBeNull()
    expect(element!.textContent).toContain("同一句重复")
    expect(element!.textContent).not.toContain("占位话")
  })
})
