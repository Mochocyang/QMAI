// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SimulationReportView } from "./simulation-report-view"
import { useStorySimulationStore } from "@/stores/story-simulation-store"
import type {
  SimulationReport,
  StoryFramework,
} from "@/lib/novel/story-simulation/types"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: (selector: (state: unknown) => unknown) =>
    selector({ project: { id: "p", name: "测试项目", path: "/project" } }),
}))

vi.mock("@/lib/novel/story-simulation/report-export", () => ({
  exportReport: vi.fn(async () => "/project/report.md"),
}))

/**
 * 用真实 zustand store 替换，保证 setState 能触发重渲染 —— 本用例要验证的
 * 正是「报告页的下拉选择写回 store 后，界面与恢复路径用的是同一份状态」。
 */
vi.mock("@/stores/story-simulation-store", async () => {
  const { create } = await import("zustand")
  const store = create((set) => ({
    currentReport: null,
    currentFramework: null,
    timelineEvents: [],
    savedResults: [],
    selectedResultId: null,
    setSelectedResultId: (selectedResultId: string | null) =>
      set({ selectedResultId }),
    setError: () => {},
    setInfoMessage: () => {},
  }))
  return { useStorySimulationStore: store }
})

function makeFramework(): StoryFramework {
  return {
    id: "fw",
    title: "测试框架",
    premise: "测试",
    targetWords: 10000,
    simulationMode: "hybrid",
    sourceChapters: 1,
    createdAt: "2026-07-06T00:00:00.000Z",
    nodes: [],
  }
}

/** 历史结果：有角色分析、有分支 —— 也就是两个按钮本该出现的场景。 */
function makeHistoricalReport(): SimulationReport {
  return {
    frameworkId: "fw",
    mode: "hybrid",
    characterAnalyses: [
      {
        characterId: "a",
        name: "甲",
        behaviors: [],
        stateChanges: [],
        consistencyScore: 80,
      },
    ],
    branches: [
      {
        title: "分支一",
        summary: "摘要",
        keyEvents: [],
        probability: "high",
        pros: "优点",
        cons: "缺点",
        recommendation: true,
      },
    ],
    recommendation: "推荐分支一",
    createdAt: "2026-07-05T00:00:00.000Z",
  }
}

/** 当前（最新一次）报告：无角色、无分支，用来区分「看的是哪一份」。 */
function makeLiveReport(): SimulationReport {
  return {
    frameworkId: "fw",
    mode: "hybrid",
    characterAnalyses: [],
    branches: [],
    recommendation: "最新一次推演",
    createdAt: "2026-07-06T00:00:00.000Z",
  }
}

const store = useStorySimulationStore as unknown as {
  setState: (partial: Record<string, unknown>) => void
  getState: () => Record<string, unknown>
}

let container: HTMLDivElement
let root: Root

function render(overrides: {
  onInterviewAgent: (id: string, name: string) => void
  onGenerateDraft: (branch: unknown) => void
}) {
  act(() => {
    root.render(
      <SimulationReportView
        onResimulate={() => {}}
        onGenerateDraft={overrides.onGenerateDraft}
        onInterviewAgent={overrides.onInterviewAgent}
      />,
    )
  })
}

/** 在报告页的历史结果下拉里选中某条结果。 */
function selectHistoricalResult(resultId: string) {
  const select = container.querySelector("select")
  if (!select) throw new Error("报告页没有历史结果下拉框")
  act(() => {
    select.value = resultId
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

describe("SimulationReportView 历史结果的采访与草稿入口", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    store.setState({
      currentReport: makeLiveReport(),
      currentFramework: makeFramework(),
      timelineEvents: [],
      selectedResultId: null,
      savedResults: [
        {
          id: "hist-1",
          frameworkId: "fw",
          report: makeHistoricalReport(),
          timelineEvents: [],
          status: "complete",
          createdAt: "2026-07-05T00:00:00.000Z",
        },
      ],
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("查看历史结果时仍然提供「采访角色」与「生成草稿」入口", () => {
    render({ onInterviewAgent: vi.fn(), onGenerateDraft: vi.fn() })

    // 对照组：未选历史结果时显示的是最新那份报告（无角色、无分支），
    // 所以此时本就不该有这两个入口。
    expect(container.textContent).toContain("最新一次推演")
    expect(container.textContent).not.toContain("与 甲 对话")

    selectHistoricalResult("hist-1")

    // 切到历史结果后展示的是历史那份（带角色与分支），两个入口必须出现 ——
    // 旧实现在这里用 !currentResult 把它们摘掉了。
    expect(container.textContent).toContain("推荐分支一")
    expect(container.textContent).toContain("与 甲 对话")
    expect(container.textContent).toContain("生成草稿")
  })

  it("查看历史结果时点击采访入口能正常回调", () => {
    const onInterviewAgent = vi.fn()
    render({ onInterviewAgent, onGenerateDraft: vi.fn() })

    selectHistoricalResult("hist-1")

    const interviewButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("与 甲 对话"),
    )
    expect(interviewButton).toBeDefined()

    act(() => {
      interviewButton!.click()
    })

    expect(onInterviewAgent).toHaveBeenCalledWith("a", "甲")
  })

  it("选择历史结果时把选中项写回 store，供采访恢复快照使用", () => {
    render({ onInterviewAgent: vi.fn(), onGenerateDraft: vi.fn() })

    selectHistoricalResult("hist-1")

    // 恢复路径（story-simulation-view.tsx 的 handleSendChat）按 store 的
    // selectedResultId 找 agentSnapshot；两者必须是同一个值。
    expect(store.getState().selectedResultId).toBe("hist-1")
  })
})
