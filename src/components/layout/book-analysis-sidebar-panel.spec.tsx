// @vitest-environment jsdom
/**
 * BookAnalysisSidebarPanel 测试
 * 验证整行点击选中作品 / 删除按钮 stopPropagation / 删时清理等关键交互。
 */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { BookAnalysisTask } from "@/lib/novel/book-analysis/types"

const mockSetSelectedLibraryBookId = vi.fn()
const mockDeletePublishedBook = vi.fn()
const mockWikiState = {
  project: { id: "p1", name: "Novel", path: "/proj" } as { id: string; name: string; path: string } | null,
  setActiveView: vi.fn(),
}
const mockBookAnalysisState = {
  setSelectedLibraryBookId: mockSetSelectedLibraryBookId,
  sidebarRefreshCounter: 0,
  triggerSidebarRefresh: vi.fn(),
  tasks: [] as BookAnalysisTask[],
  cancelTask: vi.fn(),
  requestReopenChapterSelection: vi.fn(),
}

// === mocks 必须在 import 之前 ===
vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
  deleteFile: vi.fn(),
}))

vi.mock("@/lib/novel/book-analysis/aura-cleanup", () => ({
  deleteOrphanAurasForBook: vi.fn().mockResolvedValue(0),
}))

vi.mock("@/lib/novel/character-aura", () => ({
  listCharacterAuras: vi.fn().mockResolvedValue([]),
}))

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: Object.assign(
    (selector: (state: any) => unknown) => selector(mockWikiState),
    { getState: () => mockWikiState },
  ),
}))

vi.mock("@/stores/book-analysis-store", () => ({
  useBookAnalysisStore: (selector?: (state: any) => unknown) =>
    selector ? selector(mockBookAnalysisState) : mockBookAnalysisState,
}))

const mockImportState = {
  deletePublishedBook: mockDeletePublishedBook,
  batches: [] as Array<{
    version: 1
    id: string
    projectPath: string
    taskIds: string[]
    panelDismissedAt?: number | null
    createdAt: number
    updatedAt: number
  }>,
  tasks: [] as Array<{
    version: 1
    id: string
    batchId: string
    projectPath: string
    originalPath: string
    originalFileName: string
    cachedSourcePath: string
    sourceSha256: string | null
    requestedTitle: string
    finalTitle: string | null
    bookId: string
    status: string
    completed: number
    total: number
    error: string | null
    skipReason: string | null
    createdAt: number
    startedAt: number | null
    completedAt: number | null
    updatedAt: number
  }>,
  createBatch: vi.fn(),
  continueTask: vi.fn(),
  regenerateTask: vi.fn(),
  cancelTask: vi.fn(),
  cancelAllQueued: vi.fn(),
  deleteFailedTask: vi.fn(),
  renameCompletedTask: vi.fn(),
  panelCollapsed: false,
  setPanelCollapsed: vi.fn(),
}

vi.mock("@/stores/book-analysis-import-store", () => ({
  useBookAnalysisImportStore: (selector: (state: any) => unknown) =>
    selector(mockImportState),
}))

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { BookAnalysisSidebarPanel } from "./book-analysis-sidebar-panel"
import { listDirectory, readFile, deleteFile } from "@/commands/fs"
import { toast } from "@/lib/toast"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function flushAsync(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
}

function renderPanel(): { cleanup: () => void } {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<BookAnalysisSidebarPanel />)
  })
  return {
    cleanup: () => {
      act(() => root.unmount())
      document.body.removeChild(container)
    },
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  mockWikiState.project = { id: "p1", name: "Novel", path: "/proj" }
  mockBookAnalysisState.tasks = []
  mockImportState.batches = []
  mockImportState.tasks = []
  mockImportState.panelCollapsed = false
  mockDeletePublishedBook.mockResolvedValue(undefined)
  await flushAsync(20)
})

