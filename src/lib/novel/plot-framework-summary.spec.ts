import { describe, expect, it } from "vitest"
import { summarizePlotFrameworkLibrary } from "./plot-framework-summary"
import type { PlotFramework, PlotFrameworkLibrary } from "./plot-framework"

function makeFramework(overrides: Partial<PlotFramework> = {}): PlotFramework {
  return {
    id: "fw-1",
    title: "框架A",
    beats: { hook: "h", buildup: "b", payoff: "p", endingHook: "e" },
    rangeChapterIds: ["ch-1"],
    line: "main",
    characters: [{ name: "男主", role: "主角" }],
    foreshadowing: [],
    reusableTemplate: "模板",
    directionHints: "方向",
    handcraftHints: "发挥",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

describe("summarizePlotFrameworkLibrary", () => {
  it("空库返回零值统计", () => {
    const summary = summarizePlotFrameworkLibrary({ version: 1, frameworks: [] })
    expect(summary.total).toBe(0)
    expect(summary.mainCount).toBe(0)
    expect(summary.subCount).toBe(0)
    expect(summary.recentTitles).toEqual([])
  })

  it("统计主线/支线数量", () => {
    const library: PlotFrameworkLibrary = {
      version: 1,
      frameworks: [
        makeFramework({ id: "1", line: "main" }),
        makeFramework({ id: "2", line: "main" }),
        makeFramework({ id: "3", line: "sub" }),
      ],
    }
    const summary = summarizePlotFrameworkLibrary(library)
    expect(summary.total).toBe(3)
    expect(summary.mainCount).toBe(2)
    expect(summary.subCount).toBe(1)
  })

  it("统计节奏分布", () => {
    const library: PlotFrameworkLibrary = {
      version: 1,
      frameworks: [
        makeFramework({ id: "1", pacing: "tight" }),
        makeFramework({ id: "2", pacing: "tight" }),
        makeFramework({ id: "3", pacing: "standard" }),
        makeFramework({ id: "4", pacing: "loose" }),
        makeFramework({ id: "5" }),
      ],
    }
    const summary = summarizePlotFrameworkLibrary(library)
    expect(summary.tightCount).toBe(2)
    expect(summary.standardCount).toBe(1)
    expect(summary.looseCount).toBe(1)
    expect(summary.unratedCount).toBe(1)
  })

  it("最近更新的框架按 updatedAt 降序，最多5个", () => {
    const library: PlotFrameworkLibrary = {
      version: 1,
      frameworks: [
        makeFramework({ id: "1", title: "旧框架", updatedAt: 1000 }),
        makeFramework({ id: "2", title: "新框架", updatedAt: 3000 }),
        makeFramework({ id: "3", title: "中框架", updatedAt: 2000 }),
      ],
    }
    const summary = summarizePlotFrameworkLibrary(library)
    expect(summary.recentTitles).toHaveLength(3)
    expect(summary.recentTitles[0].title).toBe("新框架")
    expect(summary.recentTitles[1].title).toBe("中框架")
    expect(summary.recentTitles[2].title).toBe("旧框架")
  })
})
