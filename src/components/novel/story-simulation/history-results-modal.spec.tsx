// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HistoryResultsModal } from "./history-results-modal"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  loadSimulationResults: vi.fn(async (_path: string, _frameworkId: string) => [] as unknown[]),
  deleteSimulationResult: vi.fn(async (_path: string, _id: string) => {}),
}))

vi.mock("@/lib/novel/story-simulation/framework-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/novel/story-simulation/framework-store")
  >("@/lib/novel/story-simulation/framework-store")
  return {
    ...actual,
    loadSimulationResults: (path: string, frameworkId: string) =>
      mocks.loadSimulationResults(path, frameworkId),
    deleteSimulationResult: (path: string, id: string) =>
      mocks.deleteSimulationResult(path, id),
  }
})

function trace(selectedCount: number) {
  return {
    id: `t${selectedCount}`,
    type: "round-plan" as const,
    nodeIndex: 0,
    nodeTitle: "开端",
    round: 0,
    candidateAgents: [],
    selectedAgents: Array.from({ length: selectedCount }, (_, i) => ({
      agentId: `a${i}`,
      name: `角色${i}`,
    })),
    blackboard: {
      allAgentCount: selectedCount,
      activeAgentCount: selectedCount,
      totalEventCount: 0,
      publicEventCount: 0,
      rumorCount: 0,
    },
    visibilityByAgent: [],
    rumors: [],
    activeAgents: new Map(),
    timestamp: "2026-07-06T00:00:00.000Z",
  }
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    status: "complete",
    debugTraces: [trace(5), trace(3)],
    draft: null,
    report: {
      frameworkId: "fw",
      mode: "hybrid",
      characterAnalyses: [
        { characterId: "a", name: "甲", behaviors: [], stateChanges: [], consistencyScore: 80 },
        { characterId: "b", name: "乙", behaviors: [], stateChanges: [], consistencyScore: 70 },
      ],
      branches: [
        { title: "一", summary: "", keyEvents: [], probability: "high", pros: "", cons: "", recommendation: true },
        { title: "二", summary: "", keyEvents: [], probability: "low", pros: "", cons: "", recommendation: false },
      ],
      recommendation: "推荐走决裂线",
      createdAt: "2026-07-06T00:00:00.000Z",
      ...overrides,
    },
  }
}

let container: HTMLDivElement
let root: Root

async function render(results: unknown[]) {
  mocks.loadSimulationResults.mockResolvedValue(results)
  await act(async () => {
    root.render(
      <HistoryResultsModal
        open
        projectPath="/project"
        frameworkId="fw"
        onSelectResult={() => {}}
        onClose={() => {}}
      />,
    )
  })
  await act(async () => {
    await Promise.resolve()
  })
}

/**
 * 历史结果列表此前只显示时间、摘要前 40 字和一个「草稿」标签 —— 用户无法在
 * 列表层面比较几次推演。P2-3 让它成为一等公民：把分支数、角色数、实际决策
 * 次数、导演均分一并显示出来。
 */
describe("HistoryResultsModal 结果指标", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.loadSimulationResults.mockReset()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("显示角色数、走向数与实际决策次数", async () => {
    await render([result()])

    expect(container.textContent).toContain("2 角色")
    expect(container.textContent).toContain("2 走向")
    // 5 + 3 = 8 次角色决策
    expect(container.textContent).toContain("8 次决策")
  })

  it("有导演评分时显示导演均分（接通 P0-1 后才有的数据）", async () => {
    await render([result({ directorAverageScore: 4.2, directorEvaluationCount: 2 })])

    expect(container.textContent).toContain("导演 4.2")
  })

  it("未启用导演时不显示导演分，而不是显示一个伪造的中性值", async () => {
    await render([result()])

    expect(container.textContent).not.toContain("导演 ")
  })

  it("已生成草稿时保留草稿标签", async () => {
    await render([
      {
        ...result(),
        draft: { branchId: "b", frameworkId: "fw", chapters: [], totalWords: 100, createdAt: "x" },
      },
    ])

    expect(container.textContent).toContain("草稿")
  })

  it("旧存档没有 debugTraces 时不显示决策次数（显示 0 次是误导）", async () => {
    const legacy = result()
    await render([{ ...legacy, debugTraces: undefined }])

    expect(container.textContent).not.toContain("次决策")
    // 但其它指标仍要正常显示
    expect(container.textContent).toContain("2 走向")
  })
})
