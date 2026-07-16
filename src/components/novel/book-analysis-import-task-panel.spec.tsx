// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BatchImportBatch, BatchImportTask, BatchImportTaskStatus } from "@/lib/novel/book-analysis/batch-import-types"
import { BookAnalysisImportTaskPanel } from "./book-analysis-import-task-panel"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const batch: BatchImportBatch = {
  version: 1,
  id: "batch-1",
  projectPath: "E:/Novel",
  taskIds: [],
  createdAt: 1,
  updatedAt: 1,
}

function createTask(status: BatchImportTaskStatus, id = `task-${status}`): BatchImportTask {
  return {
    version: 1,
    id,
    batchId: batch.id,
    projectPath: "E:/Novel",
    originalPath: `E:/Sources/${id}.txt`,
    originalFileName: `${id}.txt`,
    cachedSourcePath: `E:/Cache/${id}.txt`,
    sourceSha256: "hash",
    requestedTitle: `作品-${id}`,
    finalTitle: status === "completed" ? `完成-${id}` : null,
    bookId: `book-${id}`,
    status,
    completed: status === "splitting" ? 3 : 0,
    total: status === "splitting" ? 10 : 0,
    error: status === "failed" ? "导入失败" : null,
    skipReason: status === "skipped" ? "作品已存在" : null,
    createdAt: 1,
    startedAt: status === "queued" ? null : 2,
    completedAt: ["completed", "failed", "cancelled", "skipped"].includes(status) ? 3 : null,
    updatedAt: 3,
  }
}

