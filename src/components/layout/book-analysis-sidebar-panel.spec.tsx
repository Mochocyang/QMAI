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
  useWikiStore: (selector: (state: any) => unknown) =>
    selector({
      project: { id: "p1", name: "Novel", path: "/proj" },
      setActiveView: vi.fn(),
    }),
}))

vi.mock("@/stores/book-analysis-store", () => ({
  useBookAnalysisStore: (selector?: (state: any) => unknown) =>
    selector ? selector(mockBookAnalysisState) : mockBookAnalysisState,
}))

import { BookAnalysisSidebarPanel } from "./book-analysis-sidebar-panel"
import { listDirectory, readFile, deleteFile } from "@/commands/fs"

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
  mockBookAnalysisState.tasks = []
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
    const allButtons = document.querySelectorAll("button")
    // 第一个 button 是刷新按钮，第二个是作品内容区域
    const bookBtn = allButtons[1] as HTMLButtonElement
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

  it("点击删除按钮不触发整行 click，并调用 deleteFile", async () => {
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
    expect(deleteFile).toHaveBeenCalledTimes(1)
    // 整行 click 不应触发：setSelectedLibraryBookId 不应被调
    expect(mockSetSelectedLibraryBookId).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
    cleanup()
    await flushAsync(20)
  })
})
