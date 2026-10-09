// @vitest-environment jsdom

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { act, createRef, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PreviewPanel } from "@/components/layout/preview-panel"
import { useWikiStore } from "@/stores/wiki-store"
import { useOutlineGenerationStore } from "@/stores/outline-generation-store"
import { countChapterBodyWords } from "@/lib/chapter-word-count"
import { CHAPTER_AUTOSAVE_INTERVAL_MS, flushPendingChapterSave } from "@/lib/chapter-save-flush"
import {
  BODY_MARGIN_X_VIEWPORT_MAX,
  BODY_MARGIN_X_VIEWPORT_MIN,
  BODY_MARGIN_X_VIEWPORT_VW,
  defaultBodyMarginXForViewport,
} from "@/lib/font-settings"
import { UiTestEditor } from "./ui-test-editor"

const fixture = vi.hoisted(() => ({
  enabled: true,
  files: new Map<string, string>(),
  write: vi.fn(),
  /*
   * 6 个落盘函数的 spy。
   *
   * ── 为什么必须把落盘也盯住（代码质量审查 C2）──
   * 审查实测：`applyBodyTypographyChange` 在三个 spec 里 **0 命中**，
   * `.schedule(` 只在 debounced-persist.spec.ts 里出现过。
   * 也就是说「浮层里改了值 → 真的写进 app-state.json」这条链路上，
   * **落盘那一段零行为覆盖**，只有"源码里存在这行字符串"级别的守卫。
   * 而"读回来了却忘了写回 / 写错字段"正是本仓库记录过的最难发现的一类：
   * 编译过、界面不报错，唯一症状是"重开软件设置回退"。
   * 所以这里用真 spy 从行为上钉住它。
   */
  saved: {
    fontFamily: vi.fn(async () => {}),
    fontPx: vi.fn(async () => {}),
    lineHeight: vi.fn(async () => {}),
    letterSpacing: vi.fn(async () => {}),
    marginX: vi.fn(async () => {}),
    safeBottom: vi.fn(async () => {}),
  },
}))