const callbacks = () => ({
  onCollapsedChange: vi.fn(),
  onContinue: vi.fn(),
  onRegenerate: vi.fn(),
  onCancel: vi.fn(),
  onCancelAllQueued: vi.fn(),
  onDeleteFailed: vi.fn(),
  onRenameCompleted: vi.fn(),
  onOpenBook: vi.fn(),
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

function renderPanel(tasks: BatchImportTask[], props = callbacks(), collapsed = false) {
  act(() => {
    root.render(
      <BookAnalysisImportTaskPanel
        batches={[{ ...batch, taskIds: tasks.map((task) => task.id) }]}
        tasks={tasks}
        collapsed={collapsed}
        {...props}
      />,
    )
  })
  return props
}

function clickButton(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent?.trim() === label)
  expect(button, `找不到按钮：${label}`).toBeTruthy()
  act(() => button?.click())
}

describe("BookAnalysisImportTaskPanel", () => {
  it("没有任务时不渲染", () => {
    const html = renderToStaticMarkup(
      <BookAnalysisImportTaskPanel
        batches={[]}
        tasks={[]}
        collapsed={false}
        {...callbacks()}
      />,
    )

    expect(html).toBe("")
  })

  it("统计运行、等待和失败任务，并显示各状态允许的按钮", () => {
    const tasks = [
      createTask("queued"),
      createTask("copying"),
      createTask("splitting"),
      createTask("interrupted"),
      createTask("failed"),
      createTask("cancelled"),
      createTask("skipped"),
      createTask("completed"),
    ]
    const html = renderToStaticMarkup(
      <BookAnalysisImportTaskPanel
        batches={[{ ...batch, taskIds: tasks.map((task) => task.id) }]}
        tasks={tasks}
        collapsed={false}
        {...callbacks()}
      />,
    )

    expect(html).toContain("批量导入任务")
    expect(html).toContain("进行中 2")
    expect(html).toContain("等待 1")
    expect(html).toContain("失败 1")
    expect(html).toContain("中断 1")
    expect(html).toContain("完成 1")
    expect(html).toContain("跳过 1")
    expect(html).toContain("取消 1")
    const document = new DOMParser().parseFromString(html, "text/html")
    const panel = document.querySelector('section[aria-label="批量导入任务"]')
    expect(panel?.classList.contains("min-h-0")).toBe(true)
    expect(panel?.classList.contains("max-h-[45%]")).toBe(true)
    expect(panel?.classList.contains("overflow-hidden")).toBe(true)
    expect(panel?.classList.contains("shrink-0")).toBe(false)
    const statusSummary = panel?.querySelector('[aria-live="polite"]')
    expect(statusSummary).not.toBeNull()
    const taskList = document.querySelector("#book-analysis-import-task-list")
    expect(taskList?.classList.contains("min-h-0")).toBe(true)
    expect(taskList?.classList.contains("flex-1")).toBe(true)
    expect(taskList?.classList.contains("overflow-y-auto")).toBe(true)
    expect((html.match(/>取消</g) ?? []).length).toBe(3)
    expect((html.match(/>继续</g) ?? []).length).toBe(2)
    expect((html.match(/>重新生成</g) ?? []).length).toBe(3)
    expect((html.match(/>打开作品</g) ?? []).length).toBe(1)
    expect(html).not.toContain("作品-task-skipped</span><button")
  })

  it("按任务 batchId 与批次 taskIds 双重校验并去重渲染", () => {
    const validTask = createTask("queued", "valid-task")
    const duplicateTask = { ...validTask, requestedTitle: "重复记录不应覆盖 Map 最终值" }
    const mismatchedTask = { ...createTask("queued", "mismatched-task"), batchId: "batch-other" }
    const html = renderToStaticMarkup(
      <BookAnalysisImportTaskPanel
        batches={[{ ...batch, taskIds: [validTask.id, validTask.id, mismatchedTask.id] }]}
        tasks={[validTask, duplicateTask, mismatchedTask]}
        collapsed={false}
        {...callbacks()}
      />,
    )

    const document = new DOMParser().parseFromString(html, "text/html")
    const renderedTitles = Array.from(document.querySelectorAll("article .font-medium")).map(
      (element) => element.textContent,
    )
    expect(renderedTitles.filter((title) => title === "重复记录不应覆盖 Map 最终值")).toHaveLength(1)
    expect(renderedTitles.filter((title) => title === "作品-mismatched-task")).toHaveLength(1)
    expect((html.match(/取消全部等待任务/g) ?? []).length).toBe(1)
  })

  it("未归组的等待任务不显示批量取消", () => {
    const orphanTask = { ...createTask("queued", "orphan-task"), batchId: "missing-batch" }
    const html = renderToStaticMarkup(
      <BookAnalysisImportTaskPanel
        batches={[]}
        tasks={[orphanTask]}
        collapsed={false}
        {...callbacks()}
      />,
    )

    expect(html).toContain("作品-orphan-task")
    expect(html).not.toContain("取消全部等待任务")
  })

  it("批次引用缺失任务时显示去重后的缺失数量且不显示完成汇总", () => {
    const completedTask = createTask("completed", "completed-present")
    const html = renderToStaticMarkup(
      <BookAnalysisImportTaskPanel
        batches={[{ ...batch, taskIds: [completedTask.id, "missing-1", "missing-1", "missing-2"] }]}
        tasks={[completedTask]}
        collapsed={false}
        {...callbacks()}
      />,
    )

    expect(html).toContain("批次记录缺少 2 个任务")
    expect(html).not.toContain("批次完成")
  })
  it("批次结束后汇总成功、跳过、失败和取消数量", () => {
    const tasks = [
      createTask("completed", "completed-1"),
      createTask("completed", "completed-2"),
      createTask("skipped", "skipped-1"),
      createTask("failed", "failed-1"),
      createTask("cancelled", "cancelled-1"),
    ]
    const html = renderToStaticMarkup(
      <BookAnalysisImportTaskPanel
        batches={[{ ...batch, taskIds: tasks.map((task) => task.id) }]}
        tasks={tasks}
        collapsed={false}
        {...callbacks()}
      />,
    )

    expect(html).toContain("批次完成")
    expect(html).toContain("成功 2")
    expect(html).toContain("跳过 1")
    expect(html).toContain("失败 1")
    expect(html).toContain("取消 1")
  })

  it("批次存在中断任务时不显示完成汇总", () => {
    const interruptedTask = createTask("interrupted")
    const html = renderToStaticMarkup(
      <BookAnalysisImportTaskPanel
        batches={[{ ...batch, taskIds: [interruptedTask.id] }]}
        tasks={[interruptedTask]}
        collapsed={false}
        {...callbacks()}
      />,
    )

    expect(html).not.toContain("批次完成")
  })
  it("截断错误显示并通过 title 保留完整错误", () => {
    const longError = "读取源文件失败：" + "路径或文件内容异常".repeat(20)
    const failedTask = { ...createTask("failed"), error: longError }
    const html = renderToStaticMarkup(
      <BookAnalysisImportTaskPanel
        batches={[{ ...batch, taskIds: [failedTask.id] }]}
        tasks={[failedTask]}
        collapsed={false}
        {...callbacks()}
      />,
    )

    const document = new DOMParser().parseFromString(html, "text/html")
    const errorElement = document.querySelector(`[title="${longError}"]`)
    expect(errorElement).not.toBeNull()
    expect(errorElement?.getAttribute("title")).toBe(longError)
    expect(errorElement?.classList.contains("truncate")).toBe(true)
    const taskElement = errorElement?.closest("article")
    const descriptionId = taskElement?.getAttribute("aria-describedby")
    expect(descriptionId).toBeTruthy()
    const fullErrorElement = descriptionId ? document.getElementById(descriptionId) : null
    expect(fullErrorElement?.classList.contains("sr-only")).toBe(true)
    expect(fullErrorElement?.textContent).toBe(longError)
  })

  it.each([
    ["queued", "取消", "onCancel"],
    ["copying", "取消", "onCancel"],
    ["splitting", "取消", "onCancel"],
    ["interrupted", "继续", "onContinue"],
    ["interrupted", "重新生成", "onRegenerate"],
    ["failed", "继续", "onContinue"],
    ["failed", "重新生成", "onRegenerate"],
    ["cancelled", "重新生成", "onRegenerate"],
  ] as const)("%s 状态点击%s调用%s", (status, label, callbackName) => {
    const task = createTask(status)
    const props = renderPanel([task])
    const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent?.trim() === label)
    expect(button?.getAttribute("aria-label")).toContain(task.finalTitle || task.requestedTitle)

    clickButton(label)

    expect(props[callbackName]).toHaveBeenCalledWith(`task-${status}`)
  })

  it("拆分进度提供 progressbar 语义和值", () => {
    const task = createTask("splitting")
    const html = renderToStaticMarkup(
      <BookAnalysisImportTaskPanel
        batches={[{ ...batch, taskIds: [task.id] }]}
        tasks={[task]}
        collapsed={false}
        {...callbacks()}
      />,
    )
    const document = new DOMParser().parseFromString(html, "text/html")
    const progress = document.querySelector('[role="progressbar"]')

    expect(progress?.getAttribute("aria-valuemin")).toBe("0")
    expect(progress?.getAttribute("aria-valuemax")).toBe("10")
    expect(progress?.getAttribute("aria-valuenow")).toBe("3")
    expect(progress?.getAttribute("aria-label")).toContain(task.requestedTitle)
  })
  it("completed 状态打开作品，skipped 状态没有操作按钮", () => {
    const completedTask = createTask("completed")
    const props = renderPanel([completedTask])
    const openButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "打开作品",
    )
    expect(openButton?.getAttribute("aria-label")).toContain(completedTask.finalTitle)
    clickButton("打开作品")
    expect(props.onOpenBook).toHaveBeenCalledWith("book-task-completed")

    renderPanel([createTask("skipped")], props)
    expect(Array.from(host.querySelectorAll("button")).map((button) => button.textContent?.trim())).toEqual([
      "收起导入任务",
    ])
  })

  it("确认后删除失败任务", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
    const task = createTask("failed")
    const props = renderPanel([task])

    clickButton("删除")

    expect(confirm).toHaveBeenCalledWith("确定删除导入失败的任务《作品-task-failed》吗？")
    expect(props.onDeleteFailed).toHaveBeenCalledWith(task.id)
  })

  it("已完成任务通过行内输入触发重命名", () => {
    const task = createTask("completed")
    const props = renderPanel([task])

    clickButton("重命名")
    const input = host.querySelector(`input[aria-label="输入作品《${task.finalTitle}》的新名称"]`) as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.value).toBe(task.finalTitle)
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "  新名字  ")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    clickButton("保存")

    expect(props.onRenameCompleted).toHaveBeenCalledWith(task.id, "新名字")
  })

  it("行内重命名可以取消且不会提交", () => {
    const task = createTask("completed")
    const props = renderPanel([task])

    clickButton("重命名")
    clickButton("取消")

    expect(host.querySelector("input")).toBeNull()
    expect(props.onRenameCompleted).not.toHaveBeenCalled()
  })

  it("折叠状态完全受控，任务进度更新不会自行展开", () => {
    const props = renderPanel([createTask("splitting")])
    expect(host.textContent).toContain("作品-task-splitting")
    const collapseButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "收起导入任务",
    )
    expect(collapseButton?.getAttribute("aria-controls")).toBe("book-analysis-import-task-list")
    expect(host.querySelector("#book-analysis-import-task-list")).not.toBeNull()

    clickButton("收起导入任务")
    expect(props.onCollapsedChange).toHaveBeenCalledWith(true)

    renderPanel([{ ...createTask("splitting"), completed: 8 }], props, true)
    expect(host.textContent).not.toContain("作品-task-splitting")
    expect(props.onCollapsedChange).toHaveBeenCalledTimes(1)

    clickButton("展开导入任务")
    expect(props.onCollapsedChange).toHaveBeenLastCalledWith(false)
  })

  it("确认后取消当前批次的全部等待任务", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
    const props = renderPanel([createTask("queued")])

    const cancelAllButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "取消全部等待任务",
    )
    expect(cancelAllButton?.getAttribute("aria-label")).toContain("作品-task-queued")
    clickButton("取消全部等待任务")

    expect(confirm).toHaveBeenCalledWith("确定取消当前批次的全部等待任务吗？")
    expect(props.onCancelAllQueued).toHaveBeenCalledWith("batch-1")
  })

  it("拒绝确认时不取消全部等待任务", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false)
    const props = renderPanel([createTask("queued")])

    clickButton("取消全部等待任务")

    expect(props.onCancelAllQueued).not.toHaveBeenCalled()
  })
})
