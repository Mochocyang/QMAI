// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ReaderWindow } from "./reader-window"
import type { ReaderWindowPayload } from "@/lib/reader-window"
import type { ReaderWindowAppearance } from "@/lib/reader-window-appearance"

/**
 * 独立窗口的**结构契约**：皮肤与正文排版必须真的落在 DOM 上。
 *
 * 为什么这条测试值得写：这两件事的信号量都只有"看起来对不对"——
 *   · 皮肤靠 `html[data-ui-test-skin]` 上的令牌；
 *   · 正文字体/字号/行距/字距/边距/安全距离靠
 *     `.ui-test-root .ui-test-editor-body/.ui-test-editor-scroll/.ui-test-editor-document`
 *     这几层容器命中 ui-test-editor.css 的选择器。
 * 少了任一层，变量照样被写进 documentElement，却**没有任何消费者**——
 * 用户报的"独立窗口没跟随字体设置 / 没跟随外观"正是这么来的。
 * jsdom 不做布局，但"类名链在不在"是能断言的，而它恰好就是全部依赖。
 */

const docState = vi.hoisted(() => ({
  status: "ready" as "loading" | "ready" | "error",
  html: null as string | null,
  markdown: "# 第1章 起点\n\n正文第一段。",
}))

vi.mock("@/hooks/use-reader-document", () => ({
  useReaderDocument: () => ({
    status: docState.status,
    loadError: "",
    liveMarkdown: docState.markdown,
    html: docState.html,
    heading: "第1章 起点",
    editorEpoch: 0,
    dirty: false,
    saveState: "saved" as const,
    saveError: "",
    notice: "",
    conflict: null,
    reload: vi.fn(),
    handleMarkdownChange: vi.fn(),
    flushNow: vi.fn(async () => true),
    saveHtmlNow: vi.fn(async () => true),
    resolveConflictKeepMine: vi.fn(),
    resolveConflictLoadDisk: vi.fn(),
    hasPendingChanges: () => false,
  }),
}))

vi.mock("@/components/editor/wiki-editor", () => ({
  WikiEditor: (props: { immersiveWriting?: boolean }) => (
    <div data-testid="wiki-editor" data-immersive={props.immersiveWriting ? "true" : "false"} />
  ),
}))

vi.mock("@/components/editor/wiki-reader", () => ({
  WikiReader: () => <div data-testid="wiki-reader" />,
}))

vi.mock("@/components/editor/outline-dual-preview", () => ({
  OutlineDualPreview: (props: { mdEditor: React.ReactNode }) => (
    <div data-testid="outline-dual">{props.mdEditor}</div>
  ),
}))

const APPEARANCE: ReaderWindowAppearance = {
  skin: "zhi",
  uiFontFamily: "microsoft-yahei",
  uiFontSizeScale: 1.25,
  bodyFontFamily: "kaiti",
  bodyFontPx: 21,
  bodyLineHeight: 2.05,
  bodyLetterSpacing: 0.5,
  bodyMarginX: 40,
  bodySafeBottom: 80,
}

function payloadOf(overrides: Partial<ReaderWindowPayload> = {}): ReaderWindowPayload {
  return {
    kind: "chapter",
    path: "C:/书/我的小说/wiki/chapters/第1章 起点.md",
    projectPath: "C:/书/我的小说",
    theme: "light",
    appearance: APPEARANCE,
    ...overrides,
  }
}

