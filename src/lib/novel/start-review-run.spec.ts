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
})
