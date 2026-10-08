// @vitest-environment jsdom
//
// 「已提取记忆」小绿点的两条回归：
//
//   1) 章节侧：切到大纲页签再切回章节，绿点不能消失（用户报的问题三）。
//      根因是 renderNodes 这个 useCallback 的依赖里漏了 chapterSnapshotNumbers /
//      runningChapterPaths —— 异步读盘把快照号填回来的那次 setState 只触发
//      重渲染，依赖没变于是原样返回了上一次那份「全是占位点」的旧树，
//      直到用户点一下某个章节（selectedFile 变了）才重算。
//   2) 大纲侧：大纲行与章节行一样，只在标题左侧用绿点表达「是否提取过记忆」，
//      右侧不再有对号/提取按钮（用户报的问题二）。
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const listDirectory = vi.fn()
const readFile = vi.fn()
const fileExists = vi.fn(async () => false)

vi.mock("@/commands/fs", () => ({
  listDirectory: (...args: unknown[]) => listDirectory(...args),
  readFile: (...args: unknown[]) => readFile(...args),
  fileExists: (...args: unknown[]) => fileExists(...(args as [string])),
  writeFile: vi.fn(),
  writeFileAtomic: vi.fn(),
  createDirectory: vi.fn(),
  deleteFile: vi.fn(),
  openFileLocation: vi.fn(),
  copyFile: vi.fn(),
}))

import { KnowledgeTree } from "./knowledge-tree"
import { useWikiStore } from "@/stores/wiki-store"
import { useImportProgressStore } from "@/stores/import-progress-store"
import { getOutlineIngestIdentity } from "@/lib/novel/outline-ingest-utils"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT = "E:/QMAI-DOT-PERSIST"
const CHAPTERS_DIR = `${PROJECT}/wiki/chapters`
const OUTLINES_DIR = `${PROJECT}/wiki/outlines`
const SNAPSHOTS_DIR = `${PROJECT}/.novel/snapshots`

const CHAPTER_FILES = [
  { name: "第2章-雨夜.md", path: `${CHAPTERS_DIR}/第2章-雨夜.md`, is_dir: false },
  { name: "第5章-归途.md", path: `${CHAPTERS_DIR}/第5章-归途.md`, is_dir: false },
]
const OUTLINE_FILES = [
  { name: "主线索.md", path: `${OUTLINES_DIR}/主线索.md`, is_dir: false },
  { name: "势力设定.md", path: `${OUTLINES_DIR}/势力设定.md`, is_dir: false },
]

const FILE_TREE = [{
  name: "QMAI-DOT-PERSIST", path: PROJECT, is_dir: true, children: [{
    name: "wiki", path: `${PROJECT}/wiki`, is_dir: true, children: [
      { name: "chapters", path: CHAPTERS_DIR, is_dir: true, children: CHAPTER_FILES },
      { name: "outlines", path: OUTLINES_DIR, is_dir: true, children: OUTLINE_FILES },
    ],
  }],
}]

const CONTENTS: Record<string, string> = {
  [`${CHAPTERS_DIR}/第2章-雨夜.md`]: "---\nchapter_number: 2\ntitle: 第2章 雨夜\n---\n\n正文。\n",
  [`${CHAPTERS_DIR}/第5章-归途.md`]: "---\nchapter_number: 5\ntitle: 第5章 归途\n---\n\n正文。\n",
  [`${OUTLINES_DIR}/主线索.md`]: "---\ntitle: 主线索\n---\n\n大纲正文。\n",
  [`${OUTLINES_DIR}/势力设定.md`]: "---\ntitle: 势力设定\n---\n\n大纲正文。\n",
}

const SNAPSHOT_FILES = [
  { name: "002.snapshot.json", path: `${SNAPSHOTS_DIR}/002.snapshot.json`, is_dir: false },
]

/** 已提取过记忆的那份大纲（盘上有它的快照，判定走 getOutlineIngestIdentity）。 */
const EXTRACTED_OUTLINE = `${OUTLINES_DIR}/主线索.md`
const EXTRACTED_OUTLINE_SNAPSHOT =
  getOutlineIngestIdentity(PROJECT, EXTRACTED_OUTLINE).snapshotJsonPath