vi.mock("@/lib/ui-test", () => ({ get IS_UI_TEST_BUILD() { return fixture.enabled } }))
vi.mock("@/commands/fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/commands/fs")>(),
  readFile: vi.fn(async (path: string) => {
    if (!fixture.files.has(path)) throw new Error("文件不存在")
    return fixture.files.get(path)!
  }),
  writeFileAtomic: (...args: unknown[]) => fixture.write(...args),
  deleteFile: vi.fn(async (path: string) => { fixture.files.delete(path) }),
  writeFileIfAbsent: vi.fn(async (path: string, markdown: string) => {
    if (fixture.files.has(path)) throw new Error("文件已存在")
    fixture.files.set(path, markdown)
  }),
  fileExists: vi.fn(async (path: string) => fixture.files.has(path)),
  listDirectory: vi.fn(async () => []),
}))
vi.mock("@/lib/project-store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/project-store")>(),
  saveNovelConfig: vi.fn(async () => {}),
  /* 6 个正文排版落盘函数换成 spy：只观察调用，不改行为。 */
  saveUiBodyFontFamily: fixture.saved.fontFamily,
  saveUiBodyFontPx: fixture.saved.fontPx,
  saveUiBodyLineHeight: fixture.saved.lineHeight,
  saveUiBodyLetterSpacing: fixture.saved.letterSpacing,
  saveUiBodyMarginX: fixture.saved.marginX,
  saveUiBodySafeBottom: fixture.saved.safeBottom,
}))
vi.mock("@/components/skill-library/use-de-ai-skill-options", () => ({
  useDeAiSkillOptions: () => ({ loading: false, skills: [], effectiveName: "未启用", currentSkillId: null, defaultSkillId: null, loadError: "" }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const project = { id: "editor-spec", name: "实际书名", path: "C:/test-book" }
const chapterPath = `${project.path}/wiki/chapters/第一卷/第16章.md`
const outlinePath = `${project.path}/wiki/outlines/故事骨架/总纲.md`
const chapter = "---\ntype: chapter\nchapter_number: 16\nchapter_status: draft\n---\n\n# 第16章 实际章名\n\n　　雨停了。\n\n　　有人推开了门。"
const outline = "# 实际大纲标题\n\n## 故事一句话\n\n这是实际的大纲。\n\n- 不能缩进的列表"

/**
 * 事故文件的结构（行号与盘上的 00-设定集.md 一致）。
 *
 * 第 6 行的 `---` 正好落在 parseFrontmatter 容错分支的门槛
 * `lineNumberAt() > 6` 上（6 > 6 为假 → 放行），于是标题、用途说明、
 * `## 0. 定位` 表格和三条全书纪律被当成 frontmatter 切掉。
 * 用户看到的正是：标题回落成文件名「00-设定集」，正文直接从
 * `## 1. 金手指` 开始。
 */
const settingDoc = [
  "# 《高人一等》设定集（修订版 v1）", // 1
  "", // 2
  "> 用途：这是往下写每一章都要对照的“宪法”。", // 3
  "> 适用范围：番茄/七猫签约向男频爽文。", // 4
  "", // 5
  "---", // 6 ← 分隔线，不是 frontmatter 围栏
  "", // 7
  "## 0. 定位", // 8
  "",
  "| 项 | 内容 |",
  "| --- | --- |",
  "| 类型 | 男频穿越玄幻 |",
  "",
  "**全书纪律（三条，写崩了先回来读这三条）**",
  "",
  "1. 打脸要打在欠打的人身上。",
  "2. 金手指的规则一次都不许破。",
  "3. 每一个“爽”都要有代价。",
  "",
  "---", // 24 ← 分隔线
  "",
  "## 1. 金手指：高人一等令牌（重订）",
  "",
  "### 1.1 规则表（全书必须遵守）",
  "",
].join("\n")
let container: HTMLDivElement
let root: Root

async function mount(path: string | null = chapterPath) {
  useWikiStore.setState({ project, selectedFile: path, novelMode: true, activeView: path === outlinePath ? "sources" : "wiki" })
  await act(async () => { root.render(<div className="ui-test-root"><PreviewPanel /></div>) })
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
}

function button(label: string, scope: ParentNode = container) {
  expect(scope, "应有编辑器轻工具行或菜单").not.toBeNull()
  const found = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((item) => (
    item.getAttribute("aria-label") === label || item.textContent?.trim() === label
  ))
  expect(found, `应有可操作的“${label}”入口`).toBeDefined()
  return found!
}

async function click(label: string) {
  await act(async () => { button(label).click() })
}

function changeTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
  setter.call(textarea, value)
  textarea.dispatchEvent(new Event("input", { bubbles: true }))
}

beforeEach(() => {
  fixture.enabled = true
  fixture.files.clear()
  fixture.files.set(chapterPath, chapter)
  fixture.files.set(outlinePath, outline)
  fixture.write.mockReset().mockImplementation(async (path: string, markdown: string) => { fixture.files.set(path, markdown) })
  useWikiStore.setState(useWikiStore.getInitialState())
  useOutlineGenerationStore.setState({ tasks: [], panelOpen: false })
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  // 防止卸载时的原有章节 flush 触发真实文件操作；业务文件 API 已被内存替代。
  await act(async () => { useWikiStore.setState({ selectedFile: null, fileContent: "" }) })
  await act(async () => { root.unmount() })
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("测试版正文编辑器", () => {
  it.each([chapterPath, outlinePath])("标题和操作区位于独立正文滚动区之外：%s", async (path) => {
    await mount(path)
    const scroll = container.querySelector(".ui-test-editor-scroll")!
    const header = container.querySelector(".ui-test-editor-header")!
    expect(scroll).not.toBeNull()
    expect(header).not.toBeNull()
    expect(scroll.contains(header)).toBe(false)
    expect(header.querySelector("h1")).not.toBeNull()
    expect(header.querySelector('[aria-label="文档操作"]')).not.toBeNull()
    expect(scroll.querySelector(".ui-test-editor-body")).not.toBeNull()
    expect(container.querySelector('[aria-label="文档位置"]')).toBeNull()
    expect(fixture.write).not.toHaveBeenCalled()
  })

  it("滚动引用绑定正文滚动区，保存状态变化不重建滚动容器", async () => {
    const scrollRef = createRef<HTMLDivElement>()
    const props = { kind: "chapter" as const, path: chapterPath, title: "第16章 实际章名", onTitleCommit: vi.fn(), statusLabel: "草稿", wordCount: 10, actions: <button>提取记忆</button>, moreActions: [], taskStatus: "", onRetrySave: vi.fn(), onClose: vi.fn(), scrollRef }
    const render = async (phase: "pending" | "saving") => {
      await act(async () => { root.render(<div className="ui-test-root"><UiTestEditor {...props} saveState={{ path: chapterPath, phase }}>{() => <p>正文</p>}</UiTestEditor></div>) })
    }
    await render("pending")
    const scroll = container.querySelector<HTMLDivElement>(".ui-test-editor-scroll")!
    expect(scroll).not.toBeNull()
    expect(scrollRef.current).toBe(scroll)
    scroll.scrollTop = 240
    await render("saving")
    expect(scrollRef.current).toBe(scroll)
    expect(scroll.scrollTop).toBe(240)
    expect(container.querySelector('[data-ui-test-save-state]')?.textContent).toContain("正在保存")
  })

  it("外部文件刷新后更新正文并恢复新的正文滚动区位置", async () => {
    await mount()
    const scroll = container.querySelector<HTMLDivElement>(".ui-test-editor-scroll")!
    const previousEditor = container.querySelector('[data-writing-editor] textarea')
    scroll.scrollTop = 360
    fixture.files.set(chapterPath, chapter + "\n\n外部更新后的段落。")
    await act(async () => { window.dispatchEvent(new Event("focus")) })
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))) })
    const nextEditor = container.querySelector<HTMLTextAreaElement>('[data-writing-editor] textarea')!
    expect(nextEditor.value).toContain("外部更新后的段落")
    expect(nextEditor).not.toBe(previousEditor)
    expect(container.querySelector(".ui-test-editor-scroll")).toBe(scroll)
    expect(scroll.scrollTop).toBe(360)
    expect(fixture.write).not.toHaveBeenCalled()
  })

  it("章节使用新版编辑器，不渲染旧版满宽标题条", async () => {
    await mount()
    expect(container.querySelector(".ui-test-editor")).not.toBeNull()
    expect(container.querySelector(".h-12")).toBeNull()
  })

  it("删除冗余面包屑但保留真实标题、状态和字数", async () => {
    await mount()
    const breadcrumb = container.querySelector('[aria-label="文档位置"]')
    expect(breadcrumb).toBeNull()
    expect(container.querySelector("h1")?.textContent ?? "").toContain("第16章 实际章名")
    const metadata = container.querySelector(".ui-test-editor-meta")
    expect(metadata?.textContent ?? "").toContain("草稿")
    expect(metadata?.textContent ?? "").toContain(`${countChapterBodyWords(chapter)} 字`)
  })

  it("章节显示去AI味、提取记忆、查看记忆、字体设置和一键排版", async () => {
    await mount()
    const toolbar = container.querySelector('.ui-test-editor-toolbar')!
    expect(button("去AI味", toolbar).disabled).toBe(false)
    expect(button("提取记忆", toolbar).disabled).toBe(false)
    expect(button("查看记忆", toolbar).disabled).toBe(false)
    /*
     * 「字体设置」这一条是 Task 11 补上的**渲染层**断言。
     *
     * 为什么需要它：Task 11 新增的守卫
     * （preview-panel.chapter-toolbar.spec.tsx）是**源码文本**断言 ——
     * 它只能证明那段 JSX 还在文件里，证明不了它**会被渲染出来**。
     * 而"用户点不到按钮"恰恰是源码断言看不见的那一类失败
     * （比如按钮被写进了一个永不成立的分支、或所在容器没挂上）。
     * Task 11 的实现者也如实报告了这一点：他没有做人工 UI 验收，
     * "用户真的看到"只被间接保证。这条断言补的就是那一层。
     */
    expect(button("字体设置", toolbar).disabled).toBe(false)
    expect(button("一键排版", toolbar).disabled).toBe(false)
    expect(container.querySelector('[aria-label="更多编辑器操作"]')).toBeNull()
    expect(toolbar.textContent).not.toContain("预览正文")
    expect(toolbar.textContent).not.toContain("关闭文档")
    expect(toolbar.textContent).not.toContain("查看文件详情")
  })

  it("正式章节直接显示重新提取记忆", async () => {
    fixture.files.set(chapterPath, chapter.replace("chapter_status: draft", "chapter_status: final"))
    await mount()
    expect(container.querySelector('[aria-label="更多编辑器操作"]')).toBeNull()
    button("重新提取记忆", container.querySelector(".ui-test-editor-toolbar")!)
  })

  it("章节正文保持编辑状态，不提供预览切换", async () => {
    await mount()
    expect(container.querySelector(".ui-test-editor-reader")).toBeNull()
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-writing-editor] textarea')
    expect(textarea?.value).toContain("有人推开了门。")
    expect(fixture.write).not.toHaveBeenCalled()
  })

  it("大纲标题回落成文件名说明正文被吞了——设定集必须用文档自带的标题", async () => {
    fixture.files.set(outlinePath, settingDoc)
    await mount(outlinePath)

    const heading = container.querySelector("h1")?.textContent ?? ""
    // 文档自带的一级标题必须留下；旧实现把它连同 `## 0. 定位` 整节当成
    // frontmatter 切掉，标题只能回落到文件名。
    expect(heading).toContain("《高人一等》设定集（修订版 v1）")
    expect(heading).not.toContain("总纲")
    expect(container.textContent).not.toContain("00-设定集")
  })

  it("大纲有真实标题和记忆入口，尚未提取记忆也能看到解释", async () => {
    await mount(outlinePath)
    expect(container.querySelector(".ui-test-editor-meta")).toBeNull()
    expect(container.textContent).not.toContain("待提取记忆")
    expect(container.querySelector("h1")?.textContent ?? "").toContain("实际大纲标题")
    expect(container.textContent).not.toContain("生成大纲")
    button("提取记忆")
    await click("查看记忆")
    expect(container.textContent).toContain("尚未提取记忆")
    expect(fixture.write).not.toHaveBeenCalled()
  })

  it("没有文档时使用中文空状态且不伪造保存成功", async () => {
    await mount(null)
    expect(container.textContent).toContain("选择一份文档，开始写作")
    expect(container.textContent).not.toContain("已保存")
  })

  it("加载文件不显示常驻底部状态，例行自动保存全程不打扰", async () => {
    await mount()
    expect(container.querySelector(".ui-test-editor-footer")).toBeNull()
    expect(container.textContent).not.toContain("已从本地读取")
    expect(container.textContent).not.toContain("大纲字数")
    vi.useFakeTimers()
    let finishWrite!: () => void
    fixture.write.mockImplementation(() => new Promise<void>((resolve) => { finishWrite = resolve }))
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-writing-editor] textarea')!
    await act(async () => { changeTextarea(textarea, `${textarea.value}新内容。`) })
    // 用户反馈：每按一次回车都弹保存提示很吵。例行落盘全程不显示任何文案，
    // 连「等待自动保存…」也不显示，所以底部状态区始终不存在。
    expect(container.querySelector(".ui-test-editor-footer")).toBeNull()
    expect(container.textContent).not.toContain("等待自动保存")
    expect(container.textContent).not.toContain("正在保存")
    await act(async () => { await vi.advanceTimersByTimeAsync(CHAPTER_AUTOSAVE_INTERVAL_MS) })
    expect(container.textContent).not.toContain("正在保存")
    // 但落盘确实发生了 —— 安静不等于不保存。
    expect(fixture.write).toHaveBeenCalled()
    await act(async () => { finishWrite() })
    expect(container.querySelector(".ui-test-editor-footer")).toBeNull()
  })

  it("写入失败常驻中文反馈，不显示虚假的保存成功", async () => {
    await mount()
    vi.useFakeTimers()
    vi.spyOn(console, "error").mockImplementation(() => {})
    fixture.write.mockRejectedValue(new Error("磁盘不可写"))
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-writing-editor] textarea')!
    await act(async () => { changeTextarea(textarea, `${textarea.value}未落盘。`) })
    await act(async () => { await vi.advanceTimersByTimeAsync(CHAPTER_AUTOSAVE_INTERVAL_MS) })
    const status = container.querySelector('[data-ui-test-save-state]')
    expect(status?.textContent ?? "").toContain("保存失败")
    expect(status?.textContent ?? "").not.toContain("已保存")
  })

  it("自动保存间隔没到就关窗，待落盘的正文仍会写下去", async () => {
    // 这是把间隔从 1 秒改成 3 分钟后最重要的兜底：关窗路径必须能主动落盘，
    // 否则用户最后几分钟写的内容会留在定时器里随窗口消失。
    await mount()
    vi.useFakeTimers()
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-writing-editor] textarea')!
    await act(async () => { changeTextarea(textarea, `${textarea.value}关窗前最后一句。`) })
    expect(fixture.write).not.toHaveBeenCalled()
    // 一点时间都不推进，直接模拟 App.tsx 关窗处理器里的那一次 flush。
    await act(async () => { await flushPendingChapterSave() })
    expect(fixture.write).toHaveBeenCalledTimes(1)
    expect(fixture.files.get(chapterPath)).toContain("关窗前最后一句")
  })

  it("已经落盘后再 flush 不会重复写盘", async () => {
    await mount()
    vi.useFakeTimers()
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-writing-editor] textarea')!
    await act(async () => { changeTextarea(textarea, `${textarea.value}写完了。`) })
    await act(async () => { await vi.advanceTimersByTimeAsync(CHAPTER_AUTOSAVE_INTERVAL_MS) })
    expect(fixture.write).toHaveBeenCalledTimes(1)
    await act(async () => { await flushPendingChapterSave() })
    expect(fixture.write).toHaveBeenCalledTimes(1)
  })
})

