// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BookAnalysisInputDialog } from "./book-analysis-input-dialog"

const mocks = vi.hoisted(() => ({
  openDialog: vi.fn(),
  getFileSize: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mocks.openDialog,
}));

vi.mock("@/commands/fs", () => ({
  getFileSize: mocks.getFileSize,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function findButton(label: string) {
  const button = [...document.body.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!button) throw new Error(`未找到按钮：${label}`)
  return button as HTMLButtonElement
}

async function clickButton(label: string) {
  await act(async () => {
    findButton(label).dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
  })
}

function renderDialog(onSubmit = vi.fn(), onOpenChange = vi.fn()) {
  act(() => {
    root.render(
      <BookAnalysisInputDialog
        open
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
      />,
    )
  })
  return { onSubmit, onOpenChange }
}

describe("BookAnalysisInputDialog", () => {
  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    mocks.openDialog.mockReset()
    mocks.getFileSize.mockReset()
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.clearAllMocks()
  })

  it("以多选 TXT 对话框添加文件并显示名称、大小和完整路径", async () => {
    mocks.openDialog.mockResolvedValue([
      "C:\\小说\\第一本.txt",
      "D:\\资料\\第二本.txt",
    ])
    mocks.getFileSize
      .mockResolvedValueOnce(1536)
      .mockResolvedValueOnce(2 * 1024 * 1024)

    renderDialog()
    await clickButton("选择文件")

    expect(mocks.openDialog).toHaveBeenCalledWith({
      multiple: true,
      filters: [{ name: "文本文件", extensions: ["txt"] }],
    })
    expect(mocks.getFileSize).toHaveBeenNthCalledWith(1, "C:\\小说\\第一本.txt")
    expect(mocks.getFileSize).toHaveBeenNthCalledWith(2, "D:\\资料\\第二本.txt")
    expect(document.body.textContent).toContain("已选择 2 本小说")
    expect(document.body.textContent).toContain("第一本.txt")
    expect(document.body.textContent).toContain("1.5 KB")
    expect(document.body.textContent).toContain("C:\\小说\\第一本.txt")
    expect(document.body.textContent).toContain("第二本.txt")
    expect(document.body.textContent).toContain("2 MB")
    expect(document.body.textContent).toContain("D:\\资料\\第二本.txt")
    expect(findButton("继续添加")).toBeTruthy()
  })

  it("兼容单个字符串返回值，并在单项读取失败时保留其他成功文件", async () => {
    mocks.openDialog
      .mockResolvedValueOnce("C:\\小说\\单本.txt")
      .mockResolvedValueOnce([
        "D:\\小说\\成功.txt",
        "D:\\小说\\损坏.txt",
      ])
    mocks.getFileSize
      .mockResolvedValueOnce(1024)
      .mockResolvedValueOnce(2048)
      .mockRejectedValueOnce(new Error("read failed"))

    renderDialog()
    await clickButton("选择文件")
    await clickButton("继续添加")

    expect(document.body.textContent).toContain("已选择 2 本小说")
    expect(document.body.textContent).toContain("单本.txt")
    expect(document.body.textContent).toContain("成功.txt")
    expect(document.body.textContent).toContain("读取文件“损坏.txt”失败，已跳过该文件")
    expect(mocks.getFileSize).toHaveBeenCalledTimes(3)
  })

  it("支持移除单项，并在空列表时禁用开始导入", async () => {
    mocks.openDialog.mockResolvedValue("C:\\小说\\待移除.txt")
    mocks.getFileSize.mockResolvedValue(512)

    renderDialog()
    expect(findButton("开始导入").disabled).toBe(true)

    await clickButton("选择文件")
    expect(findButton("开始导入").disabled).toBe(false)

    await clickButton("移除")
    expect(document.body.textContent).toContain("已选择 0 本小说")
    expect(document.body.textContent).not.toContain("待移除.txt")
    expect(findButton("开始导入").disabled).toBe(true)
  })

  it("成功提交候选文件后清空列表，并由父级处理关闭", async () => {
    mocks.openDialog.mockResolvedValue("C:\\小说\\提交.txt")
    mocks.getFileSize.mockResolvedValue(4096)
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()

    renderDialog(onSubmit, onOpenChange)
    await clickButton("选择文件")
    await clickButton("开始导入")

    expect(onSubmit).toHaveBeenCalledWith([
      {
        sourcePath: "C:\\小说\\提交.txt",
        fileName: "提交.txt",
        fileSize: 4096,
      },
    ])
    expect(document.body.textContent).toContain("已选择 0 本小说")
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("限制弹窗高度并让确认列表在边界内滚动", () => {
    renderDialog()

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')
    const scrollList = [...document.body.querySelectorAll<HTMLElement>("div")].find(
      (element) => element.classList.contains("min-h-0") && element.classList.contains("overflow-y-auto"),
    )

    expect(dialog?.classList.contains("max-h-[85vh]")).toBe(true)
    expect(scrollList).toBeTruthy()
  })

  it("按规范化路径跳过同次选择和继续添加中的重复文件", async () => {
    mocks.openDialog
      .mockResolvedValueOnce([
        "C:\\Novel\\Book.txt",
        "c:/novel/book.TXT",
      ])
      .mockResolvedValueOnce("C:/NOVEL/BOOK.txt")
    mocks.getFileSize.mockResolvedValue(1024)
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    renderDialog(onSubmit)
    await clickButton("选择文件")

    expect(document.body.textContent).toContain("已选择 1 本小说")
    expect(document.body.textContent).toContain("重复文件")
    expect(mocks.getFileSize).toHaveBeenCalledTimes(1)

    await clickButton("继续添加")
    expect(document.body.textContent).toContain("已选择 1 本小说")
    expect(document.body.textContent).toContain("重复文件")
    expect(mocks.getFileSize).toHaveBeenCalledTimes(1)

    await clickButton("开始导入")
    expect(onSubmit).toHaveBeenCalledWith([
      {
        sourcePath: "C:\\Novel\\Book.txt",
        fileName: "Book.txt",
        fileSize: 1024,
      },
    ])
  })

  it("提交 pending 时同步阻止双击并禁用所有可变更和关闭按钮", async () => {
    let resolveSubmit!: () => void
    const pendingSubmit = new Promise<void>((resolve) => {
      resolveSubmit = resolve
    })
    const onSubmit = vi.fn(() => pendingSubmit)
    mocks.openDialog.mockResolvedValue("C:\\小说\\提交中.txt")
    mocks.getFileSize.mockResolvedValue(1024)

    renderDialog(onSubmit)
    await clickButton("选择文件")

    await act(async () => {
      const startButton = findButton("开始导入")
      startButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      startButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(findButton("正在导入…").disabled).toBe(true)
    expect(findButton("继续添加").disabled).toBe(true)
    expect(findButton("移除").disabled).toBe(true)
    expect(findButton("取消").disabled).toBe(true)

    await act(async () => {
      resolveSubmit()
      await pendingSubmit
    })
  })

  it("提交失败时保留列表并允许重试", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("submit failed"))
    mocks.openDialog.mockResolvedValue("C:\\小说\\重试.txt")
    mocks.getFileSize.mockResolvedValue(2048)

    renderDialog(onSubmit)
    await clickButton("选择文件")
    await clickButton("开始导入")

    expect(document.body.textContent).toContain("已选择 1 本小说")
    expect(document.body.textContent).toContain("重试.txt")
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("开始导入失败，请重试")
    expect(findButton("开始导入").disabled).toBe(false)
  })

  it("父级关闭会清理状态，且关闭后的异步选择结果不会写回重开的弹窗", async () => {
    let resolveSelection!: (paths: string[]) => void
    const pendingSelection = new Promise<string[]>((resolve) => {
      resolveSelection = resolve
    })
    mocks.openDialog
      .mockResolvedValueOnce("C:\\小说\\旧状态.txt")
      .mockReturnValueOnce(pendingSelection)
    mocks.getFileSize.mockResolvedValue(1024)
    const onSubmit = vi.fn()
    const onOpenChange = vi.fn()
    const renderWithOpen = (open: boolean) => {
      act(() => {
        root.render(
          <BookAnalysisInputDialog open={open} onOpenChange={onOpenChange} onSubmit={onSubmit} />,
        )
      })
    }

    renderWithOpen(true)
    await clickButton("选择文件")
    expect(document.body.textContent).toContain("旧状态.txt")

    await clickButton("继续添加")
    renderWithOpen(false)
    renderWithOpen(true)
    expect(document.body.textContent).toContain("已选择 0 本小说")
    expect(document.body.textContent).not.toContain("旧状态.txt")

    await act(async () => {
      resolveSelection(["C:\\小说\\异步回写.txt"])
      await pendingSelection
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("已选择 0 本小说")
    expect(document.body.textContent).not.toContain("异步回写.txt")
  })

  it("大量错误使用可滚动的告警区域，移除按钮包含文件名标签", async () => {
    mocks.openDialog
      .mockResolvedValueOnce("C:\\小说\\可移除.txt")
      .mockResolvedValueOnce(Array.from({ length: 20 }, (_, index) => `C:\\错误\\文件${index}.pdf`))
    mocks.getFileSize.mockResolvedValue(512)

    renderDialog()
    await clickButton("选择文件")
    expect(document.body.querySelector('button[aria-label="移除可移除.txt"]')).toBeTruthy()

    await clickButton("继续添加")
    const alert = document.body.querySelector<HTMLElement>('[role="alert"]')
    expect(alert).toBeTruthy()
    expect(alert?.classList.contains("max-h-32")).toBe(true)
    expect(alert?.classList.contains("overflow-y-auto")).toBe(true)
    expect(alert?.textContent).toContain("文件19.pdf")
  })

  it("读取文件大小 pending 时锁定选择和提交，完成后保留首批文件并恢复操作", async () => {
    let resolveFileSize!: (size: number) => void
    const pendingFileSize = new Promise<number>((resolve) => {
      resolveFileSize = resolve
    })
    mocks.openDialog
      .mockResolvedValueOnce("C:\\小说\\首批.txt")
      .mockResolvedValueOnce("C:\\小说\\读取中.txt")
    mocks.getFileSize
      .mockResolvedValueOnce(1024)
      .mockReturnValueOnce(pendingFileSize)
    const onSubmit = vi.fn()

    renderDialog(onSubmit)
    await clickButton("选择文件")

    let pendingSelection!: Promise<void>
    await act(async () => {
      findButton("继续添加").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })
    pendingSelection = pendingFileSize.then(async () => {
      await Promise.resolve()
    })

    expect(findButton("正在读取…").disabled).toBe(true)
    expect(findButton("开始导入").disabled).toBe(true)
    expect(findButton("移除").disabled).toBe(true)
    expect(findButton("取消").disabled).toBe(true)

    await act(async () => {
      findButton("正在读取…").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      findButton("开始导入").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })
    expect(mocks.openDialog).toHaveBeenCalledTimes(2)
    expect(onSubmit).not.toHaveBeenCalled()

    await act(async () => {
      resolveFileSize(2048)
      await pendingSelection
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("已选择 2 本小说")
    expect(document.body.textContent).toContain("首批.txt")
    expect(document.body.textContent).toContain("读取中.txt")
    expect(findButton("继续添加").disabled).toBe(false)
    expect(findButton("开始导入").disabled).toBe(false)
    expect(findButton("移除").disabled).toBe(false)
    expect(findButton("取消").disabled).toBe(false)
  })

  it("Windows 盘符和 UNC 路径忽略大小写，POSIX 路径保留大小写", async () => {
    mocks.openDialog.mockResolvedValue([
      "/Books/Novel.txt",
      "/books/novel.txt",
      "C:\\Novel\\Drive.txt",
      "c:/novel/drive.TXT",
      "\\\\Server\\Share\\Unc.txt",
      "\\\\server\\share\\unc.TXT",
    ])
    mocks.getFileSize.mockResolvedValue(1024)

    renderDialog()
    await clickButton("选择文件")

    expect(document.body.textContent).toContain("已选择 4 本小说")
    expect(document.body.textContent).toContain("/Books/Novel.txt")
    expect(document.body.textContent).toContain("/books/novel.txt")
    expect(mocks.getFileSize).toHaveBeenCalledTimes(4)
    expect(document.body.textContent).toContain("重复文件“drive.TXT”，已跳过")
    expect(document.body.textContent).toContain("重复文件“unc.TXT”，已跳过")
  })
})