function mount() {
  listDirectory.mockImplementation(async (path: string) => {
    if (path === CHAPTERS_DIR) return CHAPTER_FILES
    if (path === OUTLINES_DIR) return OUTLINE_FILES
    if (path === SNAPSHOTS_DIR) return SNAPSHOT_FILES
    return []
  })
  readFile.mockImplementation(async (path: string) => CONTENTS[path] ?? "")
  // 大纲侧的「已提取」是盘上有没有快照文件，只有 主线索.md 有。
  fileExists.mockImplementation(async (path: string) =>
    String(path).replace(/\\/g, "/") === EXTRACTED_OUTLINE_SNAPSHOT)

  useWikiStore.setState({
    project: { id: "p-persist", name: "测试书", path: PROJECT },
    novelMode: true,
    selectedFile: null,
    fileTree: FILE_TREE as never,
  })

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<KnowledgeTree filterType="chapter" />) })
  return {
    container,
    render: (filterType: "chapter" | "outline") => {
      act(() => { root.render(<KnowledgeTree filterType={filterType} />) })
    },
    cleanup: () => {
      act(() => root.unmount())
      document.body.removeChild(container)
    },
  }
}

/** 让出真实时间：读盘是 promise 链，纯 tick 数不够。 */
async function flush(ticks = 3) {
  await act(async () => {
    for (let index = 0; index < ticks; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  })
}

const rowFor = (container: HTMLElement, fileName: string) =>
  container.querySelector<HTMLElement>(`[data-page-path$="${fileName}"]`)!

const dotIn = (container: HTMLElement, fileName: string) =>
  rowFor(container, fileName).querySelector<HTMLElement>("[data-ui-tree-memory-dot]")

const slotCount = (container: HTMLElement, fileName: string) =>
  rowFor(container, fileName)
    .querySelectorAll("[data-ui-tree-memory-dot], [data-ui-tree-memory-dot-spacer]").length

describe("已提取记忆的小绿点：状态保持与统一显示", () => {
  beforeEach(() => {
    listDirectory.mockReset()
    readFile.mockReset()
    fileExists.mockReset()
    fileExists.mockImplementation(async () => false)
    useImportProgressStore.setState({ tasks: [] })
  })

  afterEach(() => {
    useWikiStore.setState(useWikiStore.getInitialState())
    useImportProgressStore.setState({ tasks: [] })
  })

  it("章节 → 大纲 → 章节 之后，章节绿点仍然在（问题三）", async () => {
    const { container, render, cleanup } = mount()
    await flush()
    expect(dotIn(container, "第2章-雨夜.md"), "初始就该有绿点").not.toBeNull()

    render("outline")
    await flush()
    // 用户在大纲页签里点了一个大纲内容
    act(() => { useWikiStore.getState().setSelectedFile(EXTRACTED_OUTLINE) })
    await flush()

    render("chapter")
    await flush()

    const dot = dotIn(container, "第2章-雨夜.md")
    expect(dot, "切回章节后绿点不该消失").not.toBeNull()
    expect(dot!.getAttribute("data-state")).toBe("done")
    // 没提取过的第5章仍然只是占位，不能跟着亮。
    expect(dotIn(container, "第5章-归途.md")).toBeNull()
    cleanup()
  })

  it("章节绿点不依赖点过章节：来回切三次仍然在（问题三）", async () => {
    const { container, render, cleanup } = mount()
    await flush()

    for (let round = 0; round < 3; round += 1) {
      render("outline")
      await flush()
      render("chapter")
      await flush()
      expect(dotIn(container, "第2章-雨夜.md"), `第 ${round + 1} 轮切回后绿点消失`).not.toBeNull()
    }
    cleanup()
  })

  it("大纲行：提取过的在标题左侧显示绿点，没提取的只留等宽占位（问题二）", async () => {
    const { container, render, cleanup } = mount()
    render("outline")
    await flush()

    const extracted = dotIn(container, "主线索.md")
    expect(extracted, "已提取的大纲必须有绿点").not.toBeNull()
    expect(extracted!.getAttribute("data-state")).toBe("done")
    expect(extracted!.getAttribute("title")).toBe("已提取记忆")
    expect(extracted!.getAttribute("aria-label")).toBe("已提取记忆")

    expect(dotIn(container, "势力设定.md"), "没提取过的大纲不该亮绿点").toBeNull()
    // 两行都要占住圆点那一格，标题左边界才一致。
    expect(slotCount(container, "主线索.md")).toBe(1)
    expect(slotCount(container, "势力设定.md")).toBe(1)
    expect(container.querySelectorAll("[data-ui-tree-memory-dot]").length).toBe(1)
    cleanup()
  })

  it("大纲行不再有前导文件图标：点槽就是行内第一个元素（问题：大纲图标与排列）", async () => {
    const { container, render, cleanup } = mount()
    render("outline")
    await flush()

    for (const name of ["主线索.md", "势力设定.md"]) {
      const button = rowFor(container, name).querySelector("button")!
      // 用户要求"大纲当中不要前面的那个图标了"，普通大纲的 FileText 与网页剪藏的 Globe
      // 都要删干净。标题按钮里除了点槽和标题不该再有别的东西，所以这里直接断言没有 svg。
      expect(button.querySelector("svg"), `${name} 的行里不该再有任何前导图标`).toBeNull()
      // 点槽（真点或占位）必须是按钮里的第一个元素，标题紧随其后 —— 这正是章节行的结构，
      // 也是"有点的"和"没点的"两类行标题左边界能落在同一个 x 上的前提。
      const first = button.firstElementChild as HTMLElement
      expect(first.matches("[data-ui-tree-memory-dot], [data-ui-tree-memory-dot-spacer]")).toBe(true)
      expect(first.nextElementSibling?.tagName).toBe("SPAN")
    }
    cleanup()
  })

  it("大纲行与章节行的起始槽位同构：左起第一格都是点槽，第二格都是标题", async () => {
    const { container, render, cleanup } = mount()
    const leading = (fileName: string) => {
      const button = rowFor(container, fileName).querySelector("button")!
      const [slot, title] = Array.from(button.children) as HTMLElement[]
      return { slot, title }
    }

    render("outline")
    await flush()
    const outline = leading("势力设定.md")

    render("chapter")
    await flush()
    const chapter = leading("第5章-归途.md")

    /*
     * 两个列表必须**左起同构**：[点槽][标题] —— 这是"标题左边界落在同一个 x"的唯一来源。
     * 只比点槽的 class 是不够的：大纲行原先在点槽前面多挂了一枚 14px 的图标，
     * 那样点槽根本不是第一个元素，标题会被整体推右 22px（网页剪藏的图标是 12px，又差 2px，
     * 于是同一个大纲列表内部也参差不齐）。所以这里连"谁是第一个元素"一起钉住。
     */
    for (const [label, row] of [["大纲", outline], ["章节", chapter]] as const) {
      expect(row.slot.matches("[data-ui-tree-memory-dot], [data-ui-tree-memory-dot-spacer]"),
        `${label}行左起第一格必须是点槽`).toBe(true)
      expect(row.title.tagName, `${label}行第二格是标题`).toBe("SPAN")
      expect(row.title.className).toContain("truncate")
    }
    // 两侧的占位点是同一份 class，宽度因此逐字相同。
    expect(outline.slot.className).toBe(chapter.slot.className)
    // 标题的 class 也必须一致，否则 flex 行为（能否收缩、何时省略号）会不一样。
    expect(outline.title.className).toBe(chapter.title.className)
    cleanup()
  })

  it("大纲行右侧不再有对号与提取按钮（问题二）", async () => {
    const { container, render, cleanup } = mount()
    render("outline")
    await flush()

    expect(rowFor(container, "主线索.md").querySelector(".ui-test-tree-extract")).toBeNull()
    expect(rowFor(container, "势力设定.md").querySelector(".ui-test-tree-extract")).toBeNull()
    // 绿点必须在标题左侧的行按钮里，而不是右侧另起一个元素。
    const row = rowFor(container, "主线索.md")
    const button = row.querySelector("button")!
    expect(button.contains(dotIn(container, "主线索.md"))).toBe(true)
    cleanup()
  })

  it("大纲 → 章节 → 大纲 之后，大纲绿点也仍然在", async () => {
    const { container, render, cleanup } = mount()
    render("outline")
    await flush()
    expect(dotIn(container, "主线索.md")).not.toBeNull()

    render("chapter")
    await flush()
    render("outline")
    await flush()

    expect(dotIn(container, "主线索.md"), "切回大纲后绿点不该消失").not.toBeNull()
    cleanup()
  })
})