describe("编辑器异常与原业务回归", () => {
  it("未改章节标题直接保存时，补上序号连字符、重命名文件并排版正文", async () => {
    fixture.files.set(chapterPath, "---\ntype: chapter\nchapter_number: 16\nchapter_status: draft\n---\n\n# 第16章 实际章名\n\n雨停了English。\n\n有人推开了门。")
    await mount()
    await act(async () => { container.querySelector<HTMLButtonElement>("h1 button")!.click() })
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="章节标题"]')!
    await act(async () => { input.blur() })
    await act(async () => { await vi.waitFor(() => { expect(fixture.write).toHaveBeenCalled() }) })
    const renamedPath = `${project.path}/wiki/chapters/第一卷/第16章-实际章名.md`
    const written = String(fixture.write.mock.calls.at(-1)?.[1] ?? "")
    expect(fixture.write).toHaveBeenCalledWith(renamedPath, expect.any(String))
    expect(written).toContain("# 第16章-实际章名")
    expect(written).toContain("　　雨停了 English。")
    expect(written).toContain("　　有人推开了门。")
    expect(written).not.toContain("第16章 实际章名")
    expect(fixture.files.has(chapterPath)).toBe(false)
    expect(fixture.files.get(renamedPath)).toBe(written)
  })

  it("修改章节标题保存时，同样补上连字符、重命名并排版正文", async () => {
    fixture.files.set(chapterPath, "---\ntype: chapter\nchapter_number: 16\nchapter_status: draft\n---\n\n# 第16章 实际章名\n\n雨停了English。\n\n有人推开了门。")
    await mount()
    await act(async () => { container.querySelector<HTMLButtonElement>("h1 button")!.click() })
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="章节标题"]')!
    await act(async () => { changeTextarea(input, "新章名") })
    await act(async () => { input.blur() })
    await act(async () => { await vi.waitFor(() => { expect(fixture.write).toHaveBeenCalled() }) })
    const renamedPath = `${project.path}/wiki/chapters/第一卷/第16章-新章名.md`
    const written = String(fixture.write.mock.calls.at(-1)?.[1] ?? "")
    expect(fixture.write).toHaveBeenCalledWith(renamedPath, expect.any(String))
    expect(written).toContain("# 第16章-新章名")
    expect(written).toContain("　　雨停了 English。")
    expect(written).toContain("　　有人推开了门。")
    expect(fixture.files.has(chapterPath)).toBe(false)
    expect(fixture.files.get(renamedPath)).toBe(written)
  })

  it("标题输入法回车不提交，Escape 取消不改文件", async () => {
    await mount()
    await act(async () => { container.querySelector<HTMLButtonElement>("h1 button")!.click() })
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="章节标题"]')!
    await act(async () => { changeTextarea(input, "输入法仍在组合的长标题") })
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })) })
    expect(document.activeElement).toBe(input)
    expect(fixture.write).not.toHaveBeenCalled()
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })) })
    expect(container.querySelector("h1")?.textContent).toBe("第16章 实际章名")
    expect(fixture.write).not.toHaveBeenCalled()
  })

  it("大纲标题保存仍走原自动保存，保留正文并可从中文菜单预览", async () => {
    await mount(outlinePath)
    vi.useFakeTimers()
    await act(async () => { container.querySelector<HTMLButtonElement>("h1 button")!.click() })
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="大纲标题"]')!
    await act(async () => { changeTextarea(input, "新的真实大纲标题") })
    await act(async () => { input.blur() })
    expect(useWikiStore.getState().fileContent).toContain("# 新的真实大纲标题")
    expect(useWikiStore.getState().fileContent).toContain("- 不能缩进的列表")
    // 改标题是离散动作，走 immediate 分支立刻落盘，不必等自动保存间隔。
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fixture.write).toHaveBeenCalledWith(outlinePath, useWikiStore.getState().fileContent)
    vi.useRealTimers()
    expect(container.querySelector('[aria-label="更多编辑器操作"]')).toBeNull()
  })

  it("旧保存请求完成时不能盖掉较新编辑的待保存状态", async () => {
    await mount()
    vi.useFakeTimers()
    let finishWrite!: () => void
    fixture.write.mockImplementation(() => new Promise<void>((resolve) => { finishWrite = resolve }))
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-writing-editor] textarea')!
    await act(async () => { changeTextarea(textarea, `${textarea.value}第一笔。`) })
    await act(async () => { await vi.advanceTimersByTimeAsync(CHAPTER_AUTOSAVE_INTERVAL_MS) })
    await act(async () => { changeTextarea(textarea, `${textarea.value}第二笔。`) })
    await act(async () => { finishWrite() })
    // 例行落盘刻意不显示任何文案（用户反馈保存提示很吵），所以这里断言
    // 保存状态机的相位而不是文字：旧写入完成后的 "saved" 不能盖掉更新的待保存。
    const phase = container.querySelector('[data-ui-test-save-state]')?.getAttribute("data-ui-test-save-state")
    expect(phase).not.toBe("saved")
    // 第二笔仍在待落盘队列里：走完间隔后会写下去。
    fixture.write.mockResolvedValue(undefined)
    await act(async () => { await vi.advanceTimersByTimeAsync(CHAPTER_AUTOSAVE_INTERVAL_MS) })
    expect(fixture.write).toHaveBeenCalled()
  })

  it("外部修改冲突不报成功，也不改变原冲突写入策略", async () => {
    await mount()
    vi.useFakeTimers()
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-writing-editor] textarea')!
    await act(async () => { changeTextarea(textarea, `${textarea.value}本地修改。`) })
    fixture.files.set(chapterPath, `${chapter}外部修改。`)
    await act(async () => { await vi.advanceTimersByTimeAsync(CHAPTER_AUTOSAVE_INTERVAL_MS) })
    expect(container.querySelector('[data-ui-test-save-state]')?.textContent).toContain("文件已在外部修改")
    expect(textarea.value).toContain("本地修改。")
    expect(fixture.write).not.toHaveBeenCalled()
  })

  it("一键排版的写入失败也显示真实状态并能重试原动作", async () => {
    await mount()
    vi.spyOn(console, "error").mockImplementation(() => {})
    fixture.write.mockRejectedValueOnce(new Error("磁盘不可写"))
    await click("一键排版")
    expect(container.querySelector('[data-ui-test-save-state]')?.textContent).toContain("保存失败")
    await click("重试保存")
    expect(fixture.write).toHaveBeenCalledTimes(2)
    expect(container.querySelector(".ui-test-editor-footer")).toBeNull()
  })

  it("章节提取记忆入口位于去AI味和查看记忆之间", async () => {
    await mount()
    const toolbar = container.querySelector(".ui-test-editor-toolbar")!
    const labels = [...toolbar.querySelectorAll("button.ui-test-editor-action")].map((item) => item.getAttribute("aria-label"))
    /*
     * 「字体设置」是 Task 11 新加的（用户要求写作现场能调正文排版）。
     * 它插在「查看记忆」与「一键排版」之间 —— 这条**完整列举**的断言
     * 因此必须跟着更新，否则会报"工具栏多了个按钮"。
     *
     * 为什么保留"完整列举"而不放宽成"包含这几项即可"：
     * 这条断言的价值正是**冻结工具栏的组合与顺序** ——
     * 放宽之后，误删一个按钮、或两个按钮换了位置都不会被发现。
     * 新增按钮时让它红一次、由人确认位置合理，是它该有的行为。
     *
     * 这条是被 Task 11 **实际打破**的既有断言：Task 11 的 Files 清单里
     * 没有这个文件，13 份简报也没有任何任务认领它 —— 于是 main 上红了
     * 一条既有单测。实现者按"只碰清单内文件"的规矩**停下来上报**，
     * 没有越界改它（这是对的）。现在由我补上并修正图纸归属。
     */
    expect(labels).toEqual(["去AI味", "提取记忆", "查看记忆", "字体设置", "一键排版"])
  })

  /*
   * ── 下面两条补的是审查发现的**真缺口**：大纲入口没有任何渲染层覆盖 ──
   *
   * 背景：Task 11 新增的守卫（preview-panel.chapter-toolbar.spec.tsx）是
   * **源码文本**断言 —— 它只能证明那段 JSX 还在文件里，
   * **证明不了它会被渲染出来**。
   *
   * 审查做了这个变异：把大纲那处的「字体设置」按钮包进条件渲染、
   * 甚至包成 `{false ? (…字体设置…) : null}`（**确定**渲染不出来），
   * 全部源码文本判据**依然全绿**。我独立复现过，结论一致
   * （脚本见 .codex-temp/verify-outline-render-gap.mjs，含 `{false}` 反向对照）。
   *
   * 而"大纲里点不到字体设置"是**用户在界面上直接看到**的错，
   * 也正是用户明确要求过的那件事（「大纲当中也要有这个设置功能」）。
   * 所以必须有渲染层断言 —— 这正是本文件这一组用例该补的。
   *
   * 用 it.each 把两条路径都覆盖：只覆盖章节那处等于把大纲放走，
   * 而"两处入口"恰恰是本次的要求。
   */
  it.each([
    ["章节", chapterPath],
    ["大纲", outlinePath],
  ])("%s写作现场的「字体设置」入口真的渲染出来、且可点击", async (_kind, path) => {
    await mount(path)
    const toolbar = container.querySelector(".ui-test-editor-toolbar")!
    expect(toolbar, "应有编辑器工具栏").not.toBeNull()

    /*
     * 用与 :211 相同的方式取按钮：按 aria-label 在工具栏里找。
     * 找不到时 button() 会带着"应有可操作的…入口"的说明失败 ——
     * 那正是"入口没渲染出来"该有的报错。
     */
    const entry = button("字体设置", toolbar)
    expect(entry, "「字体设置」入口应渲染出来").toBeDefined()
    expect(entry.disabled, "「字体设置」入口应可点击").toBe(false)

    /*
     * 反向对照：确认它此刻**还没有**浮层 ——
     * 否则下一条"点开后有浮层"的断言可能被别的东西喂饱。
     */
    expect(container.querySelector('[role="dialog"][aria-label="字体设置"]')).toBeNull()

    await act(async () => { entry.click() })

    const dialog = container.querySelector('[role="dialog"][aria-label="字体设置"]')
    expect(dialog, "点「字体设置」后应打开浮层").not.toBeNull()
  })

  it.each([
    ["章节", chapterPath],
    ["大纲", outlinePath],
  ])("%s写作现场的字体设置浮层暴露全部 6 个控件，且显示的是 store 里的真值", async (_kind, path) => {
    /*
     * ── 这条覆盖的到底是什么（措辞经代码质量审查 C2 校正过）──
     * 它覆盖的是**取值**这一半：浮层里每个控件显示的必须是 store 里的真值。
     * 6 个值全是 number，所以"把行间距接成字号"这种串味
     * tsc 拦不住、源码文本断言也拦不住（它只看字面量有没有写对）。
     * 这里从**渲染结果**上看：每个控件显示的值必须等于 store 里的值。
     *
     * ⚠ 它**不覆盖回写**：本用例从头到尾没有触发浮层里任何控件的 onChange，
     * 也不断言任何落盘函数被调用。原来这里的注释写成"补的是取值/回写"，
     * 是把半个缺口说成了整个 —— 审查指出后已改正。
     * 回写与落盘由**下一条**用例（"拖动浮层里的滑块会写回 store 并落盘"）真行为覆盖。
     *
     * 用 [data-ui-typography-value="<标签>"] 这个测试钩子
     * （body-typography-fields.tsx 里专门为此加的）。
     */
    const s = useWikiStore.getState()
    /*
     * 这里**不用** `?.()` 可选调用：setter 名若写错，`?.()` 会静默什么都不做，
     * 于是断言失败时报的是"值没显示"、而不是"setter 不存在"，白查一轮。
     * 直接调用，名字错了 tsc 与运行时都会立刻报。
     */
    s.setUiBodyFontPx(21)
    s.setUiBodyLineHeight(1.5)
    s.setUiBodyLetterSpacing(0.5)
    s.setUiBodySafeBottom(64)
    await mount(path)

    const toolbar = container.querySelector(".ui-test-editor-toolbar")!
    await act(async () => { button("字体设置", toolbar).click() })
    const dialog = container.querySelector('[role="dialog"][aria-label="字体设置"]')!
    expect(dialog).not.toBeNull()

    // 六个控件都在（标签与 body-typography-fields.tsx 里的 aria-label 一致）
    for (const label of ["正文字体", "正文字号预设", "正文字号", "行间距", "字间距", "左右边距", "底部安全距离"]) {
      expect(
        dialog.querySelector(`[aria-label="${label}"]`),
        `浮层里应有「${label}」控件`,
      ).not.toBeNull()
    }

    /*
     * 取值：显示值必须来自对应的 store 字段。断言**具体数值**
     * （而不是"存在即可"），这样串味会红 —— 例如把行间距接到字号上时，
     * "行间距"那一格会显示 21.00 而不是 1.50。
     *
     * 两类控件取值方式不同，别混：
     *   · 字号是 <input type="range" aria-label="正文字号">，读 .value
     *   · 其余四条（行间距/字间距/左右边距/底部安全距离）走 SliderRow，
     *     显示文本在 [data-ui-typography-value="<标签>"] 里
     */
    const sizeInput = dialog.querySelector<HTMLInputElement>('input[type="range"][aria-label="正文字号"]')!
    expect(sizeInput, "应有正文字号滑块").not.toBeNull()
    expect(sizeInput.value, "字号滑块应停在 store 里的 21").toBe("21")

    const shown = (label: string) => dialog.querySelector(`[data-ui-typography-value="${label}"]`)?.textContent?.trim() ?? ""
    expect(shown("行间距"), "行间距应显示 store 里的 1.50").toBe("1.50")
    expect(shown("字间距"), "字间距应显示 store 里的 0.5px").toBe("0.5px")
    expect(shown("底部安全距离"), "底部安全距离应显示 store 里的 64px").toBe("64px")
  })

  it.each([
    ["章节", chapterPath],
    ["大纲", outlinePath],
  ])("%s写作现场：拖动浮层里的滑块会写回 store 并落盘（真行为，不是源码文本）", async (_kind, path) => {
    /*
     * ── 这条补的是「回写 + 落盘」，代码质量审查 C2 指出的真缺口 ──
     * 上一条只证明"控件显示的值来自 store"（读）。
     * 这一条从反方向走完整条链路：
     *   拖滑块 → onChange → applyBodyTypographyChange → store setter
     *          → schedule(persistAllBodyTypography) → 关浮层 flush → 6 个 saveUiBody*
     *
     * 为什么值得单独立一条：这条链路上每一环都可能"看着对其实错"，
     * 而且全是 tsc 拦不住的 —— 6 个值都是 number：
     *   · case 与 setter 交叉接错：拖「行间距」结果改了「字间距」
     *   · 落盘列表漏一个字段：那个设置永远存不下去，重开软件就回退
     *   · 落盘读错字段：saveUiBodyLineHeight(s.uiBodyFontPx)
     * 前两条以前只有源码文本断言（且审查实测那两条有假红/漏判），
     * 第三条则完全没有覆盖。
     *
     * 断言用**具体数值**而不是"被调用过"：只查调用次数的话，
     * 参数接错（把 lineHeight 的值传给 safeBottom）照样绿。
     */
    for (const spy of Object.values(fixture.saved)) spy.mockClear()

    const s = useWikiStore.getState()
    /* 先把 6 个值摆成一组互不相同的数，串味才看得出来 */
    s.setUiBodyFontPx(19)
    s.setUiBodyLineHeight(1.8)
    s.setUiBodyLetterSpacing(0.4)
    s.setUiBodyMarginX(44)
    s.setUiBodySafeBottom(55)
    await mount(path)

    const toolbar = container.querySelector(".ui-test-editor-toolbar")!
    await act(async () => { button("字体设置", toolbar).click() })
    const dialog = container.querySelector('[role="dialog"][aria-label="字体设置"]')!
    expect(dialog).not.toBeNull()

    /*
     * 拖「行间距」到 2.2 —— 这是最容易被串味接错的一格。
     * 断言：① store 里 lineHeight 真的变了
     *       ② 其余 4 个数字字段**一个都没动**（串味的直接特征）
     */
    const lineSlider = dialog.querySelector<HTMLInputElement>('input[type="range"][aria-label="行间距"]')!
    expect(lineSlider, "浮层里应有行间距滑块").not.toBeNull()
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!
    await act(async () => {
      nativeSetter.call(lineSlider, "2.2")
      lineSlider.dispatchEvent(new window.Event("input", { bubbles: true }))
    })

    const after = useWikiStore.getState()
    expect(after.uiBodyLineHeight, "拖行间距应把 store 的 lineHeight 改成 2.2").toBe(2.2)
    expect(after.uiBodyFontPx, "拖行间距不该动字号").toBe(19)
    expect(after.uiBodyLetterSpacing, "拖行间距不该动字间距").toBe(0.4)
    expect(after.uiBodyMarginX, "拖行间距不该动左右边距").toBe(44)
    expect(after.uiBodySafeBottom, "拖行间距不该动底部安全距离").toBe(55)

    /*
     * 落盘是**去抖**的（400ms），此刻还不该写。
     * 这一条同时钉住了"确实走了去抖"——若把 schedule 改成直接 await，
     * 一次拖动会写几十遍 app-state.json，这里会先红。
     */
    for (const [name, spy] of Object.entries(fixture.saved)) {
      expect(spy, `刚拖完还没到去抖窗口，不该已经落盘 ${name}`).not.toHaveBeenCalled()
    }

    /*
     * 点浮层外关闭 → 走 document mousedown → closeBodyFontPopover → flush。
     * 这是用户最常见的操作顺序（「拖完最后一下就关掉」），
     * 也是"最后一次改动不能被丢掉"这条要求的落点。
     */
    await act(async () => {
      document.body.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }))
    })
    expect(container.querySelector('[role="dialog"][aria-label="字体设置"]')).toBeNull()

    /*
     * 现在 6 个落盘函数都必须被调用，且**各自收到自己那个字段的值**。
     * 参数接错、漏落盘、落盘读错字段，都会在这里红。
     */
    expect(fixture.saved.lineHeight, "关浮层应把行间距落盘").toHaveBeenCalledWith(2.2)
    expect(fixture.saved.fontPx, "落盘应写 store 里的字号 19").toHaveBeenCalledWith(19)
    expect(fixture.saved.letterSpacing, "落盘应写字间距 0.4").toHaveBeenCalledWith(0.4)
    expect(fixture.saved.marginX, "落盘应写左右边距 44").toHaveBeenCalledWith(44)
    expect(fixture.saved.safeBottom, "落盘应写底部安全距离 55").toHaveBeenCalledWith(55)
    /*
     * 正文字体是唯一一个非数字字段，单独断言"被调用过"——
     * 它的值取决于 store 当前字体，用具体值会让用例依赖默认字体设置。
     */
    expect(fixture.saved.fontFamily, "落盘应包含正文字体（漏一个有字段就永远存不下去）").toHaveBeenCalled()
  })

  it("卸载写作现场时，还没到去抖窗口的排版改动**必须落盘**（不能丢）", async () => {
    /*
     * ── 这条守的是一个真实缺陷，代码质量审查 I1 发现的 ──
     * 原来组件卸载时调的是 `persist.dispose()`。而 dispose 的语义是
     * **丢弃**待落盘动作（`debounced-persist.ts` 里 `pending = null`），
     * flush 才是"立刻执行"。
     *
     * 为什么这条路径真的会丢：用户调完设置后最常见的做法是直接关掉
     * 写作视图。关**浮层**那条路径是安全的（document 的 mousedown 会
     * 先调 closeBodyFontPopover，里面就是 flush）—— 所以上一条用例
     * 即使全绿也**证明不了**这条不变量。真正没保护的是**不经过 mousedown
     * 的卸载**：
     *   ① 拖完滑块 400ms 内直接关窗口 / Alt+F4（走 Tauri 关闭，无 mousedown）
     *   ② 键盘导航切走视图，导致写作现场整个卸载
     * 而启动读回是 app-state 优先的，丢一次写入就等于"我明明调过，重开又变回去"。
     *
     * 做法：用**独立的 root**（不动 afterEach 用的那个），
     * 拖完滑块立刻卸载，中间不点任何东西、不关浮层。
     * 若有人把 flush 改回 dispose，这条会红在"应把行间距落盘"上。
     */
    for (const spy of Object.values(fixture.saved)) spy.mockClear()

    const local = document.createElement("div")
    document.body.appendChild(local)
    const localRoot = createRoot(local)
    try {
      const s = useWikiStore.getState()
      s.setUiBodyFontPx(19)
      s.setUiBodyLineHeight(1.8)
      s.setUiBodySafeBottom(55)
      useWikiStore.setState({ project, selectedFile: chapterPath, novelMode: true, activeView: "wiki" })

      await act(async () => { localRoot.render(<div className="ui-test-root"><PreviewPanel /></div>) })
      await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })

      const toolbar = local.querySelector(".ui-test-editor-toolbar")!
      const entry = Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button")).find(
        (item) => item.getAttribute("aria-label") === "字体设置",
      )!
      await act(async () => { entry.click() })
      const dialog = local.querySelector('[role="dialog"][aria-label="字体设置"]')!
      expect(dialog, "浮层应已打开（否则下面拖的不是浮层里的滑块）").not.toBeNull()

      const lineSlider = dialog.querySelector<HTMLInputElement>('input[type="range"][aria-label="行间距"]')!
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!
      await act(async () => {
        nativeSetter.call(lineSlider, "2.4")
        lineSlider.dispatchEvent(new window.Event("input", { bubbles: true }))
      })
      expect(useWikiStore.getState().uiBodyLineHeight, "拖动应立即写进 store").toBe(2.4)

      /* 还没到 400ms 去抖窗口，此刻确实还没落盘 */
      expect(fixture.saved.lineHeight, "此刻还在去抖窗口内，不该已落盘").not.toHaveBeenCalled()

      /* 关键一步：直接卸载，不关浮层、不点任何东西 */
      await act(async () => { localRoot.unmount() })

      expect(
        fixture.saved.lineHeight,
        "卸载时必须 flush 而不是 dispose —— 否则这次改动会被丢掉，用户重开软件看到设置回退",
      ).toHaveBeenCalledWith(2.4)
      expect(fixture.saved.safeBottom, "卸载时该落的是整套值，不只是刚拖的那一个").toHaveBeenCalledWith(55)
    } finally {
      local.remove()
    }
  })

  it("已有正文的草稿章打开时提示先保存为正式再提取记忆", async () => {
    await mount()
    const hint = container.querySelector(".ui-test-editor-draft-hint")
    expect(hint?.textContent).toContain("这一章还是草稿")
    expect(hint?.textContent).toContain("点击「提取记忆」会先保存为正式章节")
    expect(container.querySelector(".ui-test-editor-action.is-hint-target")?.getAttribute("aria-label")).toBe("提取记忆")
    const actions = container.querySelector(".ui-test-editor-draft-hint-actions")
    expect(actions?.textContent).toContain("知道了")
    expect(actions?.textContent).toContain("不再提醒")
  })

  it("不再提醒会关闭写作设置里的草稿提取提示", async () => {
    await mount()
    await click("不再提醒")
    expect(container.querySelector(".ui-test-editor-draft-hint")).toBeNull()
    expect(useWikiStore.getState().novelConfig.draftMemoryHintEnabled).toBe(false)
  })

  it("写作设置关闭后不再显示草稿提取提示", async () => {
    useWikiStore.setState({
      novelConfig: { ...useWikiStore.getState().novelConfig, draftMemoryHintEnabled: false },
    })
    await mount()
    expect(container.querySelector(".ui-test-editor-draft-hint")).toBeNull()
  })

  it("正式章节不显示草稿提取提示", async () => {
    fixture.files.set(chapterPath, chapter.replace("chapter_status: draft", "chapter_status: final"))
    await mount()
    expect(container.querySelector(".ui-test-editor-draft-hint")).toBeNull()
  })

  it("空章节在第一次写作保存成功后才提示，同一章继续保存不重复弹出", async () => {
    const emptyPath = `${project.path}/wiki/chapters/第一卷/第1章.md`
    fixture.files.set(emptyPath, "---\ntype: chapter\nchapter_number: 1\nchapter_status: draft\n---\n\n# 第1章 开篇\n\n")
    await mount(emptyPath)
    expect(container.querySelector(".ui-test-editor-draft-hint")).toBeNull()
    vi.useFakeTimers()
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-writing-editor] textarea')!
    await act(async () => { changeTextarea(textarea, `${textarea.value}有人推开了门。`) })
    expect(container.querySelector(".ui-test-editor-draft-hint")).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(CHAPTER_AUTOSAVE_INTERVAL_MS) })
    expect(container.querySelectorAll(".ui-test-editor-draft-hint")).toHaveLength(1)
    await act(async () => { changeTextarea(textarea, `${textarea.value}又写了一句。`) })
    await act(async () => { await vi.advanceTimersByTimeAsync(CHAPTER_AUTOSAVE_INTERVAL_MS) })
    expect(container.querySelectorAll(".ui-test-editor-draft-hint")).toHaveLength(1)
    await click("知道了")
    expect(container.querySelector(".ui-test-editor-draft-hint")).toBeNull()
    await act(async () => { changeTextarea(textarea, `${textarea.value}再写。`) })
    await act(async () => { await vi.advanceTimersByTimeAsync(CHAPTER_AUTOSAVE_INTERVAL_MS) })
    expect(container.querySelector(".ui-test-editor-draft-hint")).toBeNull()
  })

  it("这本书提示一次后，只有点开后面已有章节的草稿才再提示", async () => {
    const chapter4 = `${project.path}/wiki/chapters/第一卷/第4章.md`
    const chapter5 = `${project.path}/wiki/chapters/第一卷/第5章.md`
    fixture.files.set(chapter4, chapter.replace("chapter_number: 16", "chapter_number: 4").replace("第16章 实际章名", "第4章 未定稿"))
    fixture.files.set(chapter5, chapter.replace("chapter_number: 16", "chapter_number: 5").replace("第16章 实际章名", "第5章 新章"))
    useWikiStore.setState({
      fileTree: [{
        name: "第一卷",
        path: `${project.path}/wiki/chapters/第一卷`,
        is_dir: true,
        children: [
          { name: "第4章.md", path: chapter4, is_dir: false },
          { name: "第5章.md", path: chapter5, is_dir: false },
        ],
      }],
    })
    await mount(chapter5)
    expect(container.querySelector(".ui-test-editor-draft-hint")).not.toBeNull()
    expect(useWikiStore.getState().novelConfig.draftMemoryHintSeen).toBe(true)
    await act(async () => { useWikiStore.setState({ selectedFile: chapter4 }) })
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
    expect(container.textContent).toContain("第4章 未定稿")
    expect(container.querySelector(".ui-test-editor-draft-hint")?.textContent).toContain("这一章还是草稿")
    await act(async () => { useWikiStore.setState({ selectedFile: chapter5 }) })
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
    expect(container.textContent).toContain("第5章 新章")
    expect(container.querySelector(".ui-test-editor-draft-hint")).toBeNull()
    await act(async () => { useWikiStore.setState({ selectedFile: chapter4 }) })
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
    expect(container.querySelector(".ui-test-editor-draft-hint")?.textContent).toContain("这一章还是草稿")
  })

  it("没有更大章号时，离开后再点开同一章不再提示", async () => {
    const otherPath = `${project.path}/wiki/chapters/第一卷/第4章.md`
    fixture.files.set(otherPath, chapter.replace("chapter_number: 16", "chapter_number: 4").replace("第16章 实际章名", "第4章 未定稿"))
    await mount()
    expect(container.querySelector(".ui-test-editor-draft-hint")).not.toBeNull()
    expect(useWikiStore.getState().novelConfig.draftMemoryHintSeen).toBe(true)
    await act(async () => { useWikiStore.setState({ selectedFile: otherPath }) })
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
    expect(container.textContent).toContain("第4章 未定稿")
    expect(container.querySelector(".ui-test-editor-draft-hint")).toBeNull()
    await act(async () => { useWikiStore.setState({ selectedFile: chapterPath }) })
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
    expect(container.textContent).toContain("第16章 实际章名")
    expect(container.querySelector(".ui-test-editor-draft-hint")).toBeNull()
  })

  it("读取失败不把错误文本当成可编辑正文或标题", async () => {
    fixture.files.delete(chapterPath)
    await mount()
    expect(container.querySelector('[data-writing-editor]')).toBeNull()
    expect(container.querySelector("h1 button:not(:disabled)")).toBeNull()
    expect(container.textContent).toContain("读取文件失败")
    expect(fixture.write).not.toHaveBeenCalled()
  })
})

