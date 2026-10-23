// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  fileExists: vi.fn(),
  writeFileAtomic: vi.fn(),
}))

vi.mock("@/lib/novel/outline-save-request", () => ({
  renderOutlineHtmlForPath: vi.fn(() => null),
}))

import { readFile, writeFileAtomic } from "@/commands/fs"
import {
  READER_AUTOSAVE_INTERVAL_MS,
  READER_DISK_POLL_MS,
  useReaderDocument,
  type UseReaderDocumentResult,
} from "@/hooks/use-reader-document"

const CHAPTER = "C:/书/wiki/chapters/第一卷/第1章 起点.md"
const ORIGINAL = "# 第1章 起点\n\n　　原来的正文"

const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFileAtomic)

/**
 * React 19 只在 `IS_REACT_ACT_ENVIRONMENT` 为真时才允许 `act()`；jsdom 里没有
 * 测试框架替我们设，否则每条断言都会刷一行 "not configured to support act"。
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function mountDocument(path = CHAPTER): { current: () => UseReaderDocumentResult } {
  let value: UseReaderDocumentResult | null = null
  function Probe() {
    value = useReaderDocument("chapter", path)
    return null
  }
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(createElement(Probe))
  })
  return {
    current: () => {
      if (!value) throw new Error("hook 还没渲染")
      return value
    },
  }
}

/** 让挂起的 promise 链跑完（载入、轮询、落盘都是异步的）。 */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mockWriteFile.mockResolvedValue(undefined)
  mockReadFile.mockResolvedValue(ORIGINAL)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  vi.useRealTimers()
})

describe("独立窗口的文档会话", () => {
  it("载入后是磁盘内容，且没有未保存标记", async () => {
    const doc = mountDocument()
    await settle()
    expect(doc.current().status).toBe("ready")
    expect(doc.current().liveMarkdown).toBe(ORIGINAL)
    expect(doc.current().dirty).toBe(false)
    expect(doc.current().heading).toBe("第1章 起点")
  })

  it("输入后标脏，保存写回规范化后的章节正文", async () => {
    const doc = mountDocument()
    await settle()

    act(() => doc.current().handleMarkdownChange("# 第1章 起点\n\n全新的正文"))
    expect(doc.current().dirty).toBe(true)

    // 冲突检测会再读一次盘；磁盘此时仍是原内容，不该被判成冲突。
    mockReadFile.mockResolvedValue(ORIGINAL)
    await act(async () => {
      await doc.current().flushNow()
    })

    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    const [writtenPath, written] = mockWriteFile.mock.calls[0]
    expect(writtenPath).toBe(CHAPTER)
    expect(written).toContain("全新的正文")
    expect(written).toContain("　　全新的正文")
    expect(doc.current().dirty).toBe(false)
    expect(doc.current().saveState).toBe("saved")
  })

  it("敲完又退回原样时不留待落盘内容", async () => {
    const doc = mountDocument()
    await settle()
    act(() => doc.current().handleMarkdownChange("# 第1章 起点\n\n改了"))
    act(() => doc.current().handleMarkdownChange(ORIGINAL))
    expect(doc.current().dirty).toBe(false)
    await act(async () => {
      await doc.current().flushNow()
    })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it("磁盘被别人改过且本地有修改时停止保存并进入冲突态", async () => {
    const doc = mountDocument()
    await settle()
    act(() => doc.current().handleMarkdownChange("# 第1章 起点\n\n我这边写的"))

    mockReadFile.mockResolvedValue("# 第1章 起点\n\n另一个窗口写的")
    let ok = true
    await act(async () => {
      ok = await doc.current().flushNow()
    })

    expect(ok).toBe(false)
    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(doc.current().conflict).not.toBeNull()
    expect(doc.current().saveState).toBe("conflict")
    // 用户的内容必须还在编辑器里
    expect(doc.current().liveMarkdown).toContain("我这边写的")
  })

  it("选「载入磁盘版本」后跟随磁盘，未保存内容被放弃", async () => {
    const doc = mountDocument()
    await settle()
    act(() => doc.current().handleMarkdownChange("# 第1章 起点\n\n我这边写的"))
    mockReadFile.mockResolvedValue("# 第1章 起点\n\n另一个窗口写的")
    await act(async () => {
      await doc.current().flushNow()
    })

    await act(async () => {
      await doc.current().resolveConflictLoadDisk()
    })
    expect(doc.current().conflict).toBeNull()
    expect(doc.current().liveMarkdown).toContain("另一个窗口写的")
    expect(doc.current().dirty).toBe(false)
  })

  it("选「用我的覆盖」后强行写盘", async () => {
    const doc = mountDocument()
    await settle()
    act(() => doc.current().handleMarkdownChange("# 第1章 起点\n\n我这边写的"))
    mockReadFile.mockResolvedValue("# 第1章 起点\n\n另一个窗口写的")
    await act(async () => {
      await doc.current().flushNow()
    })

    await act(async () => {
      await doc.current().resolveConflictKeepMine()
    })
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    expect(mockWriteFile.mock.calls[0][1]).toContain("我这边写的")
    expect(doc.current().dirty).toBe(false)
    expect(doc.current().saveState).toBe("saved")
  })

  it("本地没有修改时，轮询会静默跟随磁盘（另一个窗口刚存过）", async () => {
    const doc = mountDocument()
    await settle()
    mockReadFile.mockResolvedValue("# 第1章 起点\n\n主窗口刚写的")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(READER_DISK_POLL_MS)
    })

    expect(doc.current().liveMarkdown).toContain("主窗口刚写的")
    expect(doc.current().dirty).toBe(false)
    expect(doc.current().conflict).toBeNull()
  })

  it("本地有修改时轮询不覆盖，而是进冲突态", async () => {
    const doc = mountDocument()
    await settle()
    act(() => doc.current().handleMarkdownChange("# 第1章 起点\n\n我正在写"))
    mockReadFile.mockResolvedValue("# 第1章 起点\n\n主窗口刚写的")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(READER_DISK_POLL_MS)
    })

    expect(doc.current().liveMarkdown).toContain("我正在写")
    expect(doc.current().conflict).not.toBeNull()
  })

  it("周期定时器会把待落盘内容写掉", async () => {
    const doc = mountDocument()
    await settle()
    act(() => doc.current().handleMarkdownChange("# 第1章 起点\n\n等它自己存"))
    mockReadFile.mockResolvedValue(ORIGINAL)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(READER_AUTOSAVE_INTERVAL_MS)
    })

    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    expect(mockWriteFile.mock.calls[0][1]).toContain("等它自己存")
    expect(doc.current().dirty).toBe(false)
  })

  it("写盘失败时保留待落盘内容并报错", async () => {
    const doc = mountDocument()
    await settle()
    act(() => doc.current().handleMarkdownChange("# 第1章 起点\n\n写不进去"))
    mockReadFile.mockResolvedValue(ORIGINAL)
    mockWriteFile.mockRejectedValueOnce(new Error("磁盘只读"))

    let ok = true
    await act(async () => {
      ok = await doc.current().flushNow()
    })

    expect(ok).toBe(false)
    expect(doc.current().saveState).toBe("failed")
    expect(doc.current().saveError).toContain("磁盘只读")
    expect(doc.current().dirty).toBe(true)
    expect(doc.current().hasPendingChanges()).toBe(true)
  })

  it("文档读不出来时给出错误态而不是空白编辑器", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"))
    const doc = mountDocument()
    await settle()
    expect(doc.current().status).toBe("error")
    expect(doc.current().loadError).toContain("ENOENT")
  })
})
