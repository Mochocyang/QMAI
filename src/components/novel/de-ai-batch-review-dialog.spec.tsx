// @vitest-environment jsdom

import { act, type ComponentPropsWithoutRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DeAiBatchTaskRecord } from "@/lib/novel/de-ai-batch/types"
import { DeAiBatchReviewDialog } from "./de-ai-batch-review-dialog"
vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ direction: _direction, ...props }: ComponentPropsWithoutRef<"div"> & { direction?: string }) => <div {...props} />,
  ResizablePanel: ({ defaultSize: _defaultSize, minSize: _minSize, ...props }: ComponentPropsWithoutRef<"div"> & { defaultSize?: number; minSize?: number }) => <div {...props} />,
  ResizableHandle: ({ withHandle: _withHandle, ...props }: ComponentPropsWithoutRef<"div"> & { withHandle?: boolean }) => <div {...props} />,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver

function record(): DeAiBatchTaskRecord {
  return {
    task: {
      version: 1,
      id: "task-a",
      projectPath: "C:/project",
      workId: "work-a",
      workTitle: "作品甲",
      modelKey: "openai/test",
      skillId: null,
      skillName: "默认",
      skillContent: "规则",
      status: "reviewing",
      chapterIds: ["chapter-1", "chapter-2"],
      error: null,
      createdAt: 1,
      startedAt: 2,
      completedAt: null,
      updatedAt: 3,
    },
    chapters: [
      {
        version: 1,
        id: "chapter-1",
        taskId: "task-a",
        title: "第一章",
        order: 1,
        sourcePath: "C:/project/第一章.md",
        sourceContent: "第一章原文",
        candidateContent: "第一章候选",
        status: "ready",
        runId: null,
        generation: 1,
        error: null,
        createdAt: 1,
        updatedAt: 2,
      },
      {
        version: 1,
        id: "chapter-2",
        taskId: "task-a",
        title: "第二章",
        order: 2,
        sourcePath: "C:/project/第二章.md",
        sourceContent: "第二章原文",
        candidateContent: "第二章旧候选",
        status: "generating",
        runId: "run-2",
        generation: 2,
        error: null,
        createdAt: 1,
        updatedAt: 3,
      },
    ],
  }
}

function callbacks() {
  return {
    onSelectChapter: vi.fn(),
    onConfirm: vi.fn(),
    onSaveDraft: vi.fn(),
    onRegenerate: vi.fn(),
    onCancelChapter: vi.fn(),
    onClose: vi.fn(),
  }
}

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

function render(currentChapterId = "chapter-1", props: ReturnType<typeof callbacks> & { pending?: boolean } = callbacks(), source = record()) {
  act(() => {
    root.render(
      <DeAiBatchReviewDialog
        open
        record={source}
        currentChapterId={currentChapterId}
        {...props}
      />,
    )
  })
  return props
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll("button")).find((item) => item.textContent?.trim() === label || item.textContent?.trim().startsWith(label))
  expect(found, `找不到按钮：${label}`).toBeTruthy()
  return found as HTMLButtonElement
}

describe("DeAiBatchReviewDialog", () => {
  it("宽屏提供左章节、中原文、右候选三栏和各自滚动区", () => {
    render()

    expect(document.body.textContent).toContain("第一章原文")
    expect(document.body.textContent).toContain("第一章候选")
    const desktop = document.body.querySelector('[data-testid="de-ai-review-desktop"]')
    expect(desktop?.className).toContain("md:flex")
    expect(desktop?.querySelectorAll('[data-testid="de-ai-review-scroll"]')).toHaveLength(3)
  })

  it("弹窗受视口约束且头部、正文、底部不越界", () => {
    render()

    const content = document.body.querySelector('[data-testid="de-ai-review-dialog"]')
    expect(content?.className).toContain("max-h-[calc(100dvh-2rem)]")
    expect(content?.className).toContain("overflow-y-auto")
    expect(content?.className).toContain("max-w-[calc(100vw-2rem)]")
    expect(document.body.querySelector('[data-testid="de-ai-review-body"]')?.className).toContain("min-h-24")
  })

  it("窄屏保留章节选择并用原文/候选页签降级", () => {
    render()

    const mobile = document.body.querySelector('[data-testid="de-ai-review-mobile"]')
    expect(mobile?.className).toContain("md:hidden")
    expect(mobile?.textContent).toContain("原文")
    expect(mobile?.textContent).toContain("候选")
    expect(mobile?.querySelector('[aria-label="选择审核章节"]')).not.toBeNull()
  })

  it("章节切换与逐章确认、重新生成、取消只传当前章", () => {
    const props = render()
    act(() => button("第二章").click())
    expect(props.onSelectChapter).toHaveBeenCalledWith("chapter-2")

    act(() => button("确认当前章").click())
    act(() => button("重新生成").click())
    vi.spyOn(window, "confirm").mockReturnValue(true)
    act(() => button("取消当前章").click())

    expect(props.onConfirm).toHaveBeenCalledWith("task-a", "chapter-1")
    expect(props.onRegenerate).toHaveBeenCalledWith("task-a", "chapter-1")
    expect(window.confirm).toHaveBeenCalledWith("确定取消“第一章”的本次处理吗？原文不会被修改。")
    expect(props.onCancelChapter).toHaveBeenCalledWith("task-a", "chapter-1")
  })

  it("候选结果可以另存草稿且只传当前章", () => {
    const props = render()

    act(() => button("另存草稿").click())

    expect(props.onSaveDraft).toHaveBeenCalledWith("task-a", "chapter-1")
  })

  it("生成中保留旧候选并禁用确认和重复重新生成", () => {
    render("chapter-2")

    expect(document.body.textContent).toContain("第二章旧候选")
    expect(document.body.textContent).toContain("生成中")
    expect(button("确认当前章").disabled).toBe(true)
    expect(button("重新生成").disabled).toBe(true)
  })

  it("关闭弹窗只调用 onClose，不取消后台章节", () => {
    const props = render()

    act(() => button("关闭").click())

    expect(props.onClose).toHaveBeenCalledTimes(1)
    expect(props.onCancelChapter).not.toHaveBeenCalled()
  })

  it("移动端 tabs 具备完整 ARIA 关联、roving tabindex 与左右键切换", () => {
    render()
    const tabs = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const panels = Array.from(document.body.querySelectorAll<HTMLElement>('[role="tabpanel"]'))
    expect(tabs).toHaveLength(2)
    expect(panels).toHaveLength(1)
    expect(tabs[0]).toMatchObject({ tabIndex: 0 })
    expect(tabs[1]).toMatchObject({ tabIndex: -1 })
    expect(tabs[0].getAttribute("aria-controls")).toBe(panels[0].id)
    expect(panels[0].getAttribute("aria-labelledby")).toBe(tabs[0].id)
    act(() => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })))
    expect(tabs[1].getAttribute("aria-selected")).toBe("true")
    expect(document.activeElement).toBe(tabs[1])
    expect(panels[0].getAttribute("aria-labelledby")).toBe(tabs[1].id)
    act(() => tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })))
    expect(tabs[0].getAttribute("aria-selected")).toBe("true")
  })

  it("极小高度可滚动到操作区且 pending 时禁用章节操作", () => {
    render(undefined, { ...callbacks(), pending: true })
    const content = document.body.querySelector('[data-testid="de-ai-review-dialog"]')
    expect(content?.className).toContain("overflow-y-auto")
    expect(button("确认当前章").disabled).toBe(true)
    expect(button("重新生成").disabled).toBe(true)
    expect(button("另存草稿").disabled).toBe(true)
    expect(button("取消当前章").disabled).toBe(true)
  })})
