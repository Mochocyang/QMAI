// @vitest-environment jsdom

import { act, type ComponentPropsWithoutRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DeAiBatchTaskRecord } from "@/lib/novel/de-ai-batch/types"
import { DeAiBatchReviewDialog } from "./de-ai-batch-review-dialog"

vi.mock("react-diff-viewer-continued", () => ({
  default: ({ oldValue, newValue }: { oldValue?: string; newValue?: string }) => (
    <div>{oldValue}{newValue}</div>
  ),
  DiffMethod: { CHARS: "chars" },
}))

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
    expect(document.body.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${"\u6700\u65b0\u6e90\u7801"}"]`)?.value).toBe("\u7b2c\u4e00\u7ae0\u5019\u9009")
    const desktop = document.body.querySelector('[data-testid="de-ai-review-desktop"]')
    expect(desktop?.className).toContain("md:flex")
    expect(desktop?.querySelectorAll('[data-testid="de-ai-review-scroll"]')).toHaveLength(1)
    expect(document.body.textContent).toContain("\u6e90\u7801\u5bf9\u6bd4")
    expect(document.body.textContent).toContain("\u6e32\u67d3\u9884\u89c8")
    expect(document.body.querySelector('textarea[aria-label="\u6700\u65b0\u6e90\u7801"]')).not.toBeNull()
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

    expect(props.onConfirm).toHaveBeenCalledWith("task-a", "chapter-1", "\u7b2c\u4e00\u7ae0\u5019\u9009")
    expect(props.onRegenerate).toHaveBeenCalledWith("task-a", "chapter-1")
    expect(window.confirm).toHaveBeenCalledWith("确定取消“第一章”的本次处理吗？原文不会被修改。")
    expect(props.onCancelChapter).toHaveBeenCalledWith("task-a", "chapter-1")
  })

  it("候选结果可以另存草稿且只传当前章", () => {
    const props = render()

    act(() => button("另存草稿").click())

    expect(props.onSaveDraft).toHaveBeenCalledWith("task-a", "chapter-1", "\u7b2c\u4e00\u7ae0\u5019\u9009")
  })

  it("passes the edited candidate to confirm and keeps it while switching chapters", () => {
    const props = callbacks()
    const source = record()
    render("chapter-1", props, source)
    const editor = document.body.querySelector<HTMLTextAreaElement>('textarea[aria-label="\u6700\u65b0\u6e90\u7801"]')
    expect(editor).not.toBeNull()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setter?.call(editor, "user-edited candidate")
      editor!.dispatchEvent(new Event("input", { bubbles: true }))
    })
    act(() => button("\u786e\u8ba4\u5f53\u524d\u7ae0").click())
    expect(props.onConfirm).toHaveBeenCalledWith("task-a", "chapter-1", "user-edited candidate")

    render("chapter-2", props, source)
    render("chapter-1", props, source)
    expect(document.body.querySelector<HTMLTextAreaElement>('textarea[aria-label="\u6700\u65b0\u6e90\u7801"]')?.value)
      .toBe("user-edited candidate")
  })

  it("生成中保留旧候选并禁用确认和重复重新生成", () => {
    render("chapter-2")

    expect(document.body.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${"\u6700\u65b0\u6e90\u7801"}"]`)?.value).toBe("\u7b2c\u4e8c\u7ae0\u65e7\u5019\u9009")
    expect(document.body.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${"\u6700\u65b0\u6e90\u7801"}"]`)?.readOnly).toBe(true)
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

  it("mobile review keeps chapter selection and shared source/preview controls", () => {
    render()
    const mobile = document.body.querySelector('[data-testid="de-ai-review-mobile"]')
    expect(mobile?.querySelector('[aria-label="\u9009\u62e9\u5ba1\u6838\u7ae0\u8282"]')).not.toBeNull()
    expect(button("\u6e90\u7801\u5bf9\u6bd4")).toBeTruthy()
    act(() => button("\u6e32\u67d3\u9884\u89c8").click())
    expect(document.body.textContent).toContain("\u539f\u6587\u9884\u89c8")
    expect(document.body.textContent).toContain("\u5019\u9009\u9884\u89c8")
  })

  it("极小高度可滚动到操作区且 pending 时禁用章节操作", () => {
    render(undefined, { ...callbacks(), pending: true })
    const content = document.body.querySelector('[data-testid="de-ai-review-dialog"]')
    expect(content?.className).toContain("overflow-y-auto")
    expect(button("确认当前章").disabled).toBe(true)
    expect(button("重新生成").disabled).toBe(true)
    expect(button("另存草稿").disabled).toBe(true)
    expect(button("取消当前章").disabled).toBe(true)
  })

  it("对比时剥离 frontmatter 与标题，只展示正文", () => {
    const source = record()
    source.chapters[0] = {
      ...source.chapters[0],
      sourceContent: [
        "---",
        "type: chapter",
        "title: 第一章",
        "chapter_number: 1",
        "---",
        "",
        "# 第一章",
        "",
        "第一章原文",
      ].join("\n"),
      candidateContent: [
        "---",
        "title: 不应出现",
        "---",
        "# 假标题",
        "",
        "第一章候选",
      ].join("\n"),
    }
    const props = render("chapter-1", callbacks(), source)

    expect(document.body.textContent).toContain("第一章原文")
    expect(document.body.textContent).not.toContain("chapter_number")
    expect(document.body.textContent).not.toContain("不应出现")
    expect(document.body.querySelector<HTMLTextAreaElement>('textarea[aria-label="最新源码"]')?.value)
      .toBe("第一章候选")

    act(() => button("确认当前章").click())
    expect(props.onConfirm).toHaveBeenCalledWith("task-a", "chapter-1", "第一章候选")
  })
})
