// @vitest-environment jsdom

/*
 * 「一键提取」点了必须看得见反应。
 *
 * 用户报障：「一键提取功能无法使用」。复现出来的现象不是提取算错，而是
 * 点下确认后整段提取期间界面**一字不显示**（没有进度、没有转圈、没有
 * 「提取中」），图标也一直是静态的 —— 看上去就是点了没反应。
 *
 * 这份 spec 钉住三件事：
 *   1. 提取期间头部那枚图标必须换成会转的 Loader2；
 *   2. 提取期间面板必须显示进度文字与取消按钮；
 *   3. 模型没配好时要给一条能跳到设置项的提示，而不是静默失败。
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useImportProgressStore } from "@/stores/import-progress-store"
import { useWikiStore } from "@/stores/wiki-store"
import { UiTestDirectoryHeader } from "./ui-test-directory"
import { UiTestOutlineTools } from "./ui-test-outline-tools"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const bulkChapter = vi.hoisted(() => vi.fn())
const bulkOutline = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
const openDefaultModelSettings = vi.hoisted(() => vi.fn())
const notReady = vi.hoisted(() => class OutlineIngestNotReadyError extends Error {})

vi.mock("@/lib/novel/chapter-bulk-ingest", () => ({
  runBulkChapterIngest: bulkChapter,
  formatBulkChapterIngestResult: () => "章节提取结果",
  // 组件只用 type，运行时不需要
}))

vi.mock("@/lib/novel/outline-generation", () => ({
  runBulkOutlineIngest: bulkOutline,
  formatBulkOutlineIngestResult: () => "大纲提取结果",
  OutlineIngestNotReadyError: notReady,
  // 进度任务结算时 store 会动态 import 这个函数来对账，替换整个模块就必须补上
  reconcileStaleOutlineIngestTasks: vi.fn(),
}))

vi.mock("@/lib/toast", () => ({ toast: { error: toastError } }))
vi.mock("@/lib/open-settings", () => ({ openDefaultModelSettings }))

const PROJECT = "C:/proj"

describe("一键提取：提取期间必须看得见反应", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    bulkChapter.mockReset()
    bulkOutline.mockReset()
    toastError.mockReset()
    openDefaultModelSettings.mockReset()
    useImportProgressStore.setState({ tasks: [] })
    useWikiStore.setState({ project: { id: "p", name: "书", path: PROJECT } as never })
    host = document.createElement("div")
    host.className = "ui-test-root"
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    useImportProgressStore.setState({ tasks: [] })
  })

  function header() {
    return (
      <UiTestDirectoryHeader
        kind="outline"
        busy={false}
        onCreate={() => {}}
        onCreateContainer={() => {}}
        onImportFiles={() => {}}
        onImportFolder={() => {}}
        onOpenAssistant={() => {}}
        onClose={() => {}}
        onHelp={() => {}}
      />
    )
  }

  function extractIcon(kind: "chapter" | "outline") {
    const label = kind === "outline" ? "批量大纲提取" : "一键提取"
    return host.querySelector(`[aria-label="${label}"]`)
  }

  function clickText(text: string) {
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === text)
    expect(button, `找不到按钮：${text}`).toBeTruthy()
    return button!
  }

  /** 模拟 lib 的行为：真的开一条进度任务，然后挂着不结束。 */
  function startRunningTask(kind: "chapter" | "outline", total: number) {
    return useImportProgressStore.getState().startTask({
      projectPath: PROJECT,
      kind,
      total,
      currentTitle: "第一章",
      abortController: new AbortController(),
    })
  }

  it("空闲时图标是静态的，不提速也不假装在跑", async () => {
    await act(async () => root.render(header()))

    expect(extractIcon("outline")).not.toBeNull()
    expect(extractIcon("outline")!.querySelector(".animate-spin")).toBeNull()
    expect(extractIcon("outline")!.getAttribute("aria-busy")).toBeNull()
  })

  it("大纲提取进行中：图标换成会转的 Loader2 并标记 aria-busy", async () => {
    await act(async () => root.render(header()))
    expect(extractIcon("outline")!.querySelector(".animate-spin")).toBeNull()

    await act(async () => {
      startRunningTask("outline", 3)
    })

    expect(extractIcon("outline")!.querySelector(".animate-spin")).not.toBeNull()
    expect(extractIcon("outline")!.getAttribute("aria-busy")).toBe("true")
  })

  it("章节提取进行中：章节列表的「一键提取」图标同样会转（两种列表一致）", async () => {
    await act(async () => root.render(
      <UiTestDirectoryHeader
        kind="chapter"
        busy={false}
        onCreate={() => {}}
        onCreateContainer={() => {}}
        onImportFiles={() => {}}
        onImportFolder={() => {}}
        onOpenAssistant={() => {}}
        onClose={() => {}}
        onHelp={() => {}}
      />,
    ))
    expect(extractIcon("chapter")!.querySelector(".animate-spin")).toBeNull()

    await act(async () => {
      startRunningTask("chapter", 2)
    })

    expect(extractIcon("chapter")!.querySelector(".animate-spin")).not.toBeNull()
  })

  it("章节任务不会点亮大纲那枚图标（各管各的）", async () => {
    await act(async () => root.render(header()))

    await act(async () => {
      startRunningTask("chapter", 2)
    })

    expect(extractIcon("outline")!.querySelector(".animate-spin")).toBeNull()
  })

  it("点「提取全部」把 mode=all 传下去；「仅未提取」传 mode=pending", async () => {
    bulkOutline.mockResolvedValue({ total: 0, succeeded: 0, failed: 0, failures: [], emptyReason: "already_extracted" })
    await act(async () => root.render(<UiTestOutlineTools kind="outline" />))

    await act(async () => { clickText("仅未提取").click() })
    expect(bulkOutline).toHaveBeenCalledWith(PROJECT, { mode: "pending" })

    bulkOutline.mockClear()
    await act(async () => root.unmount())
    root = createRoot(host)
    await act(async () => root.render(<UiTestOutlineTools kind="outline" />))
    await act(async () => { clickText("提取全部").click() })
    expect(bulkOutline).toHaveBeenCalledWith(PROJECT, { mode: "all" })
  })

  it("章节面板走章节那套提取，不走大纲", async () => {
    bulkChapter.mockResolvedValue({ total: 0, succeeded: 0, failed: 0, cancelled: false, failures: [], emptyReason: "already_extracted" })
    await act(async () => root.render(<UiTestOutlineTools kind="chapter" />))

    await act(async () => { clickText("提取全部").click() })

    expect(bulkChapter).toHaveBeenCalledWith(PROJECT, { mode: "all" })
    expect(bulkOutline).not.toHaveBeenCalled()
  })

  it("提取一发起，面板就不允许是空白（旧实现整段提取期间一字不显示）", async () => {
    bulkOutline.mockImplementation(async () => {
      startRunningTask("outline", 4)
      return await new Promise(() => {})
    })
    await act(async () => root.render(<UiTestOutlineTools kind="outline" />))

    // 点确认框里那颗主操作按钮：旧版叫「确认」，新版叫「提取全部」。
    // 这里刻意不按文案找，好让这条断言只针对「有没有反馈」这件事。
    const dialog = host.querySelector('[role="dialog"]')!
    const buttons = [...dialog.querySelectorAll("button")]
    await act(async () => { buttons[buttons.length - 1].click() })

    const status = host.querySelector('[role="status"]')
    expect(status?.textContent?.trim(), "提取已经在跑了，面板却一片空白").toBeTruthy()
    /*
     * 只断言「非空」还不够：那句「正在启动…」的兜底文案本身就能让它通过，
     * 哪怕进度压根没接上。这里必须钉住只有真读到任务才可能出现的数字。
     */
    expect(status?.textContent).toContain("0/4")
  })

  it("提取结束后图标不再转，如实回到静止状态", async () => {
    await act(async () => root.render(header()))
    await act(async () => { startRunningTask("outline", 2) })
    expect(extractIcon("outline")!.querySelector(".animate-spin")).not.toBeNull()

    const task = useImportProgressStore.getState().tasks[0]
    await act(async () => {
      useImportProgressStore.getState().finishTask(task.id, "done", { completed: 2, total: 2 })
    })

    expect(extractIcon("outline")!.querySelector(".animate-spin")).toBeNull()
    expect(extractIcon("outline")!.getAttribute("aria-busy")).toBeNull()
  })

  it("章节面板跑起来时同样显示进度与取消（用户报的就是章节这条）", async () => {
    bulkChapter.mockImplementation(async () => {
      startRunningTask("chapter", 6)
      return await new Promise(() => {})
    })
    await act(async () => root.render(<UiTestOutlineTools kind="chapter" />))

    await act(async () => { clickText("提取全部").click() })

    expect(host.textContent).toContain("正在提取章节记忆 0/6")
    expect(host.querySelector(".ui-test-outline-running .animate-spin")).not.toBeNull()

    await act(async () => { clickText("取消").click() })
    expect(useImportProgressStore.getState().tasks[0]?.status).toBe("cancelled")
  })

  it("点取消之后不回退成「正在启动…」、取消按钮也不再可点（否则像又重来一遍）", async () => {
    bulkOutline.mockImplementation(async () => {
      startRunningTask("outline", 3)
      return await new Promise(() => {})
    })
    await act(async () => root.render(<UiTestOutlineTools kind="outline" />))
    await act(async () => { clickText("提取全部").click() })

    await act(async () => { clickText("取消").click() })

    expect(host.textContent).not.toContain("正在启动")
    expect((clickText("取消") as HTMLButtonElement).disabled).toBe(true)
  })

  it("提取进行中显示进度文字与取消按钮（这正是原先一片空白的地方）", async () => {
    bulkOutline.mockImplementation(async () => {
      startRunningTask("outline", 4)
      return await new Promise(() => {})
    })
    await act(async () => root.render(<UiTestOutlineTools kind="outline" />))

    await act(async () => { clickText("提取全部").click() })

    expect(host.textContent).toContain("正在提取大纲记忆 0/4")
    expect(host.querySelector(".ui-test-outline-running .animate-spin")).not.toBeNull()
    expect(clickText("取消")).toBeTruthy()
    // 确认框必须让位给进度，不能叠着
    expect(host.querySelector(".ui-test-outline-confirm")).toBeNull()
  })

  it("提取进行中点取消会把那条进度任务结算掉", async () => {
    bulkOutline.mockImplementation(async () => {
      startRunningTask("outline", 4)
      return await new Promise(() => {})
    })
    await act(async () => root.render(<UiTestOutlineTools kind="outline" />))
    await act(async () => { clickText("提取全部").click() })

    await act(async () => { clickText("取消").click() })

    expect(useImportProgressStore.getState().tasks[0]?.status).toBe("cancelled")
  })

  it("模型没配好时给一条能跳到设置项的提示，并同样把原因显示在面板里", async () => {
    bulkOutline.mockRejectedValue(new notReady("提取模型未配置"))
    await act(async () => root.render(<UiTestOutlineTools kind="outline" />))

    await act(async () => { clickText("提取全部").click() })

    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError.mock.calls[0][0]).toBe("提取模型未配置")
    expect(toastError.mock.calls[0][1]).toMatchObject({ onClick: openDefaultModelSettings })
    expect(host.textContent).toContain("提取模型未配置")
  })

  it("提取结束后把结果文案显示出来", async () => {
    bulkOutline.mockResolvedValue({ total: 0, succeeded: 0, failed: 0, failures: [], emptyReason: "already_extracted" })
    await act(async () => root.render(<UiTestOutlineTools kind="outline" />))

    await act(async () => { clickText("提取全部").click() })

    expect(host.textContent).toContain("大纲提取结果")
  })
})