describe("图稿复核修正", () => {
  it("没有源码缩进的章节只标记视觉缩进，不更改缓冲内容或触发保存", async () => {
    const plain = chapter.replace(/　　/g, "")
    fixture.files.set(chapterPath, plain)
    await mount()
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-writing-editor] textarea')!
    expect(textarea.getAttribute("data-ui-test-indent")).toBe("visual")
    expect(textarea.value.startsWith("雨停了。")).toBe(true)
    expect(useWikiStore.getState().fileContent).toBe(plain)
    expect(fixture.write).not.toHaveBeenCalled()
  })

  it("源码已有缩进或结构行时不重复全局缩进", async () => {
    await mount()
    expect(container.querySelector('[data-writing-editor] textarea')?.getAttribute("data-ui-test-indent")).toBe("source")
  })

  it("重复的大纲资料卡带独立标识，信息与原链接在更多详情中可达", async () => {
    fixture.files.set(outlinePath, '---\ntitle: 真实资料标题\ntype: outline\ndescription: 保留资料说明\n---\n\n' + outline)
    await mount(outlinePath)
    expect(container.querySelector('.ui-test-editor-body [data-ui-test-frontmatter]')).not.toBeNull()
    expect(container.querySelector('[aria-label="更多编辑器操作"]')).toBeNull()
    const details = container.querySelector('.ui-test-editor-body')!
    expect(details?.textContent).toContain("保留资料说明")
    expect(fixture.write).not.toHaveBeenCalled()
  })

  it("批量大纲工具只在大纲更多中出现，首次打开后收起不销毁内部状态", async () => {
    function AuxiliaryProbe() {
      const [count, setCount] = useState(0)
      return <button type="button" onClick={() => setCount(count + 1)}>已完成 {count}</button>
    }
    const scrollRef = createRef<HTMLDivElement>()
    const props = {
      kind: "outline" as const, path: outlinePath, title: "实际大纲", onTitleCommit: () => {},
      statusLabel: "待提取记忆", wordCount: 10, actions: null, moreActions: [], saveState: null, taskStatus: "", onRetrySave: () => {}, onClose: () => {}, scrollRef,
      auxiliaryPanel: <AuxiliaryProbe />,
    }
    await act(async () => { root.render(<div className="ui-test-root"><UiTestEditor {...props}>{() => <p>正文</p>}</UiTestEditor></div>) })
    expect(container.querySelector('.ui-test-editor-auxiliary')).toBeNull()
    expect(container.querySelector('[aria-label="更多编辑器操作"]')).toBeNull()
    expect(container.querySelector<HTMLElement>('.ui-test-editor-auxiliary')).toBeNull()
    await act(async () => { root.render(<div className="ui-test-root"><UiTestEditor {...props} kind="chapter">{() => <p>正文</p>}</UiTestEditor></div>) })
    expect(container.querySelector('[aria-label="更多编辑器操作"]')).toBeNull()
  })
})

