// @vitest-environment jsdom

/**
 * 写作工作区的挂载位置。
 *
 * 用户要求「写作字数」状态栏只显示在**章节正文栏**底部：目录栏与 AI 对话栏
 * 下面不出现，大纲视图也不出现。此前它挂在 `.ui-test-app` 下，会横跨整窗
 * 并铺到目录栏与对话栏底下，所以这里把位置钉在真实渲染结果上。
 *
 * PreviewPanel 用轻量替身：本文件要验的是**挂载结构**，不是编辑器内部。
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { useOutlineGenerationStore } from "@/stores/outline-generation-store"
import { UiTestWorkspace } from "./ui-test-workspace"
import { useWritingStatsStore } from "@/stores/writing-stats-store"

vi.mock("@/components/layout/preview-panel", () => ({
  PreviewPanel: () => <div data-testid="preview">正文</div>,
}))
vi.mock("@/components/chat/chat-panel", () => ({ ChatPanel: () => <div data-testid="chat">对话</div> }))
vi.mock("@/components/sources/outline-chat-panel", () => ({ OutlineChatPanel: () => <div data-testid="outline-chat">大纲对话</div> }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function mount(mode: "chapter" | "outline") {
  await act(async () => {
    root.render(
      <div className="ui-test-root" data-skin="jing">
        <UiTestWorkspace mode={mode} requestedWidth={420} viewportWidth={1440} onWidthChange={() => {}} />
      </div>,
    )
  })
}

function editorPane(): HTMLElement {
  const node = container.querySelector<HTMLElement>("#ui-test-editor-pane")
  expect(node, "应渲染正文栏").not.toBeNull()
  return node!
}

beforeEach(() => {
  useWritingStatsStore.getState().reset()
  useWikiStore.setState({ chatExpanded: false })
  useOutlineGenerationStore.setState({ panelOpen: false })
  window.innerWidth = 1440
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  useWritingStatsStore.getState().reset()
  vi.clearAllMocks()
})

describe("写作字数状态栏的挂载位置", () => {
  it("章节视图：状态栏在正文栏底部，且是正文容器之后的兄弟", async () => {
    await mount("chapter")
    const pane = editorPane()
    const body = pane.querySelector(":scope > .ui-test-editor-body")
    const bar = pane.querySelector(":scope > footer.ui-test-statusbar")
    expect(body, "正文栏应有正文容器").not.toBeNull()
    expect(bar, "章节视图应显示写作字数状态栏").not.toBeNull()
    expect(body!.nextElementSibling, "状态栏应紧跟正文容器").toBe(bar)
    expect(pane.lastElementChild, "状态栏应是正文栏的最后一个子节点（贴底）").toBe(bar)
  })

  it("章节视图：状态栏只占正文栏宽度，不横跨 AI 对话栏", async () => {
    useWikiStore.setState({ chatExpanded: true })
    await mount("chapter")
    const panes = container.querySelector(".ui-test-writing-panes")!
    expect(panes.children.length, "对话栏应已展开").toBeGreaterThan(1)
    // 状态栏在正文栏里面，而不是写作区的兄弟节点 —— 这是「不横跨整窗」的结构保证。
    expect(panes.querySelector(":scope > footer.ui-test-statusbar")).toBeNull()
    expect(editorPane().querySelector(":scope > footer.ui-test-statusbar")).not.toBeNull()
  })

  it("大纲视图：不显示状态栏（它统计的是章节正文字数）", async () => {
    useOutlineGenerationStore.setState({ panelOpen: true })
    await mount("outline")
    expect(container.querySelector(".ui-test-statusbar")).toBeNull()
    expect(container.querySelector('[data-testid="outline-chat"]')).not.toBeNull()
  })

  it("切到 AI 对话标签页时，正文栏与状态栏一起隐藏", async () => {
    // tabs 模式（窄窗 + 对话展开）靠 hidden 属性切换；正文栏加了 display:flex
    // 会盖掉 UA 的 [hidden]{display:none}，所以这里顺带钉住那条 CSS 补偿规则。
    await mount("chapter")
    expect(editorPane().querySelector(":scope > footer.ui-test-statusbar")).not.toBeNull()
    const css = await import("node:fs").then((fs) => fs.readFileSync("src/components/uitest/ui-test.css", "utf8"))
    expect(css.replace(/\r\n/g, "\n")).toContain(".ui-test-editor-pane[hidden] { display: none; }")
  })
})
