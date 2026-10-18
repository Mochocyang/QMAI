// @vitest-environment jsdom

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import postcss from "postcss"
import { act, createRef, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import { PreviewPanel } from "@/components/layout/preview-panel"
import { saveNovelConfig } from "@/lib/project-store"
import { useWikiStore } from "@/stores/wiki-store"
import { useOutlineGenerationStore } from "@/stores/outline-generation-store"
/*
 * ⚠️ `countChapterBodyWords` 的 import 已删除（用户要求删掉标题行的字数）。
 *
 * 它原来只服务一条断言：「标题行 meta 里显示 `${countChapterBodyWords(chapter)} 字`」。
 * 那句话里的字数取自**磁盘正文**（chapter 常量），不是喂给组件的 `wordCount` ——
 * 也就是说那条断言其实是在证明「meta 显示的是本文正文的真实字数」。
 * meta 整个删掉之后，这个函数在本文件里没有别的用途。
 *
 * 字数本身没有被删掉，只是换了地方：章节列表（knowledge-tree）照旧显示，
 * `buildChapterEditorHeader` 也照旧算 `wordCountLabel`
 * （`chapter-editor-header.test.ts` 仍在钉它）。
 */
import { DRAFT_MEMORY_HINT_MESSAGE } from "@/lib/draft-memory-hint"
import { CHAPTER_AUTOSAVE_INTERVAL_MS, flushPendingChapterSave } from "@/lib/chapter-save-flush"
import {
  BODY_MARGIN_X_VIEWPORT_MAX,
  BODY_MARGIN_X_VIEWPORT_MIN,
  BODY_MARGIN_X_VIEWPORT_VW,
  DEFAULT_BODY_FONT_PX,
  DEFAULT_BODY_LINE_HEIGHT,
  DEFAULT_BODY_SAFE_BOTTOM,
  defaultBodyMarginXForViewport,
} from "@/lib/font-settings"
import { UiTestEditor } from "./ui-test-editor"

const fixture = vi.hoisted(() => ({
  enabled: true,
  files: new Map<string, string>(),
  write: vi.fn(),
  /*
   * 磁盘上已有的章节记忆快照号（`.novel/snapshots/NNN.snapshot.json`）。
   *
   * 默认空 = 一章都没提取过记忆 —— 所以默认情况下每一章的徽章都是「草稿」，
   * 这与改造前的 fixture 行为不同（那时徽章读文件里的 chapter_status）。
   * 要表达"这一章提取过记忆"，就往这里塞号，见 `listDirectory` 的 mock。
   */
  snapshotChapters: [] as number[],
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

/*
 * 只替换 `IS_UI_TEST_BUILD`，其余导出（如 `readUiTestSkin`）必须保留 ——
 * 大纲有伴生 HTML 时本文件会渲染 `OutlineDualPreview`，它经
 * `useDocumentAppearance` 读 `readUiTestSkin()`；整模块替换会让那条链在没有
 * 该导出时直接抛错，和被测行为无关。
 */
vi.mock("@/lib/ui-test", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ui-test")>(),
  get IS_UI_TEST_BUILD() { return fixture.enabled },
}))
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
  /*
   * ⚠️ 这里必须**按路径**回答，不能一律返回 []。
   *
   * 标题行徽章与侧栏绿点现在都问「`.novel/snapshots/` 里有没有这一章的快照」，
   * 所以在测试里造出"提取过记忆的章节"只能靠这个 mock。
   * 其它目录照旧返回 []，既有用例的行为一个字都没变。
   */
  listDirectory: vi.fn(async (path: string) => (
    path.replace(/\\/g, "/").endsWith("/.novel/snapshots")
      ? fixture.snapshotChapters.map((number) => ({
        name: `${String(number).padStart(3, "0")}.snapshot.json`,
        path: `${path}/${String(number).padStart(3, "0")}.snapshot.json`,
        is_dir: false,
      }))
      : []
  )),
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
  fixture.snapshotChapters = []
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

  it("删除冗余面包屑，标题行只留状态徽章", async () => {
    await mount()
    const breadcrumb = container.querySelector('[aria-label="文档位置"]')
    expect(breadcrumb).toBeNull()
    expect(container.querySelector("h1")?.textContent ?? "").toContain("第16章 实际章名")
    /*
     * ⚠️ 这条断言**方向变了**，如实记下以免后来者翻回去。
     *
     * 原来它叫「删除冗余面包屑但保留真实标题、状态和字数」，并且断言
     * `.ui-test-editor-meta` 里有「草稿」与「N 字」。用户要求
     * 「删除标题中显示的正式章节字数」，于是整个 `.ui-test-editor-meta`
     * 连同里面的状态文字一起删掉了 —— 状态改由标题**前面**的
     * 直角实心徽章承担（`.ui-test-editor-badge`）。
     *
     * 所以现在钉的是三件事：面包屑没有了、真标题还在、
     * **旧的字数容器与旧的状态 span 都不许复活**。
     * 只断言"徽章在"是不够的：有人把 meta 加回来当"补充信息"，
     * 用户看到的正是他要求删掉的那行字。
     */
    expect(container.querySelector(".ui-test-editor-meta")).toBeNull()
    expect(container.querySelector(".ui-test-editor-status")).toBeNull()
    expect(container.textContent).not.toContain(" 字")
    const badge = container.querySelector(".ui-test-editor-badge")
    expect(badge?.textContent).toBe("草稿")
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

  /*
   * 按钮文案跟**记忆**走，与标题行徽章同一口径。
   *
   * 改造前它读文件里的 `chapter_status`：一个写着 final、却从未提取过记忆的章节
   * （第 6、15 章的现场）会同时呈现「草稿」徽章和「重新提取记忆」按钮 ——
   * 同一行两个互相矛盾的信号。用户报的正是这类矛盾。
   */
  it("已提取记忆的章节显示重新提取记忆", async () => {
    fixture.files.set(chapterPath, chapter.replace("chapter_status: draft", "chapter_status: final"))
    fixture.snapshotChapters = [16]
    await mount()
    expect(container.querySelector('[aria-label="更多编辑器操作"]')).toBeNull()
    button("重新提取记忆", container.querySelector(".ui-test-editor-toolbar")!)
  })

  /*
   * 文件写着 final 但磁盘上没有快照 → 徽章与按钮都按「未提取」说话。
   * 按钮仍必须可用（点下去走 handleReingest 直接提取），不能因为文案变了就失效。
   */
  it("写了 final 但没有快照的章节显示提取记忆，且按钮可用", async () => {
    fixture.files.set(chapterPath, chapter.replace("chapter_status: draft", "chapter_status: final"))
    await mount()
    const target = button("提取记忆", container.querySelector(".ui-test-editor-toolbar")!)
    // 本仓库没装 jest-dom，用原生属性断言（`toBeDisabled` 不存在）。
    expect(target.disabled).toBe(false)
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

  /*
   * 大纲有同名 .html 伴生文件时，打开文档默认就是 HTML 模式（iframe 占满），
   * 原先「提取记忆 / 查看记忆」只挂在 MD 编辑器工具栏上 → HTML 视图下两枚
   * 按钮凭空消失，用户找不到入口。现在它们挪到顶栏、紧挨 HTML / MD 标识。
   */
  it("大纲的 HTML 视图下也能看到提取记忆 / 查看记忆 / 字体设置（挨着 HTML / MD）", async () => {
    fixture.files.set(
      outlinePath.replace(/\.md$/i, ".html"),
      "<!DOCTYPE html><html><body><h1>折叠树</h1></body></html>",
    )
    await mount(outlinePath)

    expect(container.querySelector("iframe"), "默认应是 HTML 模式").not.toBeNull()
    const bar = container.querySelector("[data-outline-dual-actions]")
    expect(bar, "HTML / MD 标识旁应有操作区").not.toBeNull()
    button("提取记忆", bar!)
    button("查看记忆", bar!)
    /*
     * 「字体设置」与记忆两枚同批上移（用户要求「将字体设置图标也移上去」）：
     * HTML 模式下它原先整条工具栏被 iframe 顶掉，也就一起消失了。
     */
    button("字体设置", bar!)

    /* 切到 MD：三枚按钮仍留在顶栏，编辑器工具栏里不再重复一份 */
    await click("MD")
    const toolbar = container.querySelector(".ui-test-editor-toolbar")
    expect(toolbar, "MD 模式应渲染编辑器工具栏").not.toBeNull()
    expect(button("提取记忆").closest("[data-outline-dual-actions]"), "提取记忆应仍在顶栏").not.toBeNull()
    expect(toolbar!.querySelector('[aria-label="提取记忆"]')).toBeNull()
    expect(toolbar!.querySelector('[aria-label="查看记忆"]')).toBeNull()
    expect(toolbar!.querySelector('[aria-label="字体设置"]')).toBeNull()
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
     *
     * 这条**完整列举**的断言每次工具栏变动都会红一次，那是它的价值：
     * 它冻结工具栏的组合与顺序。放宽成"包含这几项即可"之后，
     * 误删一个按钮、或两个按钮换了位置都不会被发现。
     *
     * ── 本次（用户定稿截图）改了两处顺序/组成 ──
     * 1. **删掉**「文风写作」（`WritingStylePicker`）。
     *    用户原话：「每个章节的上面不需要显示『文风』的图标，将『文风』的图标删除」。
     * 2. 「生成章节细纲」**移到整排最右**（原话「将章节细纲移动到最右侧」）。
     *    它原先夹在「字体设置」与「一键排版」之间，
     *    所以这次不是简单地少一项，而是**尾三项重排**。
     *
     * 现顺序 = 记忆组（去AI味 / 提取记忆 / 查看记忆）→ 设置组（字体设置）
     * → 排版组（一键排版）→ 细纲（最右）。
     */
    expect(labels).toEqual(["去AI味", "提取记忆", "查看记忆", "字体设置", "一键排版", "生成章节细纲"])
    /*
     * 补一条**位置**断言，不只是"在数组里"：
     * 用户要的是"最右侧"，而数组末尾同时也能被下面这种写法满足 ——
     * 用 `aria-label` 兜底排序或加个占位按钮，末位就不是细纲了。
     * 这里直接对最后一枚按钮的 aria-label 提要求，
     * 让"最右"这件事被钉在 DOM 顺序上。
     */
    const last = [...toolbar.querySelectorAll("button.ui-test-editor-action")].at(-1)
    expect(last?.getAttribute("aria-label"), "「生成章节细纲」必须在工具栏最右").toBe("生成章节细纲")
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

  /*
   * ── 草稿提取提示的判据，与徽章同源 ──
   *
   * 提示语本身写着「这一章还是草稿。点击『提取记忆』会先保存为正式章节，
   * 再提取这章记忆」—— 它描述的就是"记忆还没提取"这件事。
   * 所以它读 `chapterHeader.status`（现已由快照决定）才是对的：
   * 文件里写了 final、但磁盘上没有快照的章节**确实**还没提取过记忆，
   * 提示在这里出现是准确的，不是误报。
   */
  it("写了 final 但没提取过记忆的章节：仍然提示先保存再提取", async () => {
    fixture.files.set(chapterPath, chapter.replace("chapter_status: draft", "chapter_status: final"))
    await mount()
    const hint = container.querySelector(".ui-test-editor-draft-hint")
    expect(hint).not.toBeNull()
    expect(hint!.textContent).toContain(DRAFT_MEMORY_HINT_MESSAGE)
  })

  it("已提取记忆的章节不显示草稿提取提示", async () => {
    fixture.files.set(chapterPath, chapter.replace("chapter_status: draft", "chapter_status: final"))
    fixture.snapshotChapters = [16]
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

  /*
   * ── 丙-4a：新章节灵感提示 ──
   *
   * 判据（决定 A）**复用草稿提示那一批输入**：`isChapterPath(selectedFile)` +
   * `countChapterBodyWords(fileContent)`。所以这一组用例全部走真实的 PreviewPanel，
   * 不手写第二份「内容是否为空」的判据 —— 否则会出现「草稿提示认为是空章节、
   * 灵感提示认为不是」的自相矛盾。
   *
   * 与草稿提示的**互斥**由纯函数层穷举证明（src/lib/inspiration-hint.spec.ts）；
   * 这里测的是接线：什么时候挂出来、点了两个按钮各自发生什么。
   */
  const emptyChapterPath = `${project.path}/wiki/chapters/第一卷/第1章.md`
  const emptyChapter = "---\ntype: chapter\nchapter_number: 1\nchapter_status: draft\n---\n\n# 第1章 开篇\n\n"

  function inspirationHint() {
    return container.querySelector(".ui-test-editor-inspiration-hint")
  }

  it("空章节打开时把灵感气泡挂在「生成章节细纲」按钮旁，并在显示时记下 seen", async () => {
    fixture.files.set(emptyChapterPath, emptyChapter)
    await mount(emptyChapterPath)
    const hint = inspirationHint()
    expect(hint?.textContent).toContain("点击这里生成新章节故事灵感")
    const anchor = container.querySelector(".ui-test-editor-action.is-hint-target")
    expect(anchor?.getAttribute("aria-label")).toBe("生成章节细纲")
    expect(anchor?.getAttribute("data-event-outline-target")).toBe("")
    expect(useWikiStore.getState().novelConfig.inspirationHintSeen).toBe(true)
  })

  it("已有正文的章节不出现灵感气泡", async () => {
    await mount()
    expect(inspirationHint()).toBeNull()
  })

  it("用的是实时正文：刚打字，气泡立刻收掉", async () => {
    fixture.files.set(emptyChapterPath, emptyChapter)
    await mount(emptyChapterPath)
    expect(inspirationHint()).not.toBeNull()
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-writing-editor] textarea')!
    await act(async () => { changeTextarea(textarea, `${textarea.value}有人推开了门。`) })
    expect(inspirationHint(), "实时内容已非空，气泡必须立刻收掉").toBeNull()
  })

  /*
   * ── F1 回归（修复批）：两条气泡在**真实接线**下确实会同时挂出来 ──
   *
   * 纯函数层那 432 组合的穷举（`src/lib/inspiration-hint.spec.ts`）把**同一个**
   * `wordCount` 喂给两个函数，所以它证明的只是「同一个 wordCount 下互斥」。
   * 真实接线里两条链喂的**不是**同一个数：
   *   · 草稿链 `wordCount: session.persistedWords ?? 0` —— 只在切章或
   *     `phase === "saved"` 时刷新的**快照**，删字不会刷新它；
   *   · 灵感链 `wordCount: countChapterBodyWords(fileContent)` —— **实时**。
   * 于是「磁盘上还有正文、编辑框刚被清空」时，草稿链看到 >0、灵感链看到 0，
   * 两条气泡一起挂出来 —— 而它们共用 `.ui-test-editor-hint-anchor` 与同一组
   * top/left/width，会**精确重叠**在同一坐标上。
   *
   * 这条用例走的就是那个可达序列：有正文的 `chapter_status: draft` 章 → 清空编辑器。
   * `persistedWords` 在 mount 时被捕获，正是让这个序列可达的原因。
   */
  it("草稿章有正文时清空编辑器：草稿气泡挂着，灵感气泡不得同时挂出，也不得烧掉 seen 预算", async () => {
    await mount()
    expect(
      container.querySelector(".ui-test-editor-draft-hint"),
      "有正文的草稿章，草稿气泡本就在",
    ).not.toBeNull()
    expect(inspirationHint(), "实时正文非空时不该有灵感气泡").toBeNull()
    expect(useWikiStore.getState().novelConfig.inspirationHintSeen, "此刻还没显示过灵感气泡").toBe(false)

    const textarea = container.querySelector<HTMLTextAreaElement>('[data-writing-editor] textarea')!
    await act(async () => { changeTextarea(textarea, "") })

    expect(
      container.querySelector(".ui-test-editor-draft-hint"),
      "清空的是编辑缓冲，磁盘快照仍是有正文的草稿章 —— 草稿气泡必须还在",
    ).not.toBeNull()
    expect(
      container.querySelectorAll(".ui-test-editor-draft-hint, .ui-test-editor-inspiration-hint"),
      "两条气泡共用定位属性，同时挂出会精确重叠 —— 绝不允许同时存在",
    ).toHaveLength(1)
    expect(inspirationHint()).toBeNull()
    expect(
      useWikiStore.getState().novelConfig.inspirationHintSeen,
      "这条灵感气泡用户根本不该看到，不能顺手把「每本书一次」的预算烧掉",
    ).toBe(false)
  })

  it("「知道了」只关气泡：本次会话不再显示、不打开向导、也不写盘关闭", async () => {
    fixture.files.set(emptyChapterPath, emptyChapter)
    await mount(emptyChapterPath)
    await click("知道了")
    expect(inspirationHint()).toBeNull()
    expect(document.querySelector('[role="dialog"]'), "「知道了」不该打开向导").toBeNull()
    expect(useWikiStore.getState().novelConfig.inspirationHintEnabled).toBe(true)
  })

  /*
   * ── F7（修复批）：`session.dismissed` 的**接线**必须自己有一条用例 ──
   *
   * 纯函数层有一条 `dismissed: true → false`（`inspiration-hint.spec.ts`），
   * 但它证明不了 `preview-panel.tsx` 真的把会话里的 `dismissed` 传了下去 ——
   * 把接线改成 `dismissed: false` 或删掉那道门，只跑本文件时**全绿**：
   * 点「知道了」的那一下不会触发重算（`dismissInspirationHint` 只改 ref 与
   * 自己的 state，都不在本 effect 的依赖里），所以「气泡不见了」这个观察
   * 根本不需要 `dismissed` 参与。要观察到差别，必须**再触发一次重算**。
   *
   * 重算的触发方式刻意选「配置被重新读了一遍」：`saveNovelConfig` 是
   * fire-and-forget（`.catch` 只打日志），落盘失败或还没落地时，盘上的
   * `inspirationHintSeen` 仍是 false，而 `settings-view.tsx:320-330` 会
   * 重新 `loadNovelConfig` → `setNovelConfig` 把 store 覆盖回盘上的值。
   * 那一刻唯一还能拦住气泡的就是**本次会话**的 `dismissed`。
   * （用 `setNovelConfig` 这个真实 action 而不是裸 setState，免得测的是别的路径。）
   */
  it("点过「知道了」之后，即使 seen 又从盘上读回 false，本次会话也不再挂出来", async () => {
    fixture.files.set(emptyChapterPath, emptyChapter)
    await mount(emptyChapterPath)
    expect(inspirationHint()).not.toBeNull()
    await click("知道了")
    expect(inspirationHint()).toBeNull()

    await act(async () => {
      useWikiStore.getState().setNovelConfig({ inspirationHintSeen: false })
    })

    expect(
      inspirationHint(),
      "本次会话已经点过「知道了」—— seen 回到 false 也不能再挂出来",
    ).toBeNull()
    /*
     * 第二条兼作**前提检查**：`setNovelConfig({ inspirationHintSeen: false })`
     * 必须真的把 store 写成了 false。若它没生效（比如改成裸 setState 或写错字段），
     * seen 会停在第一次显示时的 true —— 上面那条气泡断言就什么也证明不了，
     * 而这一条会先红。
     */
    expect(
      useWikiStore.getState().novelConfig.inspirationHintSeen,
      "前提：配置确实被重新读成了 false（否则气泡断言证明不了 dismissed 在承重）",
    ).toBe(false)
  })

  /*
   * ── F3（修复批）：`isChapter` 这条接线必须有独立用例 ──
   *
   * 把 `preview-panel.tsx` 的 `isChapter: isChapterPath(selectedFile)`
   * 写死成 `true`，只跑本文件时**全绿** —— 因为别的用例里非章节文件
   * （大纲/设定）都**有正文**，实时字数非 0 本来就挂不出气泡。
   * 所以「非章节的 markdown 不走灵感提示这条链」从没被验证过。
   *
   * ⚠️ 这条用例的**决定性**断言是 `inspirationHintSeen` 而不是气泡本身：
   * 大纲的工具栏里没有 `data-event-outline-target` 那枚锚点按钮
   * （`生成章节细纲` 只在章节分支里），所以就算判定错成 true，气泡也挂不出来
   * —— 只看气泡会得到一条**恒绿**的用例。真正的后果是副作用：
   * 判定错成 true 会**烧掉这本书唯一的一次**灵感提示预算，
   * 用户之后在新章节里再也看不到它。
   *
   * ⚠️ 修复批 2：原来这里还并排留了一句 `expect(inspirationHint()).toBeNull()`
   * 当「第二条」。它**恒绿**（上面刚说了气泡在这里根本挂不出来），
   * 本仓库的标准是「不留恒绿断言」，所以它被**替换**成下面那条**前提断言** ——
   * 断言「这里确实没有锚点」，于是「气泡不可能出现」这条理由本身有人守：
   * 哪天有人给大纲工具栏也加上 `data-event-outline-target`，
   * 这条会红，提醒作者「本用例的气泡断言从此有意义了，得补一条真的」。
   * 而**没有**替换成「大纲上气泡为 null」那种换个说法的恒绿断言。
   */
  it("非章节的 markdown（空大纲）不挂灵感气泡，也不烧掉这本书的 seen", async () => {
    fixture.files.set(outlinePath, "# 空大纲\n\n")
    await mount(outlinePath)
    expect(
      container.querySelector("h1")?.textContent ?? "",
      "前提：空大纲确实被打开了（否则这条只是在测「什么都没渲染」）",
    ).toContain("空大纲")
    /*
     * 前提断言（**可红**，不是恒绿）：大纲工具栏里没有灵感气泡的锚点。
     * 它同时是「本用例不能用气泡当判据」这条结论的依据。
     */
    expect(
      container.querySelector("[data-event-outline-target]"),
      "大纲工具栏里不该有灵感气泡的锚点 —— 一旦有了，本用例就该补一条真的气泡断言"
      + "（在此之前「气泡为 null」在这里没有任何鉴别力，正是它被删掉的原因）",
    ).toBeNull()
    expect(
      useWikiStore.getState().novelConfig.inspirationHintSeen,
      "isChapter 写死 true 时，非章节文件会被当成空章节，把「每本书一次」的预算烧掉",
    ).toBe(false)
  })

  /*
   * ── F5（修复批）：seen 去重（`if (next && !inspirationHintSeen)`）──
   *
   * 显示即记 seen 会让本 effect 因为依赖变化**再跑一次**，那一次 `next` 仍是
   * true（`currentlyVisible` 那一路）。若写成 `if (next)`，每次重算都会
   * 多落一次盘 —— 用户看不见任何区别，只是每次 recompute 都多写一次文件。
   * 把 `!inspirationHintSeen` 删掉，本文件其余用例**全绿**，所以要在这里数调用次数。
   *
   * ⚠️ 修复批 2：计数器原来只按「配置里 `inspirationHintSeen === true`」过滤，
   * 这**分不清是哪条链写的** —— 草稿链那次落盘是
   * `{ ...novelConfig, draftMemoryHintSeen: true }`，展开时会把**当时的**
   * `inspirationHintSeen` 一起带下去；只要它此刻已经是 true（本例里正是如此），
   * 草稿链的一次写盘就会被算成灵感链的。当前夹具恰好绕开了这一点
   * （空章节的草稿链压根不放行），但夹具一改这条断言就会**悄悄失去鉴别力**。
   * 现在改成按「两次快照之间的**调用差值**」判定，并要求那一次落盘**只有**
   * `inspirationHintSeen` 变了 —— 谁写的、写了什么都是显式的。
   */
  it("挂出来只落一次 seen：记完 seen 触发的那次重算不得再写盘", async () => {
    const saveCalls = () => (saveNovelConfig as unknown as Mock).mock.calls as Array<[Record<string, unknown>]>
    fixture.files.set(emptyChapterPath, emptyChapter)
    const configBefore = { ...useWikiStore.getState().novelConfig }
    const before = saveCalls().length
    await mount(emptyChapterPath)
    expect(inspirationHint()).not.toBeNull()
    expect(useWikiStore.getState().novelConfig.inspirationHintSeen).toBe(true)

    const writes = saveCalls().slice(before).map(([config]) => config)
    expect(
      writes,
      "只有在 seen 还是 false 的那一次才该落盘；记完 seen 引发的重算必须跳过（否则每次重算都多写一次文件）",
    ).toHaveLength(1)
    /*
     * 落盘的**归属**：这一笔必须恰好是「灵感 chain 把 seen 记下来」——
     * 与挂载前的配置相比只有一个键变化。草稿链的写盘会同时带上
     * `draftMemoryHintSeen: true`，所以它在这里会以「多了一个变化的键」被抓住，
     * 而不是像旧计数器那样被误认成灵感链那一笔。
     */
    const changed = Object.keys({ ...configBefore, ...writes[0] })
      .filter((key) => !Object.is(
        (configBefore as unknown as Record<string, unknown>)[key],
        writes[0][key],
      ))
    expect(
      changed,
      "这一笔落盘应当**只有** inspirationHintSeen 变了 —— 多出别的键说明它其实是另一条链写的",
    ).toEqual(["inspirationHintSeen"])
    expect(
      writes[0].draftMemoryHintSeen,
      "草稿链的字段不得被灵感链的落盘顺带改写",
    ).toBe(configBefore.draftMemoryHintSeen)
  })

  /*
   * ── F1 修法自己**新造出来**的那个结构事实，必须有一条常驻用例 ──
   *
   * F1 的修法把草稿链与灵感链合进了**同一个** effect（见 preview-panel 里
   * 「草稿气泡与灵感气泡的**唯一**判定点」那段说明），代价是那个 effect 的
   * 依赖数组里多了 `inspirationHintEnabled` / `inspirationHintSeen`。
   * 也就是说：改一个**只属于灵感链**的开关，会让**草稿链**也跟着重跑一遍。
   *
   * 这是修法带来的新结构，而此前**没有任何常驻用例**守它：F1 那条用例走的是
   * 「有正文的草稿章 + 清空编辑框」，全程没动过灵感链独占的输入；评审验这一条
   * 用的是一次性探针（PROBE-B，`inspAtMount=1 draftAfterSave=1 inspAfterSave=0
   * draftAfterFlip=1 inspAfterFlip=0`），跑完就还原了。
   *
   * 下面这条把那条探针**永久化**，序列与它一致：
   *   ① 空章节挂载 → 灵感气泡在（同时把 `inspirationHintSeen` 记成 true）；
   *   ② 打字 + 走完一个自动保存间隔 → `arrival = first-save` → 草稿气泡接手；
   *   ③ 翻转 `inspirationHintEnabled`（灵感链独占的依赖）→ 再翻回来。
   *
   * ⚠️ 这条红了先怀疑**实现**，不要改测试：它要报的是
   * 「灵感链的输入扰动到了草稿链」这个新缺陷。本提交用变异复算过鉴别力 ——
   * 把草稿链的 `enabled` 写成 `draftMemoryHintEnabled && inspirationHintEnabled`
   * （两条链合进一个 effect 之后最像样的那种复制粘贴错），本用例红，
   * 而 F1 那条既有用例**照样绿** —— 它才是这条覆盖缺口的守卫。
   */
  it("翻转灵感链独占的开关（inspirationHintEnabled）不得扰动草稿气泡，两条也不得并存", async () => {
    const draftHint = () => container.querySelector(".ui-test-editor-draft-hint")
    const totalHints = () => container.querySelectorAll(
      ".ui-test-editor-draft-hint, .ui-test-editor-inspiration-hint",
    ).length

    fixture.files.set(emptyChapterPath, emptyChapter)
    await mount(emptyChapterPath)
    // ① 前提：空章节 → 灵感气泡在，草稿气泡不在（磁盘字数还是 0）
    expect(inspirationHint(), "前提：空章节挂载时灵感气泡应当在（这一步会把 seen 记成 true）").not.toBeNull()
    expect(draftHint(), "前提：空章节没有正文，草稿气泡不该在").toBeNull()

    // ② 打字 + 走完一个自动保存间隔：相变 "saved" → 草稿链 arrival = first-save
    vi.useFakeTimers()
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-writing-editor] textarea')!
    await act(async () => { changeTextarea(textarea, `${textarea.value}有人推开了门。`) })
    await act(async () => { await vi.advanceTimersByTimeAsync(CHAPTER_AUTOSAVE_INTERVAL_MS) })
    /*
     * ⚠️ 不能拿 `[data-ui-test-save-state]` 的相位当前提：`saved` 相位的
     * 底部状态区**整个不渲染**（`showFooter` 只认 taskStatus 与有文案的相位），
     * 所以在「已保存」时那个元素根本不存在。
     * 「草稿气泡真的接手了」本身就是最硬的前提 —— 草稿链只在 `phase === "saved"`
     * 时刷新 `persistedWords`（空章节挂载时它是 0），没有那一次 saved，
     * 这个气泡无论如何都出不来。再补一条「落盘真的发生了」当独立佐证。
     */
    expect(fixture.write, "前提：自动保存必须真的落盘").toHaveBeenCalled()
    const draftText = draftHint()?.textContent
    expect(draftText, "前提：保存之后草稿气泡应当接手（实时正文已非空，灵感气泡同时收掉）").toBeTruthy()
    expect(inspirationHint(), "前提：正文已非空，灵感气泡应当已经收掉").toBeNull()
    expect(totalHints(), "两条气泡共用定位属性，任何时刻都不许并存").toBe(1)

    // ③ 翻转灵感链**独占**的依赖。草稿链必须逐项不变。
    for (const enabled of [false, true]) {
      await act(async () => {
        useWikiStore.getState().setNovelConfig({ inspirationHintEnabled: enabled })
      })
      expect(
        useWikiStore.getState().novelConfig.inspirationHintEnabled,
        `前提：开关真的被改成了 ${enabled}（否则下面只是重复断言同一个状态）`,
      ).toBe(enabled)
      expect(
        draftHint()?.textContent,
        `翻转 inspirationHintEnabled=${enabled} 之后草稿气泡必须原样留着 —— `
        + "它是灵感链的输入，草稿链不该被它牵动（F1 把两条链合进了一个 effect，这是那个修法的代价）",
      ).toBe(draftText)
      expect(inspirationHint(), `inspirationHintEnabled=${enabled} 时不该凭空多出灵感气泡`).toBeNull()
      expect(totalHints(), "两条气泡共用定位属性，任何时刻都不许并存").toBe(1)
    }
  })

  it("「不再提醒」写盘关掉设置项，也不打开向导", async () => {
    fixture.files.set(emptyChapterPath, emptyChapter)
    await mount(emptyChapterPath)
    await click("不再提醒")
    expect(inspirationHint()).toBeNull()
    expect(useWikiStore.getState().novelConfig.inspirationHintEnabled).toBe(false)
    expect(document.querySelector('[role="dialog"]'), "「不再提醒」不该打开向导").toBeNull()
  })

  it("写作设置里关掉灵感提示后不再出现", async () => {
    useWikiStore.setState({
      novelConfig: { ...useWikiStore.getState().novelConfig, inspirationHintEnabled: false },
    })
    fixture.files.set(emptyChapterPath, emptyChapter)
    await mount(emptyChapterPath)
    expect(inspirationHint()).toBeNull()
  })

  it("这本书挂过一次之后，切到另一个空章节也不再出现（照 draftMemoryHintSeen 的「每本书一次」）", async () => {
    const secondEmptyPath = `${project.path}/wiki/chapters/第一卷/第2章.md`
    fixture.files.set(emptyChapterPath, emptyChapter)
    fixture.files.set(
      secondEmptyPath,
      emptyChapter.replace("chapter_number: 1", "chapter_number: 2").replace("第1章 开篇", "第2章 承上"),
    )
    await mount(emptyChapterPath)
    expect(inspirationHint()).not.toBeNull()
    expect(useWikiStore.getState().novelConfig.inspirationHintSeen).toBe(true)
    await act(async () => { useWikiStore.setState({ selectedFile: secondEmptyPath }) })
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
    expect(container.textContent).toContain("第2章 承上")
    /*
     * ⚠️ 这一条与实施计划 §4(a) 里「切回一个空章节也会提示」那句**好处说明**
     * 方向相反。最终按同一份计划 (5) 的明文口径实现：「持久化字段照
     * draftMemoryHintEnabled + draftMemoryHintSeen（**每本书一次**），用新字段」。
     * 决定 A 那句话的主语是**判据**（判据是章节自身状态，不是「刚点过新建章节」
     * 这个一次性事件），不是「每章都提示一次」。
     * 若日后要改成每章一次，`seen` 就得按章记录 —— 这里必须同步改。
     */
    expect(inspirationHint()).toBeNull()
  })

  it("决定 B：点「生成章节细纲」向导立即打开，气泡**同时**仍在（气泡不是前置关卡）", async () => {
    fixture.files.set(emptyChapterPath, emptyChapter)
    await mount(emptyChapterPath)
    expect(inspirationHint(), "点按钮之前气泡就该在（判据是章节状态，不是这次点击）").not.toBeNull()
    await click("生成章节细纲")
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog, "点按钮必须立即打开向导").not.toBeNull()
    // 钉住「弹出来的确实是向导」：`handleOpenEventOutlineWizard` 只做一件事
    // （setEventOutlineWizardVisible(true)），而向导自己的标题就是「生成章节细纲」，
    // 里面还有「事件数量」。没有这两句的话，任何别的弹窗都能让上面那条断言变绿。
    expect(dialog?.textContent).toContain("生成章节细纲")
    expect(dialog?.textContent).toContain("事件数量")
    /*
     * ⚠️ 这里刻意断言「两者同时存在」。反过来写（气泡出现时向导必须不存在）
     * 与决定 B 直接相反 —— 见实施计划 §4(a) 的 (6)。
     */
    expect(inspirationHint(), "气泡与向导是并行的，不是二选一").not.toBeNull()
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

/*
 * ── 丙-4a：把 `withDraftMemoryHint` 泛化成 `withAnchoredHint` 之后的行为 ──
 *
 * 泛化的**全部风险**在于「草稿气泡的 DOM 有没有被顺手改掉」：本文件里
 * `.ui-test-editor-draft-hint` 被 ~20 处断言要求「为 null 或长度恰为 1」，
 * 而那 20 处只看类名与文案，看不出包裹层级、`<p>` 包裹、两个按钮的类名是不是变过。
 *
 * 所以这里：
 * 1. 断言两条气泡**各自**出现一次 —— 遍历必须对每个锚点属性各命中一次，
 *    而不是「找到第一个匹配就收工」（那样第二个锚点永远不会被包）；
 * 2. 把草稿气泡的结构逐项钉住（根类名 / role / `<p>` 包裹 / 动作行类名 /
 *    两个按钮的类名 / 文案），让「泛化顺手改了草稿 DOM」这类事故有断言接住。
 */
describe("锚定气泡：两条气泡互不吞并", () => {
  const baseProps = {
    kind: "chapter" as const,
    path: chapterPath,
    title: "第16章 实际章名",
    onTitleCommit: vi.fn(),
    statusLabel: "草稿",
    wordCount: 0,
    moreActions: [] as never[],
    saveState: null,
    taskStatus: "",
    onRetrySave: vi.fn(),
    onClose: vi.fn(),
  }
  const twoAnchoredActions = (
    <>
      <button type="button" className="ui-test-editor-action is-icon-only" data-draft-memory-target="" aria-label="提取记忆">A</button>
      <button type="button" className="ui-test-editor-action is-icon-only" data-event-outline-target="" aria-label="生成章节细纲">B</button>
    </>
  )

  it("只给灵感提示时：只有灵感气泡，且只有被锚定的那枚按钮拿到 is-hint-target", async () => {
    const scrollRef = createRef<HTMLDivElement>()
    const onDismiss = vi.fn()
    const onMute = vi.fn()
    await act(async () => {
      root.render(
        <div className="ui-test-root">
          <UiTestEditor {...baseProps} scrollRef={scrollRef} actions={twoAnchoredActions}
            inspirationHint={{ onDismiss, onMute }}>{() => <p>正文</p>}</UiTestEditor>
        </div>,
      )
    })
    const hint = container.querySelector(".ui-test-editor-inspiration-hint")
    expect(hint?.textContent).toContain("点击这里生成新章节故事灵感")
    expect(container.querySelector(".ui-test-editor-draft-hint")).toBeNull()
    expect(
      hint?.closest(".ui-test-editor-hint-anchor")?.querySelector("button")?.getAttribute("aria-label"),
      "灵感气泡必须挂在「生成章节细纲」那枚按钮旁",
    ).toBe("生成章节细纲")
    const targets = container.querySelectorAll(".ui-test-editor-action.is-hint-target")
    expect(targets).toHaveLength(1)
    expect(targets[0]?.getAttribute("aria-label")).toBe("生成章节细纲")
    await act(async () => {
      hint?.querySelector<HTMLButtonElement>(".ui-test-editor-inspiration-hint-dismiss")?.click()
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it("两条气泡同时传入时各出现一次，草稿气泡的结构逐项不变", async () => {
    const scrollRef = createRef<HTMLDivElement>()
    const onDismiss = vi.fn()
    const onMute = vi.fn()
    await act(async () => {
      root.render(
        <div className="ui-test-root">
          <UiTestEditor {...baseProps} scrollRef={scrollRef} actions={twoAnchoredActions}
            draftMemoryHint={{ onDismiss, onMute }}
            inspirationHint={{ onDismiss, onMute }}>{() => <p>正文</p>}</UiTestEditor>
        </div>,
      )
    })
    expect(container.querySelectorAll(".ui-test-editor-hint-anchor")).toHaveLength(2)
    expect(container.querySelectorAll(".ui-test-editor-action.is-hint-target")).toHaveLength(2)
    expect(container.querySelectorAll(".ui-test-editor-draft-hint")).toHaveLength(1)
    expect(container.querySelectorAll(".ui-test-editor-inspiration-hint")).toHaveLength(1)

    const draft = container.querySelector(".ui-test-editor-draft-hint")!
    expect(draft.getAttribute("role")).toBe("status")
    expect(draft.querySelector("p")?.textContent).toBe(DRAFT_MEMORY_HINT_MESSAGE)
    const actions = draft.querySelector(".ui-test-editor-draft-hint-actions")
    expect(actions?.textContent).toBe("知道了不再提醒")
    const dismissButtons = draft.querySelectorAll("button.ui-test-editor-draft-hint-dismiss")
    expect(dismissButtons).toHaveLength(2)
    expect(dismissButtons[0]?.getAttribute("type")).toBe("button")
    expect(
      draft.closest(".ui-test-editor-hint-anchor")?.querySelector("button")?.getAttribute("aria-label"),
    ).toBe("提取记忆")
  })
})

/**
 * 把 CSS 的块注释整段剥掉。
 *
 * ⚠ 这不是「顺手清一下文本」，而是本文件里**结构断言唯一合法的读取入口**。
 * 完整理由见下面 `测试版正文样式边界` 开头那段（修复批 F4，评审变异 M15）。
 */
function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "")
}

describe("测试版正文样式边界", () => {
  const cssPath = resolve(__dirname, "ui-test-editor.css")
  /**
   * 原文。**只**喂给 `postcss.parse(css)` —— 那是读语法结构，不是读文本。
   */
  const css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : ""
  /*
   * ── 为什么正则／`toContain` 必须扫「剥掉注释」的副本（修复批 F4）──
   *
   * 下面那些结构断言是**正则**，而正则跑在整份 CSS 文本上。CSS 注释里可以写出
   * 和真规则一模一样的字样，于是**注释本身**就能满足断言 —— 真正的规则被改名、
   * 被分组、甚至被删掉，红灯都不会亮。
   *
   * 丙-4a 就实发生了：它给灵感气泡写的说明注释里有一句形如
   * 「草稿气泡那条规则是 `.ui-test-editor-draft-hint` 加 `{ … width: min(280px, 100%) }`」，
   * 而正则只要 `{` 与 `width:` 之间没有 `}` 就算命中 —— 注释里没有 `}`，
   * 于是「草稿气泡的定位规则必须存在且是独立规则块」这条**既有守卫**
   * 被自己的新注释弄成了空转（实测：把真规则改名、或改成与灵感气泡分组，
   * 全套测试照样全绿）。
   *
   * ⚠️ 修复批 1 只把**当时看得见的那三处**换成了这份副本，注释却写成「一律」。
   * 评审用变异 M15 当场证伪：在 CSS 顶部注入一条含
   * `padding: 0 var(--qmai-body-margin-x, …)` 的**假注释**、再把真规则
   * `.ui-test-editor-document` 改名，「底部安全距离与左右边距都是变量」那条
   * 仍然 `1 passed` —— 断言是被注释满足的。这正是本仓库那条老教训的第三次复发：
   * **修了一个实例 ≠ 修了这一类缺陷**。
   *
   * 所以这份副本现在是**本 describe 内所有结构断言的唯一来源**：下面每一个
   * 正则／`toContain`／`not.toContain` 都扫 `cssCode`（修复批 2 逐条核对过，
   * 清单与理由见提交说明）。唯一的例外是 `postcss.parse(css)` —— 它读的是
   * **语法结构**，注释根本不会出现在 `rule.selector` / `decl.value` 里
   * （见「正文容器内的已知界面浮层都显式声明了界面字体」那条的说明），
   * 读原文才是对的。
   *
   * ⚠️ 为什么不做成「全仓共用的 structuralCss() 助手」：本目录另有两套既有的
   * 局部做法（`ui-test-memory-css.spec.ts` 的 `cssRules()` 自己剥注释、
   * `ui-test-header-alignment.spec.ts` 与 `ui-font-derivation.spec.ts` 直接上 postcss），
   * 全仓收敛是一次独立的、跨 6+ 个 spec 的重构；本批的职责是**把这一类缺陷在
   * 本文件里关死**，用一个模块级纯函数 + 每个 CSS 文件一份副本就够了，
   * 不引入一个只有一处调用方的新共享模块。
   */
  const cssCode = stripCssComments(css)
  /** 另一个被本 describe 断言结构的样式表（同样只扫剥注释的副本）。 */
  const themeCssCode = stripCssComments(readFileSync(resolve(__dirname, "ui-test.css"), "utf8"))

  it("固定外壳不滚动，只有正文区域滚动且头部不裁切提示", () => {
    expect(cssCode).toMatch(/\.ui-test-editor\s*\{[^}]*overflow:\s*hidden/)
    expect(cssCode).toMatch(/\.ui-test-editor-scroll\s*\{[^}]*overflow-y:\s*auto/)
    expect(cssCode).toMatch(/\.ui-test-editor-header\s*\{[^}]*flex-shrink:\s*0/)
    expect(cssCode).toMatch(/\.ui-test-editor-header\s*\{[^}]*background:\s*var\(--ui-paper\)/)
  })

  it("草稿提示按工具栏宽度定位，盖住正文，且不能在窄编辑区被裁掉", () => {
    expect(cssCode).toMatch(/\.ui-test-editor-toolbar\s*\{[^}]*position:\s*relative/)
    expect(cssCode).toMatch(/\.ui-test-editor-hint-anchor\s*\{[^}]*position:\s*static/)
    expect(cssCode).toMatch(/\.ui-test-editor-draft-hint\s*\{[^}]*width:\s*min\(280px, 100%\)/)
    expect(cssCode).toMatch(/\.ui-test-editor-header\s*\{[^}]*z-index:\s*2/)
  })

  /*
   * ── 章节头部：标题与工具栏**同一行**（用户要求）──
   *
   * 用户口径：「这些图标太松散了，挨的近一些，放在标题右侧」。
   * 实现用的是 **grid** 而不是把工具栏 JSX 挪进标题行 ——
   * 因为工具栏还是两条提示气泡的定位祖先（上一条断言钉着 `position: relative`），
   * 挪进标题行会让气泡的 `left: 0` 参考系漂到标题右端。
   *
   * ⚠️ 这组断言里**承重的是 `grid-column: 1 / -1` 那一条**，不是 grid 本身。
   * header 一旦变成 grid，它下面**所有**直接子元素都进自动放置：
   * `showPath` 打开时那块「文件详情」会被塞进第二列、和工具栏挤在同一行。
   * 这条最容易在后续改动里被当成冗余删掉（"两列布局为什么要跨列"），
   * 删掉之后界面上只在**打开文件详情时**出错，平时完全看不出来。
   */
  it("章节标题行与工具栏并排：图标靠右，文件详情仍横跨整行", () => {
    expect(cssCode).toMatch(
      /\.ui-test-editor\[data-kind="chapter"\]\s+\.ui-test-editor-header\s*\{[^}]*display:\s*grid/,
    )
    expect(cssCode).toMatch(
      /\.ui-test-editor\[data-kind="chapter"\]\s+\.ui-test-editor-header\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/,
    )
    // 工具栏在第 2 列（= 靠右），标题行在第 1 列
    expect(cssCode).toMatch(
      /\.ui-test-editor\[data-kind="chapter"\]\s+\.ui-test-editor-toolbar\s*\{[^}]*grid-column:\s*2/,
    )
    expect(cssCode).toMatch(
      /\.ui-test-editor\[data-kind="chapter"\]\s+\.ui-test-editor-title-row\s*\{[^}]*grid-column:\s*1/,
    )
    // 承重：详情区横跨两列
    expect(cssCode).toMatch(
      /\.ui-test-editor\[data-kind="chapter"\]\s+\.ui-test-editor-details\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/,
    )
    // 底部间距搬到了 header 的 padding-bottom（同一个 grid 行里不能再靠工具栏 margin 撑）
    expect(cssCode).toMatch(
      /\.ui-test-editor\[data-kind="chapter"\]\s+\.ui-test-editor-header\s*\{[^}]*padding-bottom:\s*26px/,
    )
  })

  /*
   * 标题**不伸展**，图标盒收到 30px。
   *
   * 这两条都是用户看出来的问题，且都容易被"顺手统一"改回去：
   *   · 标题若退回共用的 `flex: 1 1 12rem`，点击后就变成横贯整行的大输入框
   *     （用户原话「点击之后边框太宽了」）；
   *   · 图标盒若退回 36px，去掉底色之后字形之间又会散开
   *     （用户原话「这些图标太松散了」）。
   */
  it("章节标题贴字宽（不伸展），图标盒 30px 且触屏仍放大到 44px", () => {
    expect(cssCode).toMatch(
      /\.ui-test-editor\[data-kind="chapter"\]\s+\.ui-test-editor-title[\s\S]{0,600}?flex:\s*0\s+1\s+auto/,
    )
    expect(cssCode).toMatch(/\.ui-test-editor-action\.is-icon-only\s*\{[^}]*width:\s*30px/)
    /*
     * ⚠️ 触屏那两条**必须在**：`.is-icon-only`（(0,3,0)）比
     * `.ui-test-editor-action`（(0,2,0)）特异度更高，所以 30px 会压过
     * 媒体查询里那句 44px —— 不显式写 `.is-icon-only` 的 44px，
     * 触控目标就悄悄退化成 30px。
     */
    const coarse = cssCode.slice(cssCode.indexOf("@media (pointer: coarse)"))
    expect(coarse).toMatch(/\.ui-test-editor-action\.is-icon-only\s*\{[^}]*min-height:\s*44px/)
  })

  /*
   * ── 章节标题：点进去之后文字必须**垂直居中** ──
   *
   * 用户报的缺陷：「点击标题，按正常来说字体应该显示在边框的最中间，
   * 但现在字体显示的是在顶上」。
   *
   * 这不是对齐属性写错，是**行盒比盒子矮**：输入框有
   * `min-height: var(--ui-heading-line)`（28px），而行高原本是 1.5×12px = 18px，
   * textarea 的文字从内容盒顶部排起、余下 10px 全落到底部 → 看着像吊在顶上。
   *
   * ⚠️ 这条守卫的**形状**比它的字面值重要：它要求的不是"行高等于 28px"，
   * 而是"行高与 min-height 引用**同一个变量**"。所以断言分两半，分别钉住
   * 变量的两端 —— 只钉一端的话，把 28px 写死成字面量的改动照样能全绿，
   * 而那种写法下次调行高盒时就会**复发**这个缺陷。
   *
   * 变异验证过：把这条 `line-height` 改回 `1.5`，本用例失败；
   * 只把 `var(--ui-heading-line)` 换成字面量 `1.75rem`，同样失败（变量同一性被破坏）。
   */
  it("章节标题点击后文字垂直居中：行高与最小高度引用同一个变量", () => {
    // 一端：共用规则用变量给出行高盒
    expect(cssCode).toMatch(
      /\.ui-test-editor-title-input\s*\{[^}]*min-height:\s*var\(--ui-heading-line\)/,
    )
    /*
     * 另一端：章节标题把行高设成**同一个**变量。
     * `[\s\S]{0,1400}?` 用来跨越中间那一大段说明注释 —— 上限取 1400 是因为
     * 这段注释以后还会长，留足余量；非贪婪保证不会跨到别的规则块里去。
     */
    expect(cssCode).toMatch(
      /\.ui-test-editor\[data-kind="chapter"\]\s+\.ui-test-editor-title,[\s\S]{0,1400}?line-height:\s*var\(--ui-heading-line\)/,
    )
  })

  /*
   * 标题加粗、字号 13px（用户：「标题要加粗，当前字号再加1」）。
   *
   * 上一版是 `500 0.75rem`（12px / 中等）。"+1" 按字面理解为 +1px ⇒ 13px。
   * 钉住整条简写，顺带把字重 700 一起守住 —— 只钉字号的话，
   * 将来把 700 退回 500 会让刚提出的"加粗"要求无声消失。
   */
  it("章节标题加粗且字号为 13px", () => {
    expect(cssCode).toMatch(
      /\.ui-test-editor\[data-kind="chapter"\]\s+\.ui-test-editor-title,[\s\S]{0,900}?font:\s*700\s+0\.8125rem/,
    )
  })

  it("灵感提示用独立类名 + 独立规则块，定位与草稿提示逐项相同", () => {
    /*
     * 丙-4a 选的方案是 (i)：新气泡用**独立类名**（`ui-test-editor-inspiration-hint`），
     * 定位属性**照抄成一条独立规则块**，不用选择器分组。两条理由都是实测出来的：
     *
     * 1. `.ui-test-editor-draft-hint` 在本文件里被 ~20 处断言要求「为 null 或长度
     *    恰为 1」。一旦新气泡共用这个类名，那些断言的**含义会被悄悄扩大** ——
     *    它们将不再只描述草稿提示，而「只有一条草稿气泡」这条不变量就没人守了。
     * 2. 上面那条正则要求草稿气泡的 `width` 写在**独立规则块**里，分组写法
     *    （`.ui-test-editor-draft-hint, .ui-test-editor-inspiration-hint { … }`）
     *    不一定匹配。所以这里把两条规则**分别**断言：既钉住新类名，
     *    也顺带证明草稿那条没有被改成分组而失配。
     *
     * ⚠️ 这一段曾经**不是**这么写的（修复批 F4）：它把命题写成
     * 「正则跑在**整份响应文件文本**上」，而当时丙-4a 新加的注释里正好有一句
     * 能满足它 —— 改名的变异、分组的变异都活了下来。现在全部扫 `cssCode`
     * （已剥注释），所以「注释里有这句话」不再算数。
     */
    expect(cssCode).toMatch(/\.ui-test-editor-inspiration-hint\s*\{[^}]*position:\s*absolute/)
    expect(cssCode).toMatch(/\.ui-test-editor-inspiration-hint\s*\{[^}]*z-index:\s*2/)
    expect(cssCode).toMatch(/\.ui-test-editor-inspiration-hint\s*\{[^}]*top:\s*calc\(100% \+ 10px\)/)
    expect(cssCode).toMatch(/\.ui-test-editor-inspiration-hint\s*\{[^}]*left:\s*0/)
    expect(cssCode).toMatch(/\.ui-test-editor-inspiration-hint\s*\{[^}]*width:\s*min\(280px, 100%\)/)
    expect(cssCode).toMatch(/\.ui-test-editor-draft-hint\s*\{[^}]*width:\s*min\(280px, 100%\)/)
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
    expect(cssCode).toMatch(/--qmai-body-margin-x-fallback:\s*clamp\(20px, 4vw, 48px\)/)
    expect(cssCode).toMatch(/max-width:\s*calc\(800px \+ 2 \* var\(--qmai-body-margin-x-fallback\)\)/)
    // 正文容器必须用同一个 fallback 变量做 padding 的兜底，否则上面那个上限算的不是同一边距
    expect(cssCode).toMatch(
      /\.ui-test-editor-document \{[^}]*padding:\s*0 var\(--qmai-body-margin-x, var\(--qmai-body-margin-x-fallback\)\)/,
    )
    expect(cssCode).toMatch(/1\.25rem\/1\.75rem\s+var\(--serif\)/)
    /*
     * 正文字号必须是**单一来源变量**，不再是字面量 1.125rem/1.95。
     * 原来的断言（正则直接匹配 1.125rem/1.95）在这里被有意替换：
     * 字面量会让「正文字号」设置完全失效，也会让查找高亮层与输入层
     * 各写一份取值 —— 今天相同、改一处就错位（高亮框与文字偏移）。
     * 新断言比原来更强：它同时钉住"引用变量"与"不得再出现字面量"。
     */
    /*
     * 第 940 行原来断言正文容器用 `var(--serif)`。
     * 那把**界面**衬线层与**文档正文**层混成了一个变量，导致用户在章节里
     * 改正文字体时品牌名/页面标题/书封标题一起变（用户报过的缺陷）。
     * 现在正文必须用专属的 `var(--body-font)`；`--serif` 保持固定、只管界面。
     * 下面第 932 行仍要求「章节标题栏」用 var(--serif) —— 标题不属于正文，
     * 与文档内 h2-h6 用 var(--ui) 是同一条约定。
     */
    expect(cssCode).toMatch(/font:\s*400\s+var\(--qmai-body-font-size\)\/var\(--qmai-body-line-height\)\s+var\(--body-font\)/)
    // 正文容器**不得**再消费界面衬线层（否则用户的缺陷会复发）
    expect(cssCode).not.toMatch(/var\(--qmai-body-line-height\)\s+var\(--serif\)/)
    expect(cssCode).not.toMatch(/1\.125rem\/1\.95\s+var\(--serif\)/)
    expect(cssCode).toContain("text-indent: 2em")
    expect(cssCode).toMatch(/:is\(h1, h2, h3, h4, h5, h6, li/)
  })

  it("正文保留光标而非整框焦点，列表排除段首缩进并消除主题蓝点", () => {
    expect(cssCode).toMatch(/\[data-writing-editor\] textarea:focus-visible[\s\S]*?outline:\s*none/)
    expect(cssCode).toContain('text-indent: 2em each-line')
    expect(cssCode).toContain('[data-ui-test-frontmatter]')
    expect(cssCode).toMatch(/\.ProseMirror, \[dir\]\[lang\]\) li::marker[^}]+color: var\(--ui-ink\)/)
    expect(cssCode).toMatch(/\.ProseMirror, \[dir\]\[lang\]\) li p[^}]+text-indent: 0/)
  })

  it("正文查找高亮与输入层共用同一个字号与行高变量，避免样式修正后偏位", () => {
    // 原来只断言"行高是字面量 1.95"；现在两者都必须是同一个变量的引用，
    // 否则覆盖在 textarea 之上的高亮层会与输入文字错位
    expect(cssCode).toMatch(/\[data-find-highlights\][^{]*\{[^}]*font-size:\s*var\(--qmai-body-font-size\)/)
    expect(cssCode).toMatch(/\[data-find-highlights\][^{]*\{[^}]*line-height:\s*var\(--qmai-body-line-height\)/)
    expect(cssCode).toMatch(/data-ui-test-indent="visual"[^}]+\[data-find-highlights\][^{]*\{[^}]*text-indent:\s*2em/)
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
     * ⚠ 必须扫剥掉注释的副本（本 describe 顶部那份 `cssCode`）。
     * 上面那条注释里就写着「UA 样式表给它声明了 letter-spacing: normal」——
     * 不挖注释的话，这条**注释本身**会被当成一处「写死的字间距」而报假红。
     * （同一个坑本会话在 check-css-var-contract.mjs 上已经踩过一次：
     *  它把只出现在注释里的旧变量报成「仍在被使用」。）
     */

    // ① 正文层：div 系（.ProseMirror / [dir][lang] / 高亮层）继承的源头
    expect(cssCode).toMatch(/\.ui-test-root \.ui-test-editor-body \{[^}]*letter-spacing:\s*var\(--qmai-body-letter-spacing, 0\)/)
    // ① 输入层：原生 textarea 不吃继承，必须显式写一次同一个变量
    expect(cssCode).toMatch(/\[data-writing-editor\] textarea[^{]*\{[^}]*letter-spacing:\s*var\(--qmai-body-letter-spacing, 0\)/)

    // ② 全文件不得写死字间距
    const decls = [...cssCode.matchAll(/letter-spacing:\s*([^;}]+)/g)].map((m) => m[1].trim())
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
    /*
     * ⚠️ 这一处也是**结构扫描**，所以同样扫剥注释的副本：否则 CSS 里一句
     * 「列表字号接行高变量」的说明注释就会被当成一条候选规则行 ——
     * 真规则被删掉、注释留下时，下面的 `hit.length === 1` 会由注释满足。
     */
    const listLines = cssCode.split(/\r?\n/).filter((l) => l.includes(LIST_DECL))

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
    expect(cssCode).not.toMatch(/font-size: var\(--qmai-body-font-list\); line-height: [\d.]/)

    /*
     * 已确认的边界：标题 1.6、表格 1.7 不跟随行间距（这是有意固定，不是漏改）。
     * 表格那条原来写的是裸串 /line-height: 1\.7;/ —— 全文件任何一处 1.7 都能满足它，
     * 与"表格"这个命题无关（评审点名的同型问题）。改成锚住表格选择器。
     */
    expect(cssCode).toMatch(/:is\(h2, h3, h4, h5, h6\) \{[^}]*font: 600 var\(--qmai-body-font-size\)\/1\.6 var\(--ui\)/)
    expect(cssCode).toMatch(/:is\(th, td\) \{[^}]*line-height: 1\.7;/)
    // 且表格与标题都不许改跟行高变量（那会让"固定"这个决定被悄悄推翻）
    expect(cssCode).not.toMatch(/:is\(th, td\) \{[^}]*line-height: var\(--qmai-body-line-height\)/)
    expect(cssCode).not.toMatch(/:is\(h2, h3, h4, h5, h6\) \{[^}]*\/var\(--qmai-body-line-height\)/)
  })

  /**
   * 覆盖在正文之上的**界面浮层**必须显式钉回界面字体。
   *
   * ── 这条守的是一类既有守卫**结构上**看不见的缺陷 ──
   *
   * `.ui-test-editor-body` 那条 `font:` 简写把 font-family 也设成了
   * `var(--body-font)`，而 font-family 会**继承**。于是在正文容器里渲染、
   * 却属于界面 chrome 的**非表单元素**会静默继承正文字体。
   *
   * 本轮终审查出一个真实例子：查找条里显示「1/5」「未找到」的 `<span>`。
   * `ui-test.css` 的兜底只覆盖 `button, input, textarea, select`，
   * 这个 span 不在其中 —— 用户把正文字体改成楷体后，连查找条的计数文字
   * 都变成楷体。而它是界面，不是正文，正是用户报的那一类缺陷。
   *
   * 两道既有守卫都够不到它：
   *   · `ui-font-derivation.spec.ts` 扫的是**声明**了 `var(--body-font)` 的规则，
   *     而这是**继承**泄漏（声明处 :268/:277 本身没错）；
   *   · `verify-real-exe.mjs` 用 `closest(".ui-test-editor-body, …")` 分类，
   *     这个 span 命中正文容器被归为 content，"它该跟随界面字号"那条判据
   *     永远不会指向它。
   *
   * ── 为什么用"标记清单"这种写法，以及它的**已知边界** ──
   *
   * 这里列出**已知**的正文内界面浮层标记，要求每一个都显式声明
   * `font-family: var(--ui)`。新增一个已知标记而忘了声明会立刻红 ——
   * 这正是它比"修一次就完了"强的地方。
   *
   * 诚实标注边界：它**发现不了**一个全新标记的浮层（要靠人往清单里加）。
   * 但它把"静默继承"变成了"必须显式声明"，且清单本身是可选可审的。
   * 想要完全自动，需要遍历真实 DOM 逐个判"这个元素是正文还是界面"，
   * 而那正是 `verify-real-exe.mjs` 的 inContent 判据在做、并且在 span 上判错的事。
   */
  it("正文容器内的已知界面浮层都显式声明了界面字体（防继承泄漏）", () => {
    /*
     * 清单 → 该浮层是什么。加新标记时这里和 CSS 一起改；
     * 只加标记不改 CSS 就会红。
     *
     * `attr` 是裸属性名，用于"这个标记是否真的存在"的**前提检查**。
     * 用裸属性名而不是完整选择器，是因为同一个标记在 JSX 里写
     * `data-find-bar="true"`、在 querySelector 里写 `[data-find-bar='true']`，
     * 引号风格不一致 —— 拿完整选择器去 toContain 会**因为引号**而假红。
     * 我第一版就是这么写的。判据的形状必须对准它要说的那件事。
     */
    const KNOWN_IN_BODY_CHROME: { marker: string; attr: string; what: string }[] = [
      { marker: '[data-find-bar="true"]', attr: "data-find-bar", what: "查找/替换条（其中的计数文字是 span，不在表单兜底里，曾静默继承正文字体）" },
      { marker: '[data-selection-toolbar="true"]', attr: "data-selection-toolbar", what: "选中文字后的浮动工具条" },
      { marker: '[data-editor-context-menu="true"]', attr: "data-editor-context-menu", what: "编辑器右键菜单" },
    ]
    expect(KNOWN_IN_BODY_CHROME.length, "清单成了空集 —— 这条判据会恒真").toBeGreaterThanOrEqual(3)

    /*
     * 前提检查：这些标记必须**真的**渲染在正文容器内，否则"钉回界面字体"
     * 是在防一个不存在的东西（幽灵判据）。
     * 扫 editor/ 整个目录，而不是只扫 wiki-editor.tsx ——
     * `data-editor-context-menu` 定义在 editor-context-menu.tsx 里，
     * 只扫 wiki-editor.tsx 会假红（我第一版又踩了这个）。
     */
    const editorDir = resolve(__dirname, "../editor")
    const editorSources = readdirSync(editorDir)
      .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
      .map((f) => readFileSync(join(editorDir, f), "utf8"))
      .join("\n")
    for (const { marker, attr } of KNOWN_IN_BODY_CHROME) {
      expect(editorSources, `清单里的 ${marker} 在 editor/ 下已经不存在了 —— 清单该更新（否则这条判据守的是幽灵）`)
        .toContain(attr)
    }

    /*
     * 逐条要求 CSS 里有一条把它钉回 var(--ui) 的规则。
     *
     * ⚠ 必须用 postcss 读**真实声明**，不能对原始文本跑正则。
     * 我第一版就是那么写的：把 CSS 按 `}` 切成块、在块里找
     * `font(-family)?:[^;]*var(--ui)`。结果它**被自己上面那段注释骗了** ——
     * 注释里既出现了 `font-family` 又出现了 `var(--ui)`，而注释里没有分号，
     * 于是 `[^;]*` 一路跨过整段注释把两者连起来，判成"已钉住"。
     * 变异测试当场抓到：把 pin 改成 `var(--body-font)` 它照样报绿（M2）。
     *
     * 这与本仓库那条老教训是同一类：**判定必须落在语法结构上，不能落在文本上**。
     * postcss 已经帮我们分好了 rule / decl，注释根本不会出现在 `decl.value` 里。
     */
    const parsed = postcss.parse(css)
    /** 该规则是否把 font-family 钉成了 var(--ui)（`font:` 简写也算）。 */
    const rulePinsUiFont = (rule: postcss.Rule) => {
      let pinned = false
      rule.walkDecls((decl) => {
        if (decl.prop !== "font" && decl.prop !== "font-family") return
        if (decl.value.includes("var(--ui)")) pinned = true
      })
      return pinned
    }

    for (const { marker, what } of KNOWN_IN_BODY_CHROME) {
      const mentioning: postcss.Rule[] = []
      parsed.walkRules((rule) => {
        if (rule.selector.includes(marker)) mentioning.push(rule)
      })
      expect(mentioning.length, `CSS 里找不到任何提到 ${marker} 的规则`).toBeGreaterThan(0)
      expect(
        mentioning.some(rulePinsUiFont),
        `${marker}（${what}）没有显式声明 font-family: var(--ui) —— `
        + "它会继承 .ui-test-editor-body 的 var(--body-font)，改正文字体时跟着变，"
        + "而它是界面、不是正文（用户报过的同类缺陷）",
      ).toBe(true)
    }

    /*
     * 反向控制：判定必须能识破"没有钉回界面字体"的规则，否则它可能恒真。
     * 每个反例都**真的过一遍 postcss**，而不是在字符串上做假设 ——
     * 这正是上面被注释骗到的根因。
     */
    const pinsIn = (source: string, marker: string) => {
      let found = false
      postcss.parse(source).walkRules((rule) => {
        if (rule.selector.includes(marker) && rulePinsUiFont(rule)) found = true
      })
      return found
    }
    expect(pinsIn('[data-find-bar="true"] { color: red; }', '[data-find-bar="true"]'),
      "反向控制：没写 font-family 的规则必须判为未钉住").toBe(false)
    expect(pinsIn('[data-find-bar="true"] { font-family: var(--body-font); }', '[data-find-bar="true"]'),
      "反向控制：钉成 var(--body-font) 必须判为未钉住（那正是泄漏本身）").toBe(false)
    expect(pinsIn('[data-find-bar="true"] { font-family: var(--ui); }', '[data-find-bar="true"]'),
      "反向控制：确凿合规的写法必须判为已钉住，否则这条判据会退化成恒红").toBe(true)
    expect(pinsIn('[data-find-bar="true"] { font: 400 0.75rem/1.6 var(--ui); }', '[data-find-bar="true"]'),
      "反向控制：font: 简写里以 var(--ui) 收尾也必须算钉住，否则会误伤合法写法").toBe(true)
  })

  it("底部安全距离与左右边距都是变量，没有写死的数字残留", () => {
    // 改造前是 padding-bottom: 36px（窄屏另有 28px），两处独立数字正是"不可调"的根源
    /*
     * 兜底值用**常量拼串**，不抄字面量（最终整体代码审查第 6 条）。
     * 抄的话，改 DEFAULT_BODY_SAFE_BOTTOM 而忘改 CSS 时这条照样绿，
     * 于是首屏/无 JS 场景下的安全距离与用户确认的 51px 不一致且没有红灯。
     */
    expect(cssCode).toMatch(
      new RegExp(`\\.ui-test-editor-scroll \\{[^}]*padding-bottom:\\s*var\\(--qmai-body-safe-bottom, ${DEFAULT_BODY_SAFE_BOTTOM}px\\)`),
    )
    /*
     * 否定式也扫剥注释的副本，且**鉴别力不变**：这两条防的是「写死的数字回到
     * 某条真实规则里」。加回真规则 → `cssCode` 里就有 → 照样红（本提交用变异复算过）。
     * 反过来，剥注释**只**去掉一种误报：将来有人写一句形如
     * 「改造前这里是 padding-bottom: 36px」的**说明注释**时不该假红 ——
     * 注释不参与层叠，它不是「写死的数字残留」。
     * 所以剥注释让这两条从「更强但会误报」变成「恰好对准它要说的那件事」。
     */
    expect(cssCode).not.toContain("padding-bottom: 36px")
    expect(cssCode).not.toContain("padding-bottom: 28px")
    // 左右边距挂在正文容器上：挂在外层的话，800px 上限会让滑块在宽窗口下看起来没反应
    expect(cssCode).toMatch(/\.ui-test-editor-document \{[^}]*padding:\s*0 var\(--qmai-body-margin-x, var\(--qmai-body-margin-x-fallback\)\)/)
    expect(cssCode).toMatch(/\.ui-test-root \.ui-test-editor \{[^}]*padding:\s*0;/)
  })

  /**
   * 正文字号与行间距的 CSS 兜底值也必须与常量绑死（审查第 6 条）。
   *
   * 这两个兜底值原来**没有任何断言**：`--qmai-body-font-px` 与
   * `--qmai-body-leading` 的行内值只在 App 跑起来之后才存在，
   * 所以兜底值恰好作用在「首屏第一帧」与「脚本没跑起来」两种场景上 ——
   * 正是最容易没人看、也最容易改一处忘一处的地方。
   * 与上面安全距离那条同理：拿常量拼串，让漂移变成失败的测试。
   */
  it("正文字号与行间距的 CSS 兜底值与 font-settings 的常量一致", () => {
    /*
     * ⚠️ 这三条也是**规则结构**断言（越界到了兄弟文件 `ui-test.css`），
     * 所以同样扫剥注释的副本 `themeCssCode`：否则 ui-test.css 里一句
     * 「`var(--qmai-body-font-px, 18px)` 是首屏兜底」的说明注释就能满足它们。
     */
    expect(
      themeCssCode,
      `--qmai-body-font-size 的兜底值必须是 DEFAULT_BODY_FONT_PX（${DEFAULT_BODY_FONT_PX}px）—— `
      + `它是首屏第一帧的字号，改了常量却忘改这里不会有任何红灯`,
    ).toContain(`var(--qmai-body-font-px, ${DEFAULT_BODY_FONT_PX}px)`)
    expect(
      themeCssCode,
      `--qmai-body-line-height 的兜底值必须是 DEFAULT_BODY_LINE_HEIGHT（${DEFAULT_BODY_LINE_HEIGHT}）`,
    ).toContain(`var(--qmai-body-leading, ${DEFAULT_BODY_LINE_HEIGHT})`)
    // 反向：兜底值不许再是改造前的旧字面量（1.125rem = 18px 的老写法）
    expect(themeCssCode, "兜底值里还残留旧的 rem 字面量写法").not.toMatch(/--qmai-body-font-px,\s*1\.125rem/)
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
    expect(cssCode).toContain(`--qmai-body-margin-x-fallback: ${expected};`)
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
    /*
     * ⚠️ 块体必须从剥注释的副本里切：`indexOf` 找的是**第一次**出现的位置，
     * 而一句形如「@media (max-width: 640px) 里曾经有 …」的说明注释如果排在
     * 真媒体查询前面，切出来的就是注释那一段 —— 下面两条正面断言会被注释满足，
     * 真媒体查询被删掉也不红。
     */
    const at = cssCode.indexOf("@media (max-width: 640px)")
    expect(at, "应还有窄屏媒体查询").toBeGreaterThan(-1)
    // 按大括号配对切出该媒体查询的块体，而不是用正则猜到哪里结束
    const open = cssCode.indexOf("{", at)
    let depth = 0
    let end = -1
    for (let i = open; i < cssCode.length; i++) {
      if (cssCode[i] === "{") depth++
      else if (cssCode[i] === "}") { depth--; if (depth === 0) { end = i; break } }
    }
    expect(end, "应能找到该媒体查询的收尾大括号").toBeGreaterThan(-1)
    const block = cssCode.slice(open, end)
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
    const EDITOR_RULES = /\.ui-test-root \.ui-test-editor(-document|-scroll)?\s*\{([^}]*)\}/g
    const offenders: string[] = []
    for (const m of cssCode.matchAll(EDITOR_RULES)) {
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
    expect(cssCode).toContain(".ui-test-root .ui-test-editor-body .ProseMirror table,")
    expect(cssCode).toMatch(
      /\.ui-test-root \.ui-test-editor-body \.milkdown table \{ width: 100%; margin: 0 0 16px; border-collapse: collapse; \}/,
    )
    expect(cssCode).toMatch(
      /\.ui-test-root \.ui-test-editor-body \.milkdown :is\(th, td\) \{ border: 1px solid var\(--ui-line\); padding: 6px 12px;/,
    )
    expect(cssCode).toMatch(
      /\.ui-test-root \.ui-test-editor-body \.milkdown th \{ background: var\(--ui-soft\); font-weight: 600; \}/,
    )
    expect(cssCode).toMatch(
      /\.ui-test-root \.ui-test-editor-body \.milkdown blockquote \{ margin: 0 0 16px; border-left: 3px solid var\(--ui-accent\); background: var\(--ui-panel\);/,
    )
    expect(cssCode).toMatch(
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
    expect(cssCode).toContain(
      ".ui-test-root .ui-test-editor-body .ProseMirror .tableWrapper table :is(th, td) > p,",
    )
    expect(cssCode).toMatch(
      /\.ui-test-root \.ui-test-editor-body \.milkdown \.tableWrapper table :is\(th, td\) > p \{ margin: 0; text-indent: 0; \}/,
    )

    // 正文段落本身的 2em 缩进不能被这次修改动到；行高必须是变量引用 ——
    // 写死 1.95 会让「行间距」这个设置对正文段落完全失效。
    expect(cssCode).toMatch(
      /:is\(\.ProseMirror, \[dir\]\[lang\]\) p \{ margin: 0 0 16px; line-height: var\(--qmai-body-line-height\); text-indent: 2em; \}/,
    )
  })

  it("全部选择器受ui-test-root约束，长标题、窄屏、菜单都不溢出", () => {
    expect(cssCode).toContain(".ui-test-root .ui-test-editor")
    const selectors = cssCode.match(/[^{}]+(?=\{)/g) ?? []
    expect(selectors.length).toBeGreaterThan(5)
    for (const selector of selectors.filter((item) => !item.trim().startsWith("@"))) {
      expect(selector.trim()).toMatch(/^\.ui-test-root /)
    }
    expect(cssCode).toContain("overflow-wrap: anywhere")
    expect(cssCode).toContain("min-width: 0")
    expect(cssCode).toContain("--available-height")
  })
})