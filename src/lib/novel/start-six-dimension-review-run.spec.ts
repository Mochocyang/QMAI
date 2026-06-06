import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { startSixDimensionReviewRun } from "./start-six-dimension-review-run"
import type { DimensionReviewResult, SixReviewDimensionKey } from "./dimension-review-adapter"

const mocks = vi.hoisted(() => ({
  runSixDimensionReview: vi.fn(),
  saveGenerationHistoryEntry: vi.fn(),
}))

vi.mock("./dimension-review-adapter", () => ({
  runSixDimensionReview: mocks.runSixDimensionReview,
}))

vi.mock("./generation-history", () => ({
  saveGenerationHistoryEntry: mocks.saveGenerationHistoryEntry,
}))

function dimensionResult(dimensionKey: SixReviewDimensionKey): DimensionReviewResult {
  return {
    dimensionKey,
    score: 88,
    status: "pass",
    summary: `${dimensionKey} done`,
    thinking: `## ${dimensionKey}`,
    issues: [],
  }
}

describe("startSixDimensionReviewRun", () => {
  beforeEach(() => {
    useWikiStore.getState().setReviewRun(null)
    mocks.runSixDimensionReview.mockReset()
    mocks.saveGenerationHistoryEntry.mockReset()
  })

  it("stores dimension progress, thinking, results, and history while running", async () => {
    mocks.runSixDimensionReview.mockImplementation(async (args: {
      callbacks?: {
        onDimensionProgress?: (dimensionKey: string, progress: string) => void
        onDimensionThinking?: (dimensionKey: string, thinking: string) => void
        onDimensionResult?: (dimensionKey: string, result: DimensionReviewResult) => void
      }
    }) => {
      args.callbacks?.onDimensionProgress?.("thrill", "爽感密度：正在检查压抑与释放链")
      args.callbacks?.onDimensionThinking?.("thrill", "## 爽感密度\n正在分析")
      args.callbacks?.onDimensionResult?.("thrill", dimensionResult("thrill"))
      const current = useWikiStore.getState().reviewRun
      expect(current?.running).toBe(true)
      expect(current?.activeDimension).toBe("thrill")
      expect(current?.dimensionProgress).toContain("爽感密度")
      expect(current?.dimensionThinking?.thrill).toContain("正在分析")
      expect(current?.dimensionResults?.thrill?.score).toBe(88)
      return {
        thrill: dimensionResult("thrill"),
        pull: dimensionResult("pull"),
      }
    })

    await startSixDimensionReviewRun({
      fileContent: "---\nchapterNumber: 8\n---\n正文",
      projectPath: "E:/Novel",
      selectedFile: "E:/Novel/wiki/chapters/008.md",
      t: ((key: string) => key) as never,
    })

    const run = useWikiStore.getState().reviewRun
    expect(run?.running).toBe(false)
    expect(run?.dimensionResults?.thrill?.summary).toBe("thrill done")
    expect(run?.dimensionResults?.pull?.summary).toBe("pull done")
    expect(mocks.saveGenerationHistoryEntry).toHaveBeenCalledWith(
      "E:/Novel",
      expect.objectContaining({
        kind: "review",
        sourcePath: "E:/Novel/wiki/chapters/008.md",
        dimensionResults: expect.objectContaining({
          thrill: expect.objectContaining({ score: 88 }),
        }),
      }),
    )
  })

  it("reruns only the selected dimension and preserves existing dimension results", async () => {
    const oldPullResult = { ...dimensionResult("pull"), summary: "old pull result" }
    const newThrillResult = { ...dimensionResult("thrill"), summary: "new thrill result" }
    useWikiStore.getState().setReviewRun({
      runId: "previous-run",
      projectPath: "E:/Novel",
      filePath: "E:/Novel/wiki/chapters/008.md",
      running: false,
      results: [],
      dimensionResults: {
        pull: oldPullResult,
      },
    })
    mocks.runSixDimensionReview.mockResolvedValue({
      thrill: newThrillResult,
    })

    await startSixDimensionReviewRun({
      fileContent: "---\nchapterNumber: 8\n---\n正文",
      projectPath: "E:/Novel",
      selectedFile: "E:/Novel/wiki/chapters/008.md",
      t: ((key: string) => key) as never,
      dimensionKey: "thrill",
    })

    expect(mocks.runSixDimensionReview).toHaveBeenCalledWith(expect.objectContaining({
      dimensionKeys: ["thrill"],
    }))
    const run = useWikiStore.getState().reviewRun
    expect(run?.dimensionResults?.thrill?.summary).toBe("new thrill result")
    expect(run?.dimensionResults?.pull?.summary).toBe("old pull result")
    expect(mocks.saveGenerationHistoryEntry).toHaveBeenCalledWith(
      "E:/Novel",
      expect.objectContaining({
        dimensionResults: expect.objectContaining({
          thrill: expect.objectContaining({ summary: "new thrill result" }),
          pull: expect.objectContaining({ summary: "old pull result" }),
        }),
      }),
    )
  })

  it("coalesces high-frequency dimension thinking updates before writing to the store", async () => {
    let thinkingUpdateCount = 0
    const unsubscribe = useWikiStore.subscribe((state, previousState) => {
      const nextThinking = state.reviewRun?.dimensionThinking?.thrill
      const previousThinking = previousState.reviewRun?.dimensionThinking?.thrill
      if (nextThinking && nextThinking !== previousThinking) {
        thinkingUpdateCount += 1
      }
    })

    mocks.runSixDimensionReview.mockImplementation(async (args: {
      callbacks?: {
        onDimensionThinking?: (dimensionKey: string, thinking: string) => void
        onDimensionResult?: (dimensionKey: string, result: DimensionReviewResult) => void
      }
    }) => {
      args.callbacks?.onDimensionThinking?.("thrill", "## 爽感密度\n开始")
      for (let i = 0; i < 50; i += 1) {
        args.callbacks?.onDimensionThinking?.("thrill", `## 爽感密度\n流式片段 ${i}`)
      }
      args.callbacks?.onDimensionResult?.("thrill", dimensionResult("thrill"))
      return {
        thrill: dimensionResult("thrill"),
      }
    })

    try {
      await startSixDimensionReviewRun({
        fileContent: "---\nchapterNumber: 8\n---\n正文",
        projectPath: "E:/Novel",
        selectedFile: "E:/Novel/wiki/chapters/008.md",
        t: ((key: string) => key) as never,
      })
    } finally {
      unsubscribe()
    }

    expect(thinkingUpdateCount).toBeLessThanOrEqual(3)
    expect(useWikiStore.getState().reviewRun?.dimensionThinking?.thrill).toContain("流式片段 49")
  })
})
