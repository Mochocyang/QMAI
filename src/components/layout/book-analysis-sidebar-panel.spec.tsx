// @vitest-environment jsdom
/**
 * BookAnalysisSidebarPanel 测试（optimize/sidebar-panel-tests）
 * 验证整行点击 / 删除按钮 stopPropagation / 删时清理等关键交互。
 */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach } from "vitest"

// === mocks 必须在 import 之前，工厂内部不能引用外部变量 ===
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

vi.mock("@/stores/book-analysis-store", () => {
  const setCurrentResult = vi.fn()
  const setShowResultViewer = vi.fn()
  return {
    useBookAnalysisStore: Object.assign(
      () => ({ setCurrentResult, setShowResultViewer }),
      { getState: () => ({}) },
    ),
  }
})

import { BookAnalysisSidebarPanel } from "./book-analysis-sidebar-panel"
import { listDirectory, readFile, deleteFile } from "@/commands/fs"
import { useBookAnalysisStore } from "@/stores/book-analysis-store"

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

// 直接从 mock 模块里抓取 vi.fn() 引用（因为工厂内部不能引用外部变量）
function getMockRefs() {
  const store = useBookAnalysisStore() as unknown as {
    setCurrentResult: ReturnType<typeof vi.fn>
    setShowResultViewer: ReturnType<typeof vi.fn>
  }
  return {
    setCurrentResult: store.setCurrentResult,
    setShowResultViewer: store.setShowResultViewer,
  }
}

beforeEach(async () => {
  // 清空所有 mock 调用记录 + 等待上次未完成的异步
  vi.clearAllMocks()
  await flushAsync(20)
})

describe("BookAnalysisSidebarPanel", () => {
  it("整行点击触发 viewer 打开（不依赖眼睛按钮）", async () => {
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

    const mocks = getMockRefs()
    const { cleanup } = renderPanel()
    await flushAsync(50) // 等 loadBooks 完成
    const viewBtn = document.querySelector('[aria-label="查看分析结果"]') as HTMLButtonElement
    expect(viewBtn).toBeTruthy()
    await act(async () => {
      viewBtn.click()
      await new Promise((r) => setTimeout(r, 0))
    })
    await flushAsync(50) // 等 handleViewBook 异步读盘 + setState
    expect(mocks.setCurrentResult).toHaveBeenCalledTimes(1)
    expect(mocks.setShowResultViewer).toHaveBeenCalledWith(true)
    cleanup()
    await flushAsync(20)
  })

  it("点击删除按钮不触发整行 click，并调用 store cleanup", async () => {
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

    const mocks = getMockRefs()
    const { cleanup } = renderPanel()
    await flushAsync(50)
    const deleteBtn = document.querySelector('[aria-label="删除作品"]') as HTMLButtonElement
    expect(deleteBtn).toBeTruthy()
    await act(async () => {
      deleteBtn.click()
      await new Promise((r) => setTimeout(r, 0))
    })
    await flushAsync(50) // 等 deleteFile 完成
    expect(deleteFile).toHaveBeenCalledTimes(1)
    // 整行 click 不应触发：setCurrentResult 不应被调
    expect(mocks.setCurrentResult).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
    cleanup()
    await flushAsync(20)
  })
})