describe("独立窗口跟随外观与格式设置", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    docState.status = "ready"
    docState.html = null
    // 皮肤默认值来自 localStorage，清干净才能断言"兜底是静水"
    localStorage.clear()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    const html = document.documentElement
    html.classList.remove("dark")
    delete html.dataset.uiTestSkin
    html.removeAttribute("style")
  })

  function render(payload: ReaderWindowPayload) {
    act(() => root.render(<ReaderWindow payload={payload} />))
  }

  it("皮肤落到 data-ui-test-skin（ui-test.css 整套令牌都挂在这个属性上）", () => {
    render(payloadOf())
    expect(document.documentElement.dataset.uiTestSkin).toBe("zhi")
  })

  it("星夜皮肤同时把窗口切成深色", () => {
    render(payloadOf({ appearance: { ...APPEARANCE, skin: "xing" } }))
    expect(document.documentElement.dataset.uiTestSkin).toBe("xing")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("界面字号与正文排版 5 个变量都写上了", () => {
    render(payloadOf())
    const style = document.documentElement.style
    expect(style.fontSize).toBe("125%")
    expect(style.getPropertyValue("--qmai-body-font-px")).toBe("21px")
    expect(style.getPropertyValue("--qmai-body-leading")).toBe("2.05")
    expect(style.getPropertyValue("--qmai-body-letter-spacing")).toBe("0.5px")
    expect(style.getPropertyValue("--qmai-body-margin-x")).toBe("40px")
    expect(style.getPropertyValue("--qmai-body-safe-bottom")).toBe("80px")
    // 正文字体与界面字体各写各的变量
    expect(style.getPropertyValue("--qmai-body-font-family")).toContain("KaiTi")
    expect(style.getPropertyValue("--qmai-ui-font-family")).toContain("Microsoft YaHei")
  })

  it("根节点必须带 data-skin —— 基础令牌声明在 .ui-test-root 上，只给 html 挂属性会被它盖掉", () => {
    render(payloadOf())
    const root = host.querySelector(".ui-test-root")
    expect(root?.getAttribute("data-skin")).toBe("zhi")
    // html 侧那份同样要有：弹窗、toast 挂在 body 上，靠 html[data-ui-test-skin] 取令牌
    expect(document.documentElement.dataset.uiTestSkin).toBe("zhi")
  })

  it("没带外观快照时按主题兜底：深色落到星夜", () => {
    render(payloadOf({ appearance: undefined, theme: "dark" }))
    expect(host.querySelector(".ui-test-root")?.getAttribute("data-skin")).toBe("xing")
    expect(document.documentElement.dataset.uiTestSkin).toBe("xing")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("没带外观快照 + 浅色主题：落到默认皮肤（静水）", () => {
    render(payloadOf({ appearance: undefined, theme: "light" }))
    expect(host.querySelector(".ui-test-root")?.getAttribute("data-skin")).toBe("jing")
    expect(document.documentElement.dataset.uiTestSkin).toBe("jing")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("章节编辑态落在正文承载层里：ui-test-root → editor → document → scroll → body", () => {
    render(payloadOf())
    const editor = host.querySelector('[data-testid="wiki-editor"]')
    expect(editor, "章节编辑态应该渲染编辑器").not.toBeNull()
    expect(editor?.getAttribute("data-immersive")).toBe("true")

    // 这四层缺一层，正文的字体/字号/行距/边距/安全距离就有一条不生效
    for (const selector of [
      ".ui-test-root",
      ".ui-test-editor[data-kind='chapter']",
      ".ui-test-editor-document",
      ".ui-test-editor-scroll",
      ".ui-test-editor-body",
    ]) {
      expect(host.querySelector(selector), `缺少 ${selector}`).not.toBeNull()
    }
    expect(editor?.closest(".ui-test-editor-body")).not.toBeNull()
  })

  it("章节阅读态同样落在承载层里（与主窗口共用排版变量）", () => {
    render(payloadOf())
    const toggle = host.querySelector('button[aria-label="切换到阅读"]')
    expect(toggle, "阅读/编辑切换按钮").not.toBeNull()
    act(() => (toggle as HTMLButtonElement).click())

    const reader = host.querySelector('[data-testid="wiki-reader"]')
    expect(reader).not.toBeNull()
    expect(reader?.closest(".ui-test-editor-body")).not.toBeNull()
    expect(host.querySelector(".ui-test-editor[data-kind='chapter']")).not.toBeNull()
  })

  it("大纲的 MD 侧也落在承载层里（HTML 侧是 iframe，靠注入皮肤）", () => {
    docState.html = "<html><body>大纲</body></html>"
    render(payloadOf({ kind: "outline" }))

    const dual = host.querySelector('[data-testid="outline-dual"]')
    expect(dual).not.toBeNull()
    const editor = host.querySelector('[data-testid="wiki-editor"]')
    expect(editor?.closest(".ui-test-editor-body")).not.toBeNull()
    expect(host.querySelector(".ui-test-editor[data-kind='outline']")).not.toBeNull()
    // 大纲走 MD 编辑器（formatToolbar），不是沉浸式写作
    expect(editor?.getAttribute("data-immersive")).toBe("false")
  })

  it("没有伴生 HTML 的大纲：MD 编辑器独占整个窗口，仍在承载层里", () => {
    docState.html = null
    render(payloadOf({ kind: "outline" }))
    expect(host.querySelector('[data-testid="outline-dual"]')).toBeNull()
    const editor = host.querySelector('[data-testid="wiki-editor"]')
    expect(editor?.closest(".ui-test-editor-body")).not.toBeNull()
  })
})
