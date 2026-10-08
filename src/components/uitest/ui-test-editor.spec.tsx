// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act, createRef, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PreviewPanel } from "@/components/layout/preview-panel"
import { useWikiStore } from "@/stores/wiki-store"
import { useOutlineGenerationStore } from "@/stores/outline-generation-store"
import { countChapterBodyWords } from "@/lib/chapter-word-count"
import { UiTestEditor } from "./ui-test-editor"

const fixture = vi.hoisted(() => ({
  enabled: true,
  files: new Map<string, string>(),
  write: vi.fn(),
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

  it("章节显示去AI味、提取记忆、查看记忆和一键排版", async () => {
    await mount()
    const toolbar = container.querySelector('.ui-test-editor-toolbar')!
    expect(button("去AI味", toolbar).disabled).toBe(false)
    expect(button("提取记忆", toolbar).disabled).toBe(false)
    expect(button("查看记忆", toolbar).disabled).toBe(false)
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

  it("加载文件不显示常驻底部状态，异步保存中只显示必要提示", async () => {
    await mount()
    const status = () => container.querySelector('[data-ui-test-save-state]')
    expect(container.querySelector(".ui-test-editor-footer")).toBeNull()
    expect(container.textContent).not.toContain("已从本地读取")
    expect(container.textContent).not.toContain("大纲字数")
    vi.useFakeTimers()
    let finishWrite!: () => void
    fixture.write.mockImplementation(() => new Promise<void>((resolve) => { finishWrite = resolve }))
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-writing-editor] textarea')!
    await act(async () => { changeTextarea(textarea, `${textarea.value}新内容。`) })
    expect(status()?.textContent ?? "").toContain("等待自动保存")
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(status()?.textContent ?? "").toContain("正在保存")
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
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    const status = container.querySelector('[data-ui-test-save-state]')
    expect(status?.textContent ?? "").toContain("保存失败")
    expect(status?.textContent ?? "").not.toContain("已保存")
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
    expect(fixture.write).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
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
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await act(async () => { changeTextarea(textarea, `${textarea.value}第二笔。`) })
    await act(async () => { finishWrite() })
    expect(container.querySelector('[data-ui-test-save-state]')?.textContent).toContain("等待自动保存")
  })

  it("外部修改冲突不报成功，也不改变原冲突写入策略", async () => {
    await mount()
    vi.useFakeTimers()
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-writing-editor] textarea')!
    await act(async () => { changeTextarea(textarea, `${textarea.value}本地修改。`) })
    fixture.files.set(chapterPath, `${chapter}外部修改。`)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
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
    expect(labels).toEqual(["去AI味", "提取记忆", "查看记忆", "一键排版"])
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
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(container.querySelectorAll(".ui-test-editor-draft-hint")).toHaveLength(1)
    await act(async () => { changeTextarea(textarea, `${textarea.value}又写了一句。`) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(container.querySelectorAll(".ui-test-editor-draft-hint")).toHaveLength(1)
    await click("知道了")
    expect(container.querySelector(".ui-test-editor-draft-hint")).toBeNull()
    await act(async () => { changeTextarea(textarea, `${textarea.value}再写。`) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
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
    expect(css).toMatch(/max-width:\s*800px/)
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

    // 正文段落本身的 2em 缩进不能被这次修改动到。
    expect(css).toMatch(
      /:is\(\.ProseMirror, \[dir\]\[lang\]\) p \{ margin: 0 0 16px; line-height: 1\.95; text-indent: 2em; \}/,
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