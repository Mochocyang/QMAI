// @vitest-environment jsdom
//
// 问题四：桌面文件要能直接拖进大纲/章节列表导入。
//
// 这里验证的是"接线"部分：命中判定（含高分屏 DPR 换算）、扩展名粗筛、
// 以及拖到列表以外时绝不能触发导入。
// Tauri 的原生拖拽在 jsdom 里不存在，所以把 getCurrentWebview 换成一个能手动
// 触发事件的对象，测的是我们自己那段判定逻辑。
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const platformMock = vi.hoisted(() => ({ isTauri: vi.fn(() => true) }))
vi.mock("@/lib/platform", () => platformMock)

const webviewMock = vi.hoisted(() => {
  const state = {
    handler: null as null | ((event: { payload: unknown }) => void),
    unlisten: vi.fn(),
    listenError: null as Error | null,
  }
  return {
    state,
    getCurrentWebview: () => ({
      onDragDropEvent: async (handler: (event: { payload: unknown }) => void) => {
        if (state.listenError) throw state.listenError
        state.handler = handler
        return state.unlisten
      },
    }),
  }
})
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: webviewMock.getCurrentWebview,
}))

import { useListFileDrop } from "./use-list-file-drop"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const LIST_RECT = { left: 100, top: 200, right: 400, bottom: 600 }

let container: HTMLDivElement
let root: Root
let onDropPaths: ReturnType<typeof vi.fn>
let onUnsupportedDrop: ReturnType<typeof vi.fn>
let dragging: boolean

function Harness({ kind = "chapter" as const, enabled = true }) {
  const { containerRef, isDraggingOver } = useListFileDrop({
    enabled,
    kind,
    onDropPaths,
    onUnsupportedDrop,
  })
  dragging = isDraggingOver
  return <div ref={containerRef} data-testid="list" />
}

/** 让 hook 里那次 await import + await onDragDropEvent 落地。 */
async function flush() {
  await act(async () => {
    for (let index = 0; index < 6; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function emit(payload: unknown) {
  act(() => { webviewMock.state.handler?.({ payload }) })
}

beforeEach(async () => {
  platformMock.isTauri.mockReturnValue(true)
  webviewMock.state.handler = null
  webviewMock.state.listenError = null
  webviewMock.state.unlisten.mockReset()
  onDropPaths = vi.fn()
  onUnsupportedDrop = vi.fn()
  dragging = false

  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  // jsdom 不做布局，getBoundingClientRect 全是 0；直接把列表矩形钉死。
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    ...LIST_RECT,
    x: LIST_RECT.left,
    y: LIST_RECT.top,
    width: LIST_RECT.right - LIST_RECT.left,
    height: LIST_RECT.bottom - LIST_RECT.top,
    toJSON: () => ({}),
  })) as unknown as Element["getBoundingClientRect"]

  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 })
})

afterEach(() => {
  act(() => root.unmount())
  document.body.removeChild(container)
  vi.restoreAllMocks()
})

async function mount(props: { kind?: "chapter" | "outline"; enabled?: boolean } = {}) {
  await act(async () => { root.render(<Harness {...props} />) })
  await flush()
}

describe("useListFileDrop", () => {
  it("挂载后就注册了原生拖拽监听", async () => {
    await mount()
    expect(webviewMock.state.handler).not.toBeNull()
  })

  it("没打开项目（enabled=false）时不注册监听", async () => {
    await mount({ enabled: false })
    expect(webviewMock.state.handler).toBeNull()
  })

  it("不是 Tauri 环境时不注册监听", async () => {
    platformMock.isTauri.mockReturnValue(false)
    await mount()
    expect(webviewMock.state.handler).toBeNull()
  })

  it("卸载时退订，不留悬空监听", async () => {
    await mount()
    act(() => root.unmount())
    expect(webviewMock.state.unlisten).toHaveBeenCalled()
    // afterEach 会再 unmount 一次，重建 root 以保持收尾逻辑简单
    root = createRoot(container)
  })

  it("拖动经过列表时进入高亮状态，离开时收掉", async () => {
    await mount()
    emit({ type: "enter", paths: ["E:/a/第1章.md"], position: { x: 250, y: 400 } })
    expect(dragging).toBe(true)
    emit({ type: "leave" })
    expect(dragging).toBe(false)
  })

  it("拖动经过列表以外时不进入高亮", async () => {
    await mount()
    emit({ type: "over", position: { x: 900, y: 400 } })
    expect(dragging).toBe(false)
  })

  /**
   * 监听器是 webview 级的：用户把文件拖到编辑区松手，这个事件同样会送到我们手里。
   * 没有命中判定就会"拖到任何地方都往列表里导入"。
   */
  it("在列表以外松手不触发导入", async () => {
    await mount()
    emit({ type: "drop", paths: ["E:/a/第1章.md"], position: { x: 900, y: 400 } })
    expect(onDropPaths).not.toHaveBeenCalled()
  })

  it("在列表上松手，把可导入的路径交出去", async () => {
    await mount()
    emit({ type: "drop", paths: ["E:/a/第1章.md", "E:/a/封面.png"], position: { x: 250, y: 400 } })
    expect(onDropPaths).toHaveBeenCalledWith(["E:/a/第1章.md"])
    expect(onUnsupportedDrop).not.toHaveBeenCalled()
  })

  it("松手后高亮收掉", async () => {
    await mount()
    emit({ type: "enter", paths: ["E:/a/第1章.md"], position: { x: 250, y: 400 } })
    expect(dragging).toBe(true)
    emit({ type: "drop", paths: ["E:/a/第1章.md"], position: { x: 250, y: 400 } })
    expect(dragging).toBe(false)
  })

  it("没有可导入的文件时给出提示，不触发导入", async () => {
    await mount()
    emit({ type: "drop", paths: ["E:/a/封面.png", "E:/a/资料.pdf"], position: { x: 250, y: 400 } })
    expect(onDropPaths).not.toHaveBeenCalled()
    expect(onUnsupportedDrop).toHaveBeenCalledTimes(1)
    expect(String(onUnsupportedDrop.mock.calls[0][0])).toContain("章节文档")
  })

  it("大纲列表按大纲的扩展名筛选", async () => {
    await mount({ kind: "outline" })
    emit({ type: "drop", paths: ["E:/a/主线.md", "E:/a/图.png"], position: { x: 250, y: 400 } })
    expect(onDropPaths).toHaveBeenCalledWith(["E:/a/主线.md"])
  })

  /**
   * 高分屏上 Tauri 报的是物理像素。DPR=2 时物理 500x800 → CSS 250x400，
   * 落在列表里；同样这个物理坐标在 DPR=1 下已经在列表右边外面了。
   * 用例把这条换算关系钉住：不做换算的话"拖上去了没反应"。
   */
  it("按 devicePixelRatio 换算物理坐标后再判定命中", async () => {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 })
    await mount()

    emit({ type: "drop", paths: ["E:/a/第1章.md"], position: { x: 500, y: 800 } })
    expect(onDropPaths, "DPR=2 时物理 500x800 就是 CSS 250x400，在列表内").toHaveBeenCalledWith(["E:/a/第1章.md"])

    onDropPaths.mockClear()
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 })
    emit({ type: "drop", paths: ["E:/a/第1章.md"], position: { x: 500, y: 800 } })
    expect(onDropPaths, "DPR=1 时同一个物理坐标在列表外").not.toHaveBeenCalled()
  })

  it("拿不到原生拖拽能力时静默降级，不抛错", async () => {
    webviewMock.state.listenError = new Error("no ipc")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await mount()
    expect(warn).toHaveBeenCalled()
  })
})
