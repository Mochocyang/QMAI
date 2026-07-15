import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  buildContextPackMock: vi.fn(),
  ingestOutlineMock: vi.fn(),
  syncSnapshotToMemoryMock: vi.fn(),
  finalizeProjectMemoryRebuildMock: vi.fn(),
  refreshProjectStateMock: vi.fn(),
  hasUsableLlmMock: vi.fn(() => true),
  outlineStore: {
    tasks: [] as Array<{ id: string; projectPath: string; outlinePath: string | null; status: string; message: string; error: string | null; updatedAt: number }>,
    createTask: vi.fn((input: { projectPath: string; outlinePath?: string | null }) => {
      const id = `outline-task-${mocks.outlineStore.tasks.length + 1}`
      mocks.outlineStore.tasks.unshift({
        id,
        projectPath: input.projectPath,
        outlinePath: input.outlinePath ?? null,
        status: "ingesting",
        message: "",
        error: null,
        updatedAt: Date.now(),
      })
      return id
    }),
    updateTask: vi.fn((taskId: string, patch: Record<string, unknown>) => {
      const task = mocks.outlineStore.tasks.find((item) => item.id === taskId)
      if (task) Object.assign(task, patch)
    }),
  },
  importProgressStore: {
    tasks: [] as Array<{ id: string; abortController?: AbortController }>,
    startTask: vi.fn((input: { abortController?: AbortController }) => {
      const id = `import-progress-${mocks.importProgressStore.tasks.length + 1}`
      mocks.importProgressStore.tasks.unshift({ id, abortController: input.abortController })
      return id
    }),
    updateTask: vi.fn(),
    finishTask: vi.fn(),
  },
}))

vi.mock("./context-engine", async () => {
  const actual = await vi.importActual<typeof import("./context-engine")>("./context-engine")
  return {
    ...actual,
    buildContextPack: mocks.buildContextPackMock,
  }
})

vi.mock("./chapter-ingest", () => ({
  ingestOutline: mocks.ingestOutlineMock,
  syncSnapshotToMemory: mocks.syncSnapshotToMemoryMock,
  finalizeProjectMemoryRebuild: mocks.finalizeProjectMemoryRebuildMock,
}))

vi.mock("@/lib/project-refresh", () => ({
  refreshProjectState: mocks.refreshProjectStateMock,
}))

vi.mock("@/lib/has-usable-llm", () => ({
  hasUsableLlm: mocks.hasUsableLlmMock,
}))

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: {
    getState: () => ({
      llmConfig: { provider: "custom", model: "test" },
      novelConfig: { extractModel: "test-model" },
      providerConfigs: {},
    }),
  },
}))

vi.mock("@/stores/outline-generation-store", () => ({
  useOutlineGenerationStore: {
    getState: () => mocks.outlineStore,
  },
}))

vi.mock("@/stores/import-progress-store", () => ({
  useImportProgressStore: {
    getState: () => mocks.importProgressStore,
  },
}))

import {
  assertOutlineIngestLlmReady,
  buildOutlineGenerationPrompt,
  buildOutlineRefinementContext,
  formatBulkOutlineIngestResult,
  OutlineIngestNotReadyError,
  runOutlineIngestPaths,
} from "./outline-generation"

describe("outline-generation context fallback", () => {
  beforeEach(() => {
    mocks.buildContextPackMock.mockReset()
    mocks.ingestOutlineMock.mockReset()
    mocks.syncSnapshotToMemoryMock.mockReset()
    mocks.finalizeProjectMemoryRebuildMock.mockReset()
    mocks.refreshProjectStateMock.mockReset()
    mocks.hasUsableLlmMock.mockReset()
    mocks.hasUsableLlmMock.mockReturnValue(true)
    mocks.outlineStore.tasks = []
    mocks.importProgressStore.tasks = []
    mocks.importProgressStore.startTask.mockClear()
    mocks.importProgressStore.updateTask.mockClear()
    mocks.importProgressStore.finishTask.mockClear()
    mocks.syncSnapshotToMemoryMock.mockResolvedValue({
      writtenEntityPaths: [],
      memoryPagePaths: [],
      memorySyncedAt: "2026-01-01T00:00:00.000Z",
    })
    mocks.finalizeProjectMemoryRebuildMock.mockResolvedValue(undefined)
    mocks.refreshProjectStateMock.mockResolvedValue(undefined)
  })

  it("still builds a generation prompt when context loading fails", async () => {
    mocks.buildContextPackMock.mockRejectedValueOnce(new Error("context failed"))

    const prompt = await buildOutlineGenerationPrompt("E:/Novel", "通用", "短篇", "测试")

    expect(prompt).toContain("测试")
    expect(prompt).toContain("请根据以上信息，设计一个完整、有吸引力的小说大纲")
  })

  it("returns an empty refinement context when context loading fails", async () => {
    mocks.buildContextPackMock.mockRejectedValueOnce(new Error("context failed"))

    const result = await buildOutlineRefinementContext("E:/Novel", "测试")

    expect(result).toEqual({
      context: "",
      hasOutline: false,
    })
  })
})

