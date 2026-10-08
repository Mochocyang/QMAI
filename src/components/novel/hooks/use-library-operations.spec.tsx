// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BookAnalysisLibraryBook } from "@/lib/novel/book-analysis/library-state"
import type { LlmConfig, ProviderConfigs } from "@/stores/wiki-store"

const mocks = vi.hoisted(() => ({
  deletePublishedBook: vi.fn(),
  deleteFile: vi.fn(),
  deleteOrphanAurasForBook: vi.fn(),
  loadBookAnalysisLibraryState: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  currentProjectPath: "E:/项目甲" as string | null,
}))

vi.mock("@/stores/book-analysis-import-store", () => ({
  useBookAnalysisImportStore: (
    selector: (state: { deletePublishedBook: (bookId: string) => Promise<void> }) => unknown,
  ) => selector({ deletePublishedBook: mocks.deletePublishedBook }),
}))

vi.mock("@/stores/book-analysis-store", () => ({
  useBookAnalysisStore: { getState: () => ({}) },
}))

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: {
    getState: () => ({
      project: mocks.currentProjectPath
        ? { id: "project", name: "项目", path: mocks.currentProjectPath }
        : null,
      llmConfig: {},
      providerConfigs: [],
    }),
  },
}))

vi.mock("@/commands/fs", () => ({
  deleteFile: mocks.deleteFile,
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock("@/lib/novel/book-analysis/aura-cleanup", () => ({
  deleteOrphanAurasForBook: mocks.deleteOrphanAurasForBook,
}))

vi.mock("@/lib/novel/book-analysis/library-state", () => ({
  loadBookAnalysisLibraryState: mocks.loadBookAnalysisLibraryState,
}))

vi.mock("@/lib/novel/book-analysis/style-extraction-engine", () => ({ analyzeWritingStyle: vi.fn() }))
vi.mock("@/lib/novel/book-analysis/aura-adapter", () => ({ importBookAnalysisSkillsAsAuras: vi.fn() }))
vi.mock("@/lib/novel/character-aura", () => ({ bindCharacterAura: vi.fn(), listBindableNovelCharacters: vi.fn() }))
vi.mock("@/lib/novel/writing-style-store", () => ({ setEnabledWritingStyle: vi.fn(), upsertWritingStylePreset: vi.fn() }))
vi.mock("@/lib/project-refresh", () => ({ refreshProjectState: vi.fn() }))
vi.mock("@/lib/has-usable-llm", () => ({ hasUsableLlm: vi.fn(() => true) }))
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, info: vi.fn() },
}))

import { useLibraryOperations } from "./use-library-operations"

const libraryBook: BookAnalysisLibraryBook = {
  id: "book-1",
  path: "E:/项目甲/book-analysis/book-1",
  metadata: {
    title: "长夜",
    totalChapters: 2,
    totalWords: 3200,
    sourceType: "file" as const,
    createdAt: 1,
    updatedAt: 2,
  },
  recognizedCharacters: [],
  characters: [],
  skills: [],
  styleStatus: "missing" as const,
  boundAurasCount: 0,
  addedAuraCharacterIds: [],
  evidence: [],
}

/** 已配置可用模型的 LLM 配置，与 mock 的 hasUsableLlm 返回 true 保持一致。 */
const llmConfig: LlmConfig = {
  provider: "openai",
  apiKey: "sk-test-key",
  model: "gpt-4o",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "",
  maxContextSize: 204_800,
  reasoning: { mode: "auto" },
}

/** 未配置任何供应商覆盖项，与 store 默认值一致。 */
const providerConfigs: ProviderConfigs = {}

let host: HTMLDivElement
let root: Root
let operations: ReturnType<typeof useLibraryOperations> | null = null
const setLibraryState = vi.fn()
const setSelectedBookId = vi.fn()
const setSelectedCharacterId = vi.fn()

function Harness() {
  operations = useLibraryOperations({
    currentProjectPath: "E:/项目甲",
    selectedLibraryBook: libraryBook,
    libraryState: { books: [libraryBook], enabledStyle: null, bindings: [] },
    setLibraryState,
    setSelectedBookId,
    setSelectedCharacterId,
    selectedCharacterId: null,
    setChapterSelectionData: vi.fn(),
    llmConfig,
    providerConfigs,
    startTask: vi.fn(),
  })
  return null
}

beforeEach(async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  operations = null
  mocks.currentProjectPath = "E:/项目甲"
  mocks.deletePublishedBook.mockResolvedValue(undefined)
  mocks.deleteFile.mockResolvedValue(undefined)
  mocks.deleteOrphanAurasForBook.mockResolvedValue(0)
  mocks.loadBookAnalysisLibraryState.mockResolvedValue({ books: [], enabledStyle: null, bindings: [] })
  vi.spyOn(window, "confirm").mockReturnValue(true)
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<Harness />)
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

describe("useLibraryOperations 删除作品", () => {
  it("备用删除入口调用统一清理动作且不直接删除作品目录", async () => {
    await act(async () => {
      await operations!.handleLibraryDeleteBook("book-1", "book-1")
    })

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("导入历史和内容查重记录"))
    expect(mocks.deletePublishedBook).toHaveBeenCalledWith("book-1")
    expect(mocks.deleteFile).not.toHaveBeenCalled()
    expect(mocks.deleteOrphanAurasForBook).toHaveBeenCalledWith("E:/项目甲", "长夜")
    expect(setSelectedBookId).toHaveBeenCalledWith(null)
    expect(setSelectedCharacterId).toHaveBeenCalledWith(null)
  })

  it.each([
    {
      name: "活动导入任务",
      error: new Error("作品正在导入或重新生成，请先取消任务后再删除。"),
      expected: "作品正在导入或重新生成，请先取消任务后再删除。",
    },
    {
      name: "内部英文异常",
      error: new Error("Failed to delete directory"),
      expected: "删除作品失败，请稍后重试",
    },
  ])("统一清理动作拒绝删除（$name）时显示中文原因且不刷新作品库", async ({ error, expected }) => {
    mocks.deletePublishedBook.mockRejectedValueOnce(error)

    await act(async () => {
      await operations!.handleLibraryDeleteBook("book-1", "book-1")
    })

    expect(mocks.toastError).toHaveBeenCalledWith(expected)
    expect(mocks.loadBookAnalysisLibraryState).not.toHaveBeenCalled()
    expect(setSelectedBookId).not.toHaveBeenCalled()
  })

  it("删除等待期间切换项目时不把旧项目结果写入新界面", async () => {
    let finishDelete!: () => void
    mocks.deletePublishedBook.mockReturnValueOnce(new Promise<void>((resolve) => {
      finishDelete = resolve
    }))

    const deleting = operations!.handleLibraryDeleteBook("book-1", "book-1")
    await Promise.resolve()
    mocks.currentProjectPath = "F:/项目乙"
    finishDelete()
    await deleting

    expect(mocks.deleteOrphanAurasForBook).toHaveBeenCalledWith("E:/项目甲", "长夜")
    expect(setSelectedBookId).not.toHaveBeenCalled()
    expect(setSelectedCharacterId).not.toHaveBeenCalled()
    expect(mocks.loadBookAnalysisLibraryState).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })
})
