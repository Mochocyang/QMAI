import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "./wiki-store"
import type { BookAnalysisPipelineTask } from "@/lib/novel/book-analysis/analysis-pipeline-types"

vi.mock("@/lib/novel/book-analysis/analysis-pipeline-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/novel/book-analysis/analysis-pipeline-storage")>()
  return {
    ...actual,
    loadAndRecoverAnalysisTasks: vi.fn(async () => ({ tasks: [], chunks: [] })),
    saveAnalysisTask: vi.fn(async () => undefined),
    saveAnalysisChunk: vi.fn(async () => undefined),
    replaceAnalysisTaskChunks: vi.fn(async () => undefined),
  }
})

const schedulerOptions = vi.hoisted(() => ({ current: null as { llmConfig: unknown } | null }))

vi.mock("@/lib/novel/book-analysis/analysis-scheduler", () => ({
  createAnalysisScheduler: vi.fn((options: { llmConfig: unknown }) => {
    schedulerOptions.current = options
    return {
      initialize: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
      dispose: vi.fn(async () => undefined),
      enqueue: vi.fn(async () => undefined),
      pauseTask: vi.fn(async () => undefined),
      continueTask: vi.fn(async () => undefined),
      retryFailedChunk: vi.fn(async () => undefined),
      cancelTask: vi.fn(async () => undefined),
      getSnapshot: vi.fn(() => ({ tasks: [], chunks: [], progresses: {} })),
      whenIdle: vi.fn(async () => undefined),
    }
  }),
}))

vi.mock("@/lib/novel/book-analysis/analysis-engine", () => ({
  loadChapterList: vi.fn(async () => [
    { chapterId: "ch-0001", title: "第一章", order: 1, wordCount: 1000, selected: false, analyzed: false },
    { chapterId: "ch-0002", title: "第二章", order: 2, wordCount: 1000, selected: false, analyzed: false },
  ]),
  loadMetadata: vi.fn(async () => null),
}))

const usable = vi.hoisted(() => ({ value: true }))
vi.mock("@/lib/has-usable-llm", () => ({
  hasUsableLlm: vi.fn(() => usable.value),
}))

vi.mock("@/lib/novel/model-resolver", () => ({
  resolveDefaultModel: vi.fn((base: LlmConfig) => ({ ...base, model: "default-model", maxContextSize: 128_000 })),
  resolveModelConfig: vi.fn((modelKey: string, base: LlmConfig) => ({
    ...base,
    model: modelKey,
    maxContextSize: 32_000,
  })),
}))

async function makeStoreWithTask(projectPath: string, bookId: string) {
  const { createBookAnalysisPipelineStore } = await import("./book-analysis-pipeline-store")
  const store = createBookAnalysisPipelineStore()
  await store.getState().initializeProject(projectPath)
  const task = await store.getState().createAwaitingRangeTask({
    bookId,
    bookPath: `${projectPath}/book-analysis/${bookId}`,
    selectedSkills: ["style"],
    forceNew: true,
  })
  return { store, taskId: task!.id }
}

describe("book-analysis-pipeline-store 模型与文风深度", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usable.value = true
    schedulerOptions.current = null
  })

  it("configureTaskRange 把 modelKey 与 styleDepth 写到任务上", async () => {
    const { store, taskId } = await makeStoreWithTask("E:/Novel-depth", "book-1")

    await store.getState().configureTaskRange(taskId, { startOrder: 1, endOrder: 2 }, ["style"], {
      modelKey: "openai/gpt-4o-mini",
      styleDepth: "fast",
    })

    const updated = store.getState().tasks.find((item) => item.id === taskId)
    expect(updated?.modelKey).toBe("openai/gpt-4o-mini")
    expect(updated?.styleDepth).toBe("fast")
  })

  it("模型留空时不写 modelKey，后续按默认模型解析", async () => {
    const { store, taskId } = await makeStoreWithTask("E:/Novel-depth-empty", "book-2")

    await store.getState().configureTaskRange(taskId, { startOrder: 1, endOrder: 2 }, ["style"], {
      modelKey: "   ",
      styleDepth: "full",
    })

    const updated = store.getState().tasks.find((item) => item.id === taskId)
    expect(updated?.modelKey).toBeUndefined()
    expect(updated?.styleDepth).toBe("full")
  })

  it("重新配置范围但不传 options 时保留原有模型与深度", async () => {
    const { store, taskId } = await makeStoreWithTask("E:/Novel-depth-keep", "book-3")
    await store.getState().configureTaskRange(taskId, { startOrder: 1, endOrder: 2 }, ["style"], {
      modelKey: "openai/gpt-4o-mini",
      styleDepth: "fast",
    })

    await store.getState().configureTaskRange(taskId, { startOrder: 1, endOrder: 2 }, ["style"])

    const updated = store.getState().tasks.find((item) => item.id === taskId)
    expect(updated?.modelKey).toBe("openai/gpt-4o-mini")
    expect(updated?.styleDepth).toBe("fast")
  })

  it("分片规划按任务模型的上下文窗口计算", async () => {
    const { resolveModelConfig } = await import("@/lib/novel/model-resolver")
    const { store, taskId } = await makeStoreWithTask("E:/Novel-depth-plan", "book-4")

    await store.getState().configureTaskRange(taskId, { startOrder: 1, endOrder: 2 }, ["style"], {
      modelKey: "openai/gpt-4o-mini",
    })

    expect(resolveModelConfig).toHaveBeenCalledWith("openai/gpt-4o-mini", expect.anything(), expect.anything())
  })

  it("scheduler 的 llmConfig 按任务解析：选了模型走 resolveModelConfig，没选走默认", async () => {
    const { resolveDefaultModel, resolveModelConfig } = await import("@/lib/novel/model-resolver")
    await makeStoreWithTask("E:/Novel-depth-scheduler", "book-5")
    const resolve = schedulerOptions.current?.llmConfig as (task: Pick<BookAnalysisPipelineTask, "modelKey">) => LlmConfig

    expect(resolve({ modelKey: "openai/gpt-4o-mini" }).model).toBe("openai/gpt-4o-mini")
    expect(resolveModelConfig).toHaveBeenCalled()
    expect(resolve({ modelKey: undefined }).model).toBe("default-model")
    expect(resolveDefaultModel).toHaveBeenCalled()
  })

  it("所选模型不可用时启动任务报错并点名该模型", async () => {
    const { store, taskId } = await makeStoreWithTask("E:/Novel-depth-unusable", "book-6")
    await store.getState().configureTaskRange(taskId, { startOrder: 1, endOrder: 2 }, ["style"], {
      modelKey: "openai/broken-model",
    })
    usable.value = false

    await expect(store.getState().startTask(taskId)).rejects.toThrow(/openai\/broken-model/)
  })
})