describe("测试版正文样式边界", () => {
  const cssPath = resolve(__dirname, "ui-test-editor.css")
  const css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : ""

  it("固定外壳不滚动，只有正文区域滚动且头部不裁切提示", () => {
    expect(css).toMatch(/\.ui-test-editor\s*\{[^}]*overflow:\s*hidden/)
    expect(css).toMatch(/\.ui-test-editor-scroll\s*\{[^}]*overflow-y:\s*auto/)
    expect(css).toMatch(/\.ui-test-editor-header\s*\{[^}]*flex-shrink:\s*0/)
    expect(css).toMatch(/\.ui-test-editor-header\s*\{[^}]*background:\s*var\(--ui-paper\)/)
  })

  it("草稿提示按工具栏宽度定位，盖住正文，且不能在窄编辑区被裁掉", () => {
    expect(css).toMatch(/\.ui-test-editor-toolbar\s*\{[^}]*position:\s*relative/)
    expect(css).toMatch(/\.ui-test-editor-hint-anchor\s*\{[^}]*position:\s*static/)
    expect(css).toMatch(/\.ui-test-editor-draft-hint\s*\{[^}]*width:\s*min\(280px, 100%\)/)
    expect(css).toMatch(/\.ui-test-editor-header\s*\{[^}]*z-index:\s*2/)
  })

  it("单独提供最大800正文容器，1.25rem/1.75rem标题与单一来源的衬线正文", () => {
    /*
     * 800px 是**正文宽度**，不是「正文 + 两侧边距」。
     *
     * 这条断言原来只查 `max-width: 800px` 这个字符串存在 —— 挡不住下面这个
     * 真实发生过的缺陷：padding 从外层搬到本层之后，本层 box-sizing 是
     * border-box（Tailwind preflight 全局设的），于是 800px 把 padding 也算了进去，
     * 默认档正文只剩 800 − 2×48 = 704px（1200px 窗口实测），
     * 而计划自己的数值对照表写的是「默认档必须与今天逐位相同」。
     * 字符串在、断言绿，用户看到的正文却窄了 12%。
     *
     * 所以必须把**几何关系**钉住：上限 = 800px + 两侧边距，且 padding 用的是
     * 同一个 fallback 变量。只查数字是否出现是不够的。
     */
    expect(css).toMatch(/--qmai-body-margin-x-fallback:\s*clamp\(20px, 4vw, 48px\)/)
    expect(css).toMatch(/max-width:\s*calc\(800px \+ 2 \* var\(--qmai-body-margin-x-fallback\)\)/)
    // 正文容器必须用同一个 fallback 变量做 padding 的兜底，否则上面那个上限算的不是同一边距
    expect(css).toMatch(
      /\.ui-test-editor-document \{[^}]*padding:\s*0 var\(--qmai-body-margin-x, var\(--qmai-body-margin-x-fallback\)\)/,
    )
    expect(css).toMatch(/1\.25rem\/1\.75rem\s+var\(--serif\)/)
    /*
     * 正文字号必须是**单一来源变量**，不再是字面量 1.125rem/1.95。
     * 原来的断言（正则直接匹配 1.125rem/1.95）在这里被有意替换：
     * 字面量会让「正文字号」设置完全失效，也会让查找高亮层与输入层
     * 各写一份取值 —— 今天相同、改一处就错位（高亮框与文字偏移）。
     * 新断言比原来更强：它同时钉住"引用变量"与"不得再出现字面量"。
     */
    expect(css).toMatch(/font:\s*400\s+var\(--qmai-body-font-size\)\/var\(--qmai-body-line-height\)\s+var\(--serif\)/)
    expect(css).not.toMatch(/1\.125rem\/1\.95\s+var\(--serif\)/)
    expect(css).toContain("text-indent: 2em")
    expect(css).toMatch(/:is\(h1, h2, h3, h4, h5, h6, li/)
  })

  it("正文保留光标而非整框焦点，列表排除段首缩进并消除主题蓝点", () => {
    expect(css).toMatch(/\[data-writing-editor\] textarea:focus-visible[\s\S]*?outline:\s*none/)
    expect(css).toContain('text-indent: 2em each-line')
    expect(css).toContain('[data-ui-test-frontmatter]')
    expect(css).toMatch(/\.ProseMirror, \[dir\]\[lang\]\) li::marker[^}]+color: var\(--ui-ink\)/)
    expect(css).toMatch(/\.ProseMirror, \[dir\]\[lang\]\) li p[^}]+text-indent: 0/)
  })

  it("正文查找高亮与输入层共用同一个字号与行高变量，避免样式修正后偏位", () => {
    // 原来只断言"行高是字面量 1.95"；现在两者都必须是同一个变量的引用，
    // 否则覆盖在 textarea 之上的高亮层会与输入文字错位
    expect(css).toMatch(/\[data-find-highlights\][^{]*\{[^}]*font-size:\s*var\(--qmai-body-font-size\)/)
    expect(css).toMatch(/\[data-find-highlights\][^{]*\{[^}]*line-height:\s*var\(--qmai-body-line-height\)/)
    expect(css).toMatch(/data-ui-test-indent="visual"[^}]+\[data-find-highlights\][^{]*\{[^}]*text-indent:\s*2em/)
  })

  it("字间距在正文层与输入层引用同一个变量，且全文件没有写死的字间距", () => {
    /*
     * ⚠ 这条断言原来的命题是**错的**。它写「只声明一处，靠继承保证输入层与
     * 高亮层取值必然相同」，并且只数了 `letter-spacing: var(...)` 出现 1 次。
     * 实测（Blink）：**继承到不了原生 textarea** —— UA 样式表给表单控件声明了
     * `letter-spacing: normal`，而任何声明都胜过继承。父级 2px 时
     * div 读回 2px、textarea 读回 normal，加 `letter-spacing: inherit` 才回 2px。
     *
     * 那条「恰好 1 处」的断言验的是「这个变量表达式只出现了一次」，
     * 而不是「输入层与高亮层取值相同」—— 后者 jsdom 也验不了。
     * 它把一个**碰巧**成立的状态写成了**构造上必然**成立。
     *
     * 现在改成两条都成立的命题：
     *   ① 正文层与输入层各自显式引用**同一个变量**（同源 ⇒ 不可能漂移）；
     *   ② 全文件任何 letter-spacing 声明都不得写死值（写死才会错位）。
     * 不断言声明数量：多一处同源声明无害，少一处才是缺陷。
     */
    const VAR = "var(--qmai-body-letter-spacing, 0)"
    /*
     * ⚠ 必须先把 CSS 的块注释挖掉再扫。
     * 下面那条注释里就写着「UA 样式表给它声明了 letter-spacing: normal」——
     * 不挖注释的话，这条**注释本身**会被当成一处「写死的字间距」而报假红。
     * （同一个坑本会话在 check-css-var-contract.mjs 上已经踩过一次：
     *  它把只出现在注释里的旧变量报成「仍在被使用」。）
     */
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "")

    // ① 正文层：div 系（.ProseMirror / [dir][lang] / 高亮层）继承的源头
    expect(code).toMatch(/\.ui-test-root \.ui-test-editor-body \{[^}]*letter-spacing:\s*var\(--qmai-body-letter-spacing, 0\)/)
    // ① 输入层：原生 textarea 不吃继承，必须显式写一次同一个变量
    expect(code).toMatch(/\[data-writing-editor\] textarea[^{]*\{[^}]*letter-spacing:\s*var\(--qmai-body-letter-spacing, 0\)/)

    // ② 全文件不得写死字间距
    const decls = [...code.matchAll(/letter-spacing:\s*([^;}]+)/g)].map((m) => m[1].trim())
    expect(decls.length, "应至少在正文层与输入层各声明一次").toBeGreaterThanOrEqual(2)
    for (const d of decls) {
      expect(d, `字间距必须引用同一个变量，不能写死值（写死会让输入层与高亮层错位）：${d}`).toBe(VAR)
    }
  })

  it("列表行高跟随行间距变量，标题与表格保持固定", () => {
    /*
     * 列表三行都必须**引用**行高变量：只改 p 的话列表行距不动，
     * 用户会觉得「行间距只对一半文字有效」。
     *
     * ⚠ 这里原来是两条**空转**的断言，被一条变异实测抓住（M4b）：
     *   · `for (const selector of […]) expect(css.indexOf(selector)).toBeGreaterThan(-1)`
     *     —— 只证明"这三个选择器出现过"，它们在文件里有几十处匹配，
     *        跟它们的 line-height 是什么**完全无关**；
     *   · `expect(css).not.toMatch(/…line-height: 1\.9/)`
     *     —— **否定式只排除一种错误写法**：把 li 的行高换成 1.8 / 2.0 / 1.95
     *        等任何别的写死值，全套测试 47 passed 照样绿。
     * 实测：把 li 的行高改成 `1.8`，`Tests 47 passed (47)`。
     *
     * 改成**正面**断言：三种列表形态（`:is(ul, ol)` / `li` / `li p`）
     * 各自必须写成
     * `font-size: var(--qmai-body-font-list); line-height: var(--qmai-body-line-height);`。
     * 这样断言绑定的是"写法"，而不是"某个坏值没出现"。
     */
    /*
     * 断言写成"按行筛出 + 逐个选择器核对"，而不是一个大正则。
     * 原因：`:is(ul, ol) {` 在文件里出现两次（另有一处 margin/padding 规则，
     * 与行高无关），用 `[^}]*` 拼的正则要依赖回溯才绕得过去，很脆。
     * 先按"引用了列表字号的规则行"筛，再核对选择器，意图也更直白。
     */
    const LIST_DECL = "font-size: var(--qmai-body-font-list)"
    const LINE_VAR = "line-height: var(--qmai-body-line-height)"
    const listLines = css.split(/\r?\n/).filter((l) => l.includes(LIST_DECL))

    /*
     * ⚠ 这里原来还有三条**数量**断言（共 4 条 / 接行高 3 条 / 不接 1 条）。
     * 评审实测指出它们是**过度约束**：给正文加一条同样接上行高变量的新列表规则
     * （例如再补一层 `.ProseMirror ul ol`）就会让总数变 5 而**误报红**，
     * 而那两处改动语义完全正确。
     *
     * 更要紧的是：数量断言的鉴别力是**多余**的。下面三条逐选择器的
     * `hit.length === 1` 已经抓住了全部已知变异 ——
     * 复制规则会让 hit 变 2，删规则会让 hit 变 0，写死值则让最后那条兜底断言报红。
     * 所以删掉数量、保留结构，误报更少而抓到的缺陷一个不少。
     *
     * 「允许的例外」也从"恰好一条且是 ::marker"改成**正面表述**：
     * 凡引用了列表字号却不接行高变量的，都必须是 ::marker。
     * 这样新增一条正确的列表规则不会误报，而"新增一条漏了行高的"仍会被抓住。
     */
    // 三块**各自**都要接上，而不是"某处有变量就算数"
    for (const selector of [":is(ul, ol) {", " li {", " li p {"]) {
      const hit = listLines.filter((l) => l.includes(selector) && l.includes(LINE_VAR))
      expect(hit.length, `应有且只有一条 ${selector.trim()} 规则同时引用列表字号与行高变量`).toBe(1)
    }

    // 唯一允许不接行高的是有序列表标记 `ol > li::marker` ——
    // 它只按字号取尺寸，标记本身没有行距概念。
    const withoutLineHeight = listLines.filter((l) => !l.includes(LINE_VAR))
    expect(
      withoutLineHeight.filter((l) => !l.includes("::marker")),
      "凡引用列表字号却不接行高变量的，都必须是有序列表标记 ::marker",
    ).toEqual([])

    // 任何"列表字号 + 写死行高"的组合都不许留
    expect(css).not.toMatch(/font-size: var\(--qmai-body-font-list\); line-height: [\d.]/)

    /*
     * 已确认的边界：标题 1.6、表格 1.7 不跟随行间距（这是有意固定，不是漏改）。
     * 表格那条原来写的是裸串 /line-height: 1\.7;/ —— 全文件任何一处 1.7 都能满足它，
     * 与"表格"这个命题无关（评审点名的同型问题）。改成锚住表格选择器。
     */
    expect(css).toMatch(/:is\(h2, h3, h4, h5, h6\) \{[^}]*font: 600 var\(--qmai-body-font-size\)\/1\.6 var\(--ui\)/)
    expect(css).toMatch(/:is\(th, td\) \{[^}]*line-height: 1\.7;/)
    // 且表格与标题都不许改跟行高变量（那会让"固定"这个决定被悄悄推翻）
    expect(css).not.toMatch(/:is\(th, td\) \{[^}]*line-height: var\(--qmai-body-line-height\)/)
    expect(css).not.toMatch(/:is\(h2, h3, h4, h5, h6\) \{[^}]*\/var\(--qmai-body-line-height\)/)
  })

  it("底部安全距离与左右边距都是变量，没有写死的数字残留", () => {
    // 改造前是 padding-bottom: 36px（窄屏另有 28px），两处独立数字正是"不可调"的根源
    expect(css).toMatch(/\.ui-test-editor-scroll \{[^}]*padding-bottom:\s*var\(--qmai-body-safe-bottom, 51px\)/)
    expect(css).not.toContain("padding-bottom: 36px")
    expect(css).not.toContain("padding-bottom: 28px")
    // 左右边距挂在正文容器上：挂在外层的话，800px 上限会让滑块在宽窗口下看起来没反应
    expect(css).toMatch(/\.ui-test-editor-document \{[^}]*padding:\s*0 var\(--qmai-body-margin-x, var\(--qmai-body-margin-x-fallback\)\)/)
    expect(css).toMatch(/\.ui-test-root \.ui-test-editor \{[^}]*padding:\s*0;/)
  })

  /**
   * CSS 的兜底 clamp 与 font-settings 里的常量必须是同一组数。
   *
   * 为什么要拿常量拼出期望串、而不是把 "clamp(20px, 4vw, 48px)" 抄一遍：
   * 抄一遍的话，改常量时这条断言照样绿，而设置页显示给用户的
   * 「当前实际边距」会与真实渲染不符 —— 界面在说谎，且没有任何红灯。
   * 用常量拼串才能让漂移变成一个失败的测试。
   */
  it("左右边距的 CSS 兜底值与 font-settings 的常量一致", () => {
    const expected = `clamp(${BODY_MARGIN_X_VIEWPORT_MIN}px, ${BODY_MARGIN_X_VIEWPORT_VW}vw, ${BODY_MARGIN_X_VIEWPORT_MAX}px)`
    /*
     * 常量的落点从「使用点内联」改成了「定义 fallback 变量」：
     * 因为正文容器的 padding **与 max-width** 都要用同一个默认边距
     * （max-width = 800px + 2×默认边距，见 max-800 那条用例）。
     * 抄两遍就会漂 —— 所以只定义一次，两处都引用它。
     * 链条是：常量 → --qmai-body-margin-x-fallback → padding 与 max-width。
     * 使用点是否引用它，由另外两条用例覆盖。
     */
    expect(css).toContain(`--qmai-body-margin-x-fallback: ${expected};`)
    // 同一个表达式在设置页算出的值必须与实际渲染一致
    expect(defaultBodyMarginXForViewport(1000)).toBe(40)
  })

  it("窄屏媒体查询里不再有会盖掉 padding 的规则", () => {
    /*
     * 为什么这条必须有：基规则上的 padding: 0（Step 2）与
     * @media (max-width: 640px) 里的 .ui-test-root .ui-test-editor { padding: 0 20px; }
     * **特异性完全相同**，而后者在文件更后面 —— 于是在 ≤640px 时它会把
     * padding 覆盖回去：用户把左右边距拖到最小，窄窗口里仍残留 20px，
     * 就是本计划要根除的「设了没反应」。
     * 上面那条断言只钉基规则（[^}]*padding:\s*0;），留着这条媒体查询它照样绿 ——
     * 实测确认过：删掉这条规则**没有任何红灯**。补这一条才让它变红。
     * （这与 Task 5 的依赖数组缺口同型：都是"已知但没钉住"。）
     */
    const at = css.indexOf("@media (max-width: 640px)")
    expect(at, "应还有窄屏媒体查询").toBeGreaterThan(-1)
    // 按大括号配对切出该媒体查询的块体，而不是用正则猜到哪里结束
    const open = css.indexOf("{", at)
    let depth = 0
    let end = -1
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++
      else if (css[i] === "}") { depth--; if (depth === 0) { end = i; break } }
    }
    expect(end, "应能找到该媒体查询的收尾大括号").toBeGreaterThan(-1)
    const block = css.slice(open, end)
    /*
     * 反面断言必须**按结构**写，不能只钉历史字面值。
     *
     * 原来写的是 `not.toMatch(/\.ui-test-root \.ui-test-editor \{/)` 加两条
     * 全文件 `not.toContain("padding-bottom: 36px"/"28px")` —— 只排除了
     * 历史上那一种写法。实测三种注入全部**照样绿**：
     *   · 媒体查询里加 `.ui-test-editor-scroll { padding-bottom: 30px; }`
     *   · 媒体查询里加 `.ui-test-editor-document { padding: 0 20px; }`
     *     （这条最凶：它把本任务刚做的可调边距整体短路）
     *   · 文件末尾再追加一条 `.ui-test-editor { padding: 0 20px; }`
     *     （特异性相同、位置更后，层叠上真的生效）
     * 这正是本提交自己总结的「否定式只排除一种坏值」，只是当时没修到这里。
     *
     * 现在按结构钉：.ui-test-editor / -document / -scroll 三者的规则里，
     * **任何 padding 都必须引用我们那两个变量**（或就是基规则的重置 0）。
     * 这样换值、换层、换位置都盖不住。
     *
     * ⚠ 第一版「允许重置 0」的条件写成 /^0(;|\s|$)/ —— 它把 `0 20px` 也放过了
     * （`0` 后面正好跟一个空格）。实测：上面第 2、3 种注入**照样全绿**，
     * 而这个脚本的变异表把它们标成"未抓住"才发现。
     * 「看起来在防、实际漏掉最凶的那两种」比不写这条更坏。
     * 现在改成**全部组件都是 0** 才算重置（`0` / `0 0` / `0 0 0 0`），
     * 且必须先挖掉 CSS 注释，避免注释里的字样被当成规则。
     */
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "")
    const EDITOR_RULES = /\.ui-test-root \.ui-test-editor(-document|-scroll)?\s*\{([^}]*)\}/g
    const offenders: string[] = []
    for (const m of code.matchAll(EDITOR_RULES)) {
      const pad = m[2].match(/padding(?:-(?:top|right|bottom|left))?:\s*([^;]+)/)
      if (!pad) continue
      const value = pad[1].trim()
      const isPureZero = /^0(\s+0)*$/.test(value)          // 0 / 0 0 / 0 0 0 0
      const usesOurVar = /var\(--qmai-body-(safe-bottom|margin-x)/.test(value)
      if (isPureZero || usesOurVar) continue
      offenders.push(`${m[0].split("{")[0].trim()} → padding: ${value}`)
    }
    expect(
      offenders,
      `这三个容器里的 padding 必须引用变量，写死就会在某种窗口宽度下悄悄盖掉用户的设置：\n${offenders.join("\n")}`,
    ).toEqual([])

    // 正面：顶部标题那条规则要留着 —— 防止"把整个媒体查询删掉"冒充通过
    expect(block).toContain(".ui-test-editor-header")
    // 正面：标题的 padding-top 必须仍在（上面那条结构断言把它排除了，这里补上）
    expect(block).toMatch(/\.ui-test-root \.ui-test-editor-header \{ padding-top: var\(--ui-heading-top\); \}/)
  })

  it("5 个 App 独占变量不许在任何 CSS 里被声明，只能用 var(…, 兜底) 取用", () => {
    /*
     * 为什么这条要**全仓扫描**，而不是只看某一个文件：
     *
     * 这 5 个变量的唯一合法写入方是 App（写在 documentElement 的行内样式上，
     * 见 App.tsx 的 applyBodyTypography effect）。一旦哪条 CSS 规则把它们
     * **声明**出来，就会出现本计划反复要根除的那个症状 ——
     * 「设置保存了但界面不变」：宿主规则比 html 更近时（.ui-test-root 就是，
     * 见 ui-test.css 顶部那句注释），继承下来的 App 值会被本规则盖掉。
     *
     * 这个坑此前**没有任何断言拦着**：Task 6 的实现者做了变异 M3
     * （在 .ui-test-root 里加一行 --qmai-body-font-px: 20px），
     * 全仓 699 个测试文件没有一个变红。也就是说它今天没人踩，
     * 只是也没有任何东西阻止别人明天踩。
     *
     * 为什么不写成"检查某个文件的某一段"：声明可以出现在任何一个 CSS 里
     * （index.css、ui-test-tools.css、将来新增的都能放）。漏一个文件
     * 等于没防，所以按目录递归全扫。
     *
     * 兜底值不是"不许有"，而是**必须写成使用点的第二个参数**
     * var(--qmai-body-font-px, 18px)。那条路径不参与层叠，是安全的。
     */
    const APP_EXCLUSIVE_BODY_VARS = [
      "--qmai-body-font-px",
      "--qmai-body-leading",
      "--qmai-body-letter-spacing",
      "--qmai-body-margin-x",
      "--qmai-body-safe-bottom",
    ]

    const cssFiles: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith(".css")) cssFiles.push(full)
      }
    }
    walk(resolve(__dirname, "..", ".."))   // src/
    expect(cssFiles.length, "应当扫到多个 CSS 文件（扫不到说明路径写错了）").toBeGreaterThan(3)

    const violations: string[] = []
    for (const file of cssFiles) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/)
      for (const [index, line] of lines.entries()) {
        for (const name of APP_EXCLUSIVE_BODY_VARS) {
          // 声明形态：行首（允许缩进）就是「变量名 + 冒号」
          if (new RegExp(`^\\s*${name}\\s*:`).test(line)) {
            violations.push(`${relative(resolve(__dirname, "..", ".."), file)}:${index + 1}  ${line.trim()}`)
          }
        }
      }
    }
    expect(
      violations,
      `这 5 个变量由 App 独占：声明它们会被更近的宿主规则盖掉，表现为"设置保存了但界面不变"。\n` +
        `要表达默认值，请写成使用点的第二个参数 var(--qmai-body-xxx, 兜底值)。`,
    ).toEqual([])
  })

  it("表格/引用/代码块在编辑态有骨架，且单元格不受正文段首缩进影响", () => {
    // 导入的设定集在编辑态摊成纯文字：gfm 解析出了 <table>，但编辑态没有边框和内边距。
    // 断言按"单行片段"来写，避免依赖换行符（本文件是 CRLF）。
    expect(css).toContain(".ui-test-root .ui-test-editor-body .ProseMirror table,")
    expect(css).toMatch(
      /\.ui-test-root \.ui-test-editor-body \.milkdown table \{ width: 100%; margin: 0 0 16px; border-collapse: collapse; \}/,
    )
    expect(css).toMatch(
      /\.ui-test-root \.ui-test-editor-body \.milkdown :is\(th, td\) \{ border: 1px solid var\(--ui-line\); padding: 6px 12px;/,
    )
    expect(css).toMatch(
      /\.ui-test-root \.ui-test-editor-body \.milkdown th \{ background: var\(--ui-soft\); font-weight: 600; \}/,
    )
    expect(css).toMatch(
      /\.ui-test-root \.ui-test-editor-body \.milkdown blockquote \{ margin: 0 0 16px; border-left: 3px solid var\(--ui-accent\); background: var\(--ui-panel\);/,
    )
    expect(css).toMatch(
      /\.ui-test-root \.ui-test-editor-body \.milkdown pre \{ margin: 0 0 16px; border: 1px solid var\(--ui-line\);/,
    )

    /*
     * 关键：单元格内 `> p` 的重置必须比上面
     * `.ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) p`
     * 更具体。那条是 0,4,1（两个 class + :is 里最具体的 [dir][lang] 两个属性 → b=4，
     * 再加元素 p），所以这里凑到 0,4,2：.tableWrapper + table + :is(th,td) + p。
     * 只断言"写了这条规则"不够——选择器写弱了规则照样在文件里，
     * 只是会被上面那条盖掉、表格里每格文字仍缩进两字，所以连 .tableWrapper
     * 与 table 两层一起钉住。
     */
    expect(css).toContain(
      ".ui-test-root .ui-test-editor-body .ProseMirror .tableWrapper table :is(th, td) > p,",
    )
    expect(css).toMatch(
      /\.ui-test-root \.ui-test-editor-body \.milkdown \.tableWrapper table :is\(th, td\) > p \{ margin: 0; text-indent: 0; \}/,
    )

    // 正文段落本身的 2em 缩进不能被这次修改动到；行高必须是变量引用 ——
    // 写死 1.95 会让「行间距」这个设置对正文段落完全失效。
    expect(css).toMatch(
      /:is\(\.ProseMirror, \[dir\]\[lang\]\) p \{ margin: 0 0 16px; line-height: var\(--qmai-body-line-height\); text-indent: 2em; \}/,
    )
  })

  it("全部选择器受ui-test-root约束，长标题、窄屏、菜单都不溢出", () => {
    expect(css).toContain(".ui-test-root .ui-test-editor")
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/[^{}]+(?=\{)/g) ?? []
    expect(selectors.length).toBeGreaterThan(5)
    for (const selector of selectors.filter((item) => !item.trim().startsWith("@"))) {
      expect(selector.trim()).toMatch(/^\.ui-test-root /)
    }
    expect(css).toContain("overflow-wrap: anywhere")
    expect(css).toContain("min-width: 0")
    expect(css).toContain("--available-height")
  })
})