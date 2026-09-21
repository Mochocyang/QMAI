import { describe, expect, it, vi } from "vitest"
import { createBookAnalysisPipelineStore } from "./book-analysis-pipeline-store"
import { saveAnalysisTask } from "@/lib/novel/book-analysis/analysis-pipeline-storage"
vi.mock("@/lib/novel/book-analysis/analysis-pipeline-storage", async (original) => ({
  ...await original<typeof import("@/lib/novel/book-analysis/analysis-pipeline-storage")>(),
  loadAndRecoverAnalysisTasks: async () => ({ tasks: [], chunks: [] }),
  saveAnalysisTask: vi.fn(async () => {}),
}))

describe("真实 store/scheduler 的识别账本联动", () => {
  it("两个新建任务尚未入队时，A的识别trace不能让B从任务列表消失", async () => {
    const store = createBookAnalysisPipelineStore()
    await store.getState().initializeProject("C:/ledger-fixture")
    const input = { bookId: "book-1", bookPath: "C:/ledger-fixture/book-analysis/book-1", selectedSkills: ["characters"] as const, forceNew: true }
    const a = await store.getState().createAwaitingRangeTask({ ...input, selectedSkills: [...input.selectedSkills] })
    const b = await store.getState().createAwaitingRangeTask({ ...input, selectedSkills: [...input.selectedSkills] })
    await store.getState().recordTaskRequestTrace(a!.id, {
      requestId: "recognition-a", provider: "openai", model: "test", apiMode: "chat_completions",
      startedAt: 1, finishedAt: 2, durationMs: 1, status: "success", inputTokens: 100,
    })
    expect(store.getState().tasks.map((task) => task.id)).toEqual([a!.id, b!.id])
    expect(store.getState().tasks.find((task) => task.id === b!.id)?.status).toBe("awaiting-range")
    expect(vi.mocked(saveAnalysisTask).mock.calls.some(([task]) => task.id === b!.id)).toBe(true)
    await store.getState().dispose()
  })
})
