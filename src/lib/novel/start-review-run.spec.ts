import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { startNovelReviewRun } from "./start-review-run"

const mocks = vi.hoisted(() => ({
  reviewChapter: vi.fn(),
  saveGenerationHistoryEntry: vi.fn(),
  persistRevisionFeedbackForChapter: vi.fn(),
  pickRevisionFeedbackFromReviewResults: vi.fn(() => []),
}))

vi.mock("./review-adapter", () => ({
  reviewChapter: mocks.reviewChapter,
}))

vi.mock("./generation-history", () => ({
  saveGenerationHistoryEntry: mocks.saveGenerationHistoryEntry,
}))

vi.mock("./revision-feedback", () => ({
  persistRevisionFeedbackForChapter: mocks.persistRevisionFeedbackForChapter,
  pickRevisionFeedbackFromReviewResults: mocks.pickRevisionFeedbackFromReviewResults,
}))

describe("startNovelReviewRun", () => {
  beforeEach(() => {
    useWikiStore.getState().setReviewRun(null)
    mocks.reviewChapter.mockReset()
    mocks.saveGenerationHistoryEntry.mockReset()
    mocks.persistRevisionFeedbackForChapter.mockReset()
    mocks.pickRevisionFeedbackFromReviewResults.mockReset()
    mocks.pickRevisionFeedbackFromReviewResults.mockReturnValue([])
  })

  it("stores staged review thinking while the review is running", async () => {
    mocks.reviewChapter.mockImplementation(async (
      _projectPath: string,
      _fileContent: string,
      _chapterNumber: number | undefined,
      callbacks: { onThinking?: (content: string) => void },
    ) => {
      callbacks.onThinking?.("## 阶段1：审查任务识别\n正在识别目标章节")
      const current = useWikiStore.getState().reviewRun
      expect(current?.running).toBe(true)
      expect(current?.thinking).toContain("阶段1：审查任务识别")
      return []
    })

    await startNovelReviewRun({
      fileContent: "---\nchapterNumber: 8\n---\n正文",
      projectPath: "E:/Novel",
      selectedFile: "E:/Novel/wiki/chapters/008.md",
      t: ((key: string) => key) as never,
    })

    expect(useWikiStore.getState().reviewRun?.thinking).toContain("阶段1：审查任务识别")
  })

  it("coalesces high-frequency review thinking updates before writing to the store", async () => {
    let thinkingUpdateCount = 0
    const unsubscribe = useWikiStore.subscribe((state, previousState) => {
      if (state.reviewRun?.thinking && state.reviewRun.thinking !== previousState.reviewRun?.thinking) {
        thinkingUpdateCount += 1
      }
    })

    mocks.reviewChapter.mockImplementation(async (
      _projectPath: string,
      _fileContent: string,
      _chapterNumber: number | undefined,
      callbacks: { onThinking?: (content: string) => void },
    ) => {
      callbacks.onThinking?.("## 阶段1：审查任务识别\n开始")
      for (let i = 0; i < 50; i += 1) {
        callbacks.onThinking?.(`## 阶段1：审查任务识别\n流式片段 ${i}`)
      }
      return []
    })

    try {
      await startNovelReviewRun({
        fileContent: "---\nchapterNumber: 8\n---\n正文",
        projectPath: "E:/Novel",
        selectedFile: "E:/Novel/wiki/chapters/008.md",
        t: ((key: string) => key) as never,
      })
    } finally {
      unsubscribe()
    }

    expect(thinkingUpdateCount).toBeLessThanOrEqual(3)
    expect(useWikiStore.getState().reviewRun?.thinking).toContain("流式片段 49")
  })
})