describe("BookAnalysisSidebarPanel", () => {
  it("reopens character processing for a recognition-done running task", async () => {
    mockBookAnalysisState.tasks = [{
      id: "task-recognition-done",
      projectPath: "/proj",
      bookId: "book-1",
      config: { sourceType: "file", sourcePath: "/books/a.txt", selectedChapters: [] },
      progress: {
        stage: "extracting_characters",
        stageLabel: "识别完成",
        completed: 100,
        total: 100,
        percentage: 100,
        recognitionStatus: "done",
        recognizedCharactersCount: 3,
      },
      status: "running",
      startedAt: 0,
      updatedAt: 0,
      chapters: [],
      characters: [],
      skills: [],
    }]
    vi.mocked(listDirectory).mockResolvedValue([])

    const { cleanup } = renderPanel()
    await flushAsync(50)
    const processButton = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("处理")) as HTMLButtonElement | undefined
    expect(processButton).toBeTruthy()

    await act(async () => {
      processButton?.click()
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(mockBookAnalysisState.requestReopenChapterSelection).toHaveBeenCalledWith("task-recognition-done")
    cleanup()
    await flushAsync(20)
  })

  it("点击作品行触发 setSelectedLibraryBookId", async () => {
    vi.mocked(listDirectory).mockImplementation(async (dir) => {
      if (dir.endsWith("book-analysis")) {
        return [{
          name: "book-1",
          is_dir: true,
          path: "/proj/book-analysis/book-1",
        }]
      }
      return []
    })
    vi.mocked(readFile).mockImplementation(async (p) => {
      if (p.endsWith("metadata.json")) {
        return JSON.stringify({
          title: "测试书", author: "甲", totalChapters: 5, totalWords: 100,
          sourceType: "file", createdAt: 0, updatedAt: 0,
        })
      }
      return ""
    })

    const { cleanup } = renderPanel()
    await flushAsync(50)
    // 点击作品行（作品内容区域的 button，不是刷新按钮）
    const bookBtn = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("测试书")) as HTMLButtonElement
    expect(bookBtn).toBeTruthy()
    await act(async () => {
      bookBtn.click()
      await new Promise((r) => setTimeout(r, 0))
    })
    await flushAsync(50)
    expect(mockSetSelectedLibraryBookId).toHaveBeenCalledWith("book-1")
    cleanup()
    await flushAsync(20)
  })

  it("删除作品时调用统一清理动作并说明会清理查重记录", async () => {
    vi.mocked(listDirectory).mockImplementation(async (dir) => {
      if (dir.endsWith("book-analysis")) {
        return [{ name: "book-2", is_dir: true, path: "/proj/book-analysis/book-2" }]
      }
      return []
    })
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({
      title: "书2", totalChapters: 1, totalWords: 1,
      sourceType: "file", createdAt: 0, updatedAt: 0,
    }))

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    vi.mocked(deleteFile).mockResolvedValue(undefined)

    const { cleanup } = renderPanel()
    await flushAsync(50)
    const deleteBtn = document.querySelector('[aria-label="删除作品"]') as HTMLButtonElement
    expect(deleteBtn).toBeTruthy()
    await act(async () => {
      deleteBtn.click()
      await new Promise((r) => setTimeout(r, 0))
    })
    await flushAsync(50)
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("导入历史和内容查重记录"))
    expect(mockDeletePublishedBook).toHaveBeenCalledWith("book-2")
    expect(deleteFile).not.toHaveBeenCalled()
    // 整行 click 不应触发：setSelectedLibraryBookId 不应被调
    expect(mockSetSelectedLibraryBookId).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
    cleanup()
    await flushAsync(20)
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
  ])("删除失败（$name）时显示中文提示", async ({ error, expected }) => {
    vi.mocked(listDirectory).mockImplementation(async (dir) => {
      if (dir.endsWith("book-analysis")) {
        return [{ name: "book-2", is_dir: true, path: "/proj/book-analysis/book-2" }]
      }
      return []
    })
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({
      title: "书2", totalChapters: 1, totalWords: 1,
      sourceType: "file", createdAt: 0, updatedAt: 0,
    }))
    vi.spyOn(window, "confirm").mockReturnValue(true)
    mockDeletePublishedBook.mockRejectedValueOnce(error)

    const { cleanup } = renderPanel()
    await flushAsync(50)
    const deleteBtn = document.querySelector('[aria-label="删除作品"]') as HTMLButtonElement
    await act(async () => {
      deleteBtn.click()
      await new Promise((r) => setTimeout(r, 0))
    })
    await flushAsync(50)

    expect(toast.error).toHaveBeenCalledWith(expected)
    cleanup()
    await flushAsync(20)
  })

  it("删除等待期间切换项目时不使用旧结果刷新新项目界面", async () => {
    vi.mocked(listDirectory).mockImplementation(async (dir) => {
      if (dir.endsWith("book-analysis")) {
        return [{ name: "book-2", is_dir: true, path: "/proj/book-analysis/book-2" }]
      }
      return []
    })
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({
      title: "书2", totalChapters: 1, totalWords: 1,
      sourceType: "file", createdAt: 0, updatedAt: 0,
    }))
    vi.spyOn(window, "confirm").mockReturnValue(true)
    let finishDelete!: () => void
    mockDeletePublishedBook.mockReturnValueOnce(new Promise<void>((resolve) => {
      finishDelete = resolve
    }))

    const { cleanup } = renderPanel()
    await flushAsync(50)
    const deleteBtn = document.querySelector('[aria-label="删除作品"]') as HTMLButtonElement
    await act(async () => {
      deleteBtn.click()
      await Promise.resolve()
    })
    mockWikiState.project = { id: "p2", name: "Other", path: "/other" }
    finishDelete()
    await flushAsync(50)

    expect(mockBookAnalysisState.triggerSidebarRefresh).not.toHaveBeenCalled()
    expect(mockSetSelectedLibraryBookId).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    cleanup()
    await flushAsync(20)
  })
})
