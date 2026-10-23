// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  READER_WINDOW_PARAM,
  buildReaderWindowUrl,
  parseReaderWindowSearch,
  readerWindowLabel,
  readInjectedReaderPayload,
  resolveReaderWindowPayload,
} from "@/lib/reader-window"

const CHAPTER_PATH = "C:/书/我的小说/wiki/chapters/第一卷/第1章 起点.md"

describe("独立窗口 URL 约定", () => {
  it("把类型、路径、项目目录、主题都带进查询串", () => {
    const url = buildReaderWindowUrl({
      kind: "chapter",
      path: CHAPTER_PATH,
      projectPath: "C:/书/我的小说",
      theme: "dark",
    })
    expect(url.startsWith("index.html?")).toBe(true)
    const params = new URLSearchParams(url.slice("index.html?".length))
    expect(params.get(READER_WINDOW_PARAM)).toBe("chapter")
    expect(params.get("path")).toBe(CHAPTER_PATH)
    expect(params.get("project")).toBe("C:/书/我的小说")
    expect(params.get("theme")).toBe("dark")
  })

  it("给了 base 时解析成绝对地址（开发态是 dev server，打包态是自定义协议）", () => {
    const absolute = buildReaderWindowUrl(
      { kind: "outline", path: CHAPTER_PATH },
      "http://localhost:1420/index.html",
    )
    expect(absolute).toBe(
      `http://localhost:1420/index.html?${new URLSearchParams({
        [READER_WINDOW_PARAM]: "outline",
        path: CHAPTER_PATH,
      }).toString()}`,
    )
  })

  it("主窗口的查询串解析成 null，不会被误判成阅读窗口", () => {
    expect(parseReaderWindowSearch("")).toBeNull()
    expect(parseReaderWindowSearch("?foo=1")).toBeNull()
    expect(parseReaderWindowSearch("?path=C:/a.md")).toBeNull()
    // 类型不认识 / 缺路径，都当主窗口处理
    expect(parseReaderWindowSearch(`?${READER_WINDOW_PARAM}=wiki&path=C:/a.md`)).toBeNull()
    expect(parseReaderWindowSearch(`?${READER_WINDOW_PARAM}=chapter`)).toBeNull()
  })

  it("解析回来的参数与原样一致", () => {
    const payload = { kind: "outline" as const, path: CHAPTER_PATH, projectPath: "C:/p", theme: "light" as const }
    const parsed = parseReaderWindowSearch(`?${buildReaderWindowUrl(payload).split("?")[1]}`)
    expect(parsed).toEqual(payload)
  })

  it("外观快照也能随查询串往返（浏览器里验收布局走的就是这条路径）", () => {
    const appearance = {
      skin: "xing" as const,
      uiFontFamily: "simsun" as const,
      uiFontSizeScale: 1.25,
      bodyFontFamily: "kaiti" as const,
      bodyFontPx: 21,
      bodyLineHeight: 2.05,
      // 负字距是真实存在的排版诉求，往返不能被当成非法值丢掉
      bodyLetterSpacing: -0.5,
      // null = 跟随窗口，必须与「0px」区分开
      bodyMarginX: null,
      bodySafeBottom: 80,
    }
    const url = buildReaderWindowUrl({ kind: "chapter", path: CHAPTER_PATH, appearance })
    expect(parseReaderWindowSearch(`?${url.split("?")[1]}`)?.appearance).toEqual(appearance)
  })

  it("没带外观时不往 payload 上塞空字段", () => {
    const parsed = parseReaderWindowSearch(
      `?${buildReaderWindowUrl({ kind: "chapter", path: CHAPTER_PATH }).split("?")[1]}`,
    )
    expect(parsed).not.toBeNull()
    expect("appearance" in (parsed ?? {})).toBe(false)
  })

  it("窗口 label 稳定、可比、且不含路径分隔符与中文", () => {
    const label = readerWindowLabel(CHAPTER_PATH)
    expect(label).toBe(readerWindowLabel(CHAPTER_PATH))
    expect(label).toMatch(/^reader-[0-9a-z]+$/)
    expect(readerWindowLabel(CHAPTER_PATH)).not.toBe(readerWindowLabel("C:/书/我的小说/wiki/chapters/第2章.md"))
    // Windows 反斜杠与正斜杠必须落在同一个 label 上，否则同一份文档会开出两个窗
    expect(readerWindowLabel("C:\\a\\b.md")).toBe(readerWindowLabel("C:/a/b.md"))
  })
})

describe("建窗参数注入", () => {
  afterEach(() => {
    delete window.__QMAI_READER_PAYLOAD__
  })

  it("Rust 侧注入的参数优先于查询串", () => {
    window.__QMAI_READER_PAYLOAD__ = { kind: "outline", path: CHAPTER_PATH, projectPath: "C:/p", theme: "dark" }
    expect(readInjectedReaderPayload()).toEqual({
      kind: "outline",
      path: CHAPTER_PATH,
      projectPath: "C:/p",
      theme: "dark",
    })
    expect(resolveReaderWindowPayload("?reader-window=chapter&path=C:/other.md")).toEqual({
      kind: "outline",
      path: CHAPTER_PATH,
      projectPath: "C:/p",
      theme: "dark",
    })
  })

  it("没注入时退回查询串；注入残缺也不当作阅读窗口", () => {
    expect(resolveReaderWindowPayload(`?${READER_WINDOW_PARAM}=chapter&path=${encodeURIComponent(CHAPTER_PATH)}`))
      .toEqual({ kind: "chapter", path: CHAPTER_PATH, projectPath: null, theme: undefined })

    window.__QMAI_READER_PAYLOAD__ = { kind: "wiki" as never, path: CHAPTER_PATH }
    expect(readInjectedReaderPayload()).toBeNull()
    // 非法的注入值不应该把主窗口变成阅读窗口
    expect(resolveReaderWindowPayload("")).toBeNull()
  })
})

describe("独立窗口接线", () => {
  const mainSource = readFileSync(resolve(__dirname, "../main.tsx"), "utf8")
  const treeSource = readFileSync(resolve(__dirname, "../components/layout/knowledge-tree.tsx"), "utf8")
  const capability = readFileSync(resolve(__dirname, "../../src-tauri/capabilities/default.json"), "utf8")

  it("启动时按注入参数分流（查询串兜底），文档窗口不跑主界面启动流程", () => {
    expect(mainSource).toContain("resolveReaderWindowPayload(window.location.search)")
    expect(mainSource).toContain("{readerPayload ? <ReaderWindow payload={readerPayload} /> : <App />}")
  })

  it("章节树与大纲树的右键菜单都提供「在独立窗口中打开」", () => {
    expect(treeSource).toContain("openDocumentInReaderWindow(targetPath, filterType)")
    // 文案里带「中」：窗口是可编辑的，菜单项要让人看出这一点
    expect(treeSource).toContain("在独立窗口中打开")
    // 必须是同一个菜单块里的一条（filterType 已覆盖 chapter / outline 两种树）
    expect(treeSource).toContain('aria-label="文档更多操作"')
  })

  it("阅读窗口的 label 被 capability 覆盖，否则它连 core 命令都用不了", () => {
    expect(capability).toContain('"reader-*"')
  })
})