describe("bulk outline ingest", () => {
  beforeEach(() => {
    mocks.buildContextPackMock.mockReset()
    mocks.ingestOutlineMock.mockReset()
    mocks.syncSnapshotToMemoryMock.mockReset()
    mocks.finalizeProjectMemoryRebuildMock.mockReset()
    mocks.refreshProjectStateMock.mockReset()
    mocks.hasUsableLlmMock.mockReset()
    mocks.hasUsableLlmMock.mockReturnValue(true)
    mocks.outlineStore.tasks = []
    mocks.importProgressStore.tasks = []
    mocks.importProgressStore.startTask.mockClear()
    mocks.importProgressStore.updateTask.mockClear()
    mocks.importProgressStore.finishTask.mockClear()
    mocks.syncSnapshotToMemoryMock.mockResolvedValue({
      writtenEntityPaths: [],
      memoryPagePaths: [],
      memorySyncedAt: "2026-01-01T00:00:00.000Z",
    })
    mocks.finalizeProjectMemoryRebuildMock.mockResolvedValue(undefined)
    mocks.refreshProjectStateMock.mockResolvedValue(undefined)
  })

  it("throws when extract model is unavailable", () => {
    mocks.hasUsableLlmMock.mockReturnValue(false)
    expect(() => assertOutlineIngestLlmReady()).toThrow(OutlineIngestNotReadyError)
  })

  it("defers memory rebuild until all outlines sync", async () => {
    mocks.ingestOutlineMock
      .mockResolvedValueOnce({
        snapshot: { chapterId: "outline-a", chapterNumber: -1 },
        truncated: false,
        originalLength: 100,
        bodyLength: 100,
        bodyBudget: 1000,
        failureReason: null,
      })
      .mockResolvedValueOnce({
        snapshot: { chapterId: "outline-b", chapterNumber: -2 },
        truncated: false,
        originalLength: 100,
        bodyLength: 100,
        bodyBudget: 1000,
        failureReason: null,
      })

    const result = await runOutlineIngestPaths("E:/Novel", [
      "E:/Novel/wiki/outlines/a.md",
      "E:/Novel/wiki/outlines/b.md",
    ])

    expect(result).toMatchObject({ total: 2, succeeded: 2, failed: 0 })
    expect(mocks.syncSnapshotToMemoryMock).toHaveBeenCalledTimes(2)
    expect(mocks.syncSnapshotToMemoryMock.mock.calls[0]?.[2]).toEqual({
      deferStructuredMemoryExport: true,
      deferDerivedRebuild: true,
    })
    expect(mocks.finalizeProjectMemoryRebuildMock).toHaveBeenCalledTimes(1)
    expect(mocks.refreshProjectStateMock).toHaveBeenCalledTimes(1)
  })

  it("collects per-file failures", async () => {
    mocks.ingestOutlineMock
      .mockResolvedValueOnce({
        snapshot: { chapterId: "outline-a", chapterNumber: -1 },
        truncated: false,
        originalLength: 100,
        bodyLength: 100,
        bodyBudget: 1000,
        failureReason: null,
      })
      .mockRejectedValueOnce(new Error("JSON 解析失败"))

    const result = await runOutlineIngestPaths("E:/Novel", [
      "E:/Novel/wiki/outlines/a.md",
      "E:/Novel/wiki/outlines/b.md",
    ])

    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.name).toBe("b")
    expect(result.failures[0]?.reason).toContain("JSON 解析失败")
  })

  it("formats failure details for the banner", () => {
    const message = formatBulkOutlineIngestResult({
      total: 2,
      succeeded: 1,
      failed: 1,
      failures: [{ name: "b", path: "E:/Novel/wiki/outlines/b.md", reason: "JSON 解析失败" }],
    })

    expect(message).toContain("失败")
    expect(message).toContain("b")
    expect(message).toContain("JSON 解析失败")
  })
})
