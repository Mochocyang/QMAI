// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const listDirectory = vi.fn()
const readFile = vi.fn()

vi.mock("@/commands/fs", () => ({
  listDirectory: (...args: unknown[]) => listDirectory(...args),
  readFile: (...args: unknown[]) => readFile(...args),
  fileExists: vi.fn(async () => false),
  writeFile: vi.fn(),
  createDirectory: vi.fn(),
  deleteFile: vi.fn(),
  openFileLocation: vi.fn(),
  copyFile: vi.fn(),
}))

import { KnowledgeTree } from "./knowledge-tree"
import { useWikiStore } from "@/stores/wiki-store"
import { useImportProgressStore } from "@/stores/import-progress-store"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT = "E:/QMAI-MEMORY-DOT"
const CHAPTERS_DIR = `${PROJECT}/wiki/chapters`
const SNAPSHOTS_DIR = `${PROJECT}/.novel/snapshots`

const CHAPTER_FILES = [
  { name: "第2章-雨夜.md", path: `${CHAPTERS_DIR}/第2章-雨夜.md`, is_dir: false },
  { name: "第5章-归途.md", path: `${CHAPTERS_DIR}/第5章-归途.md`, is_dir: false },
  // 章号只写在文件名里、标题里没有数字：树推不出 chapterNumber，必须回退到文件名（009 → 9）。
  { name: "009.md", path: `${CHAPTERS_DIR}/009.md`, is_dir: false },
]

const FILE_TREE = [{
  name: "QMAI-MEMORY-DOT", path: PROJECT, is_dir: true, children: [{
    name: "wiki", path: `${PROJECT}/wiki`, is_dir: true, children: [{
      name: "chapters", path: CHAPTERS_DIR, is_dir: true, children: CHAPTER_FILES,
    }],
  }],
}]

const CONTENTS: Record<string, string> = {
  [`${CHAPTERS_DIR}/第2章-雨夜.md`]: "---\nchapter_number: 2\ntitle: 第2章 雨夜\n---\n\n正文。\n",
  [`${CHAPTERS_DIR}/第5章-归途.md`]: "---\nchapter_number: 5\ntitle: 第5章 归途\n---\n\n正文。\n",
  [`${CHAPTERS_DIR}/009.md`]: "---\ntitle: 无我觉晓\n---\n\n正文。\n",
}

/** 盘上有 2、9 两章的快照，另有一个大纲快照（负数），它绝不能让任何章节亮起绿点。 */
const SNAPSHOT_FILES = [
  { name: "002.snapshot.json", path: `${SNAPSHOTS_DIR}/002.snapshot.json`, is_dir: false },
  { name: "009.snapshot.json", path: `${SNAPSHOTS_DIR}/009.snapshot.json`, is_dir: false },
  { name: "outline-312.snapshot.json", path: `${SNAPSHOTS_DIR}/outline-312.snapshot.json`, is_dir: false },
]

function mount() {
  listDirectory.mockImplementation(async (path: string) => {
    if (path === CHAPTERS_DIR) return CHAPTER_FILES
    if (path === `${PROJECT}/wiki/outlines`) return []
    if (path === SNAPSHOTS_DIR) return SNAPSHOT_FILES
    return []
  })
  readFile.mockImplementation(async (path: string) => CONTENTS[path] ?? "")

  useWikiStore.setState({
    project: { id: "p-memory-dot", name: "测试书", path: PROJECT },
    novelMode: true,
    selectedFile: null,
    fileTree: FILE_TREE as never,
  })

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<KnowledgeTree filterType="chapter" />)
  })
  return {
    container,
    cleanup: () => {
      act(() => root.unmount())
      document.body.removeChild(container)
    },
  }
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function rowFor(container: HTMLElement, fileName: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-page-path$="${fileName}"]`)
  expect(row, `找不到章节行 ${fileName}`).toBeTruthy()
  return row!
}

describe("章节目录的记忆绿点", () => {
  beforeEach(() => {
    listDirectory.mockReset()
    readFile.mockReset()
    useImportProgressStore.setState({ tasks: [] })
  })

  afterEach(() => {
    useWikiStore.setState(useWikiStore.getInitialState())
    useImportProgressStore.setState({ tasks: [] })
  })

  it("已提取记忆的章节在标题左侧显示绿点，没提取的不显示", async () => {
    const { container, cleanup } = mount()
    await flush()

    const rows = container.querySelectorAll<HTMLElement>("[data-page-path]")
    expect(rows.length).toBeGreaterThanOrEqual(3)

    const extracted = rowFor(container, "第2章-雨夜.md").querySelector("[data-ui-tree-memory-dot]")
    expect(extracted).not.toBeNull()
    expect(extracted!.getAttribute("data-state")).toBe("done")
    expect(extracted!.getAttribute("title")).toBe("已提取记忆")
    expect(extracted!.getAttribute("aria-label")).toBe("已提取记忆")

    // 这一章没有快照 → 不渲染任何元素（而不是渲染一个占位空点，那会让标题列参差不齐）。
    expect(rowFor(container, "第5章-归途.md").querySelector("[data-ui-tree-memory-dot]")).toBeNull()

    // 整棵树只有 2、9 两章该亮；outline-312 的负数快照不许让任何章节亮。
    expect(container.querySelectorAll("[data-ui-tree-memory-dot]").length).toBe(2)
    cleanup()
  })

  it("章号只写在文件名里时也能认出已提取（回退到文件名数字）", async () => {
    const { container, cleanup } = mount()
    await flush()

    const dot = rowFor(container, "009.md").querySelector("[data-ui-tree-memory-dot]")
    expect(dot, "标题「无我觉晓」里没有数字，必须靠文件名 009 才认得出已提取").not.toBeNull()
    expect(dot!.getAttribute("data-state")).toBe("done")
    cleanup()
  })

  it("正在提取的那一章显示灰点脉冲，压过它已有的绿点", async () => {
    const { container, cleanup } = mount()
    await flush()

    // 第2章 既已有快照、又正在被重新提取：此时必须显示「提取中」，
    // 否则用户点下提取后绿点纹丝不动，看起来像按钮坏了。
    act(() => {
      useImportProgressStore.getState().startTask({
        projectPath: PROJECT,
        kind: "chapter",
        total: 1,
        currentTitle: "第2章 雨夜",
        activeChapterPaths: [`${CHAPTERS_DIR}/第2章-雨夜.md`],
      })
    })
    await flush()

    const dot = rowFor(container, "第2章-雨夜.md").querySelector("[data-ui-tree-memory-dot]")
    expect(dot!.getAttribute("data-state")).toBe("running")
    expect(dot!.getAttribute("title")).toBe("正在提取记忆")
    expect(dot!.className).toContain("animate-pulse")

    // 提取中的是第2章，第5章（本来就没有快照）不该因此亮起来。
    expect(rowFor(container, "第5章-归途.md").querySelector("[data-ui-tree-memory-dot]")).toBeNull()
    cleanup()
  })

  it("任务按路径匹配，别名的标题不会误点亮另一行", async () => {
    const { container, cleanup } = mount()
    await flush()

    // 把「第5章 归途」的标题当成正在提取的对象、但路径指向第2章：
    // 若实现按标题匹配，第5章会错误地亮起灰点。
    act(() => {
      useImportProgressStore.getState().startTask({
        projectPath: PROJECT,
        kind: "chapter",
        total: 1,
        currentTitle: "第5章 归途",
        activeChapterPaths: [`${CHAPTERS_DIR}/第2章-雨夜.md`],
      })
    })
    await flush()

    expect(rowFor(container, "第5章-归途.md").querySelector("[data-ui-tree-memory-dot]")).toBeNull()
    expect(rowFor(container, "第2章-雨夜.md").querySelector("[data-ui-tree-memory-dot]")!.getAttribute("data-state"))
      .toBe("running")
    cleanup()
  })

  it("别的作品正在提取时不影响本书的绿点", async () => {
    const { container, cleanup } = mount()
    await flush()

    act(() => {
      useImportProgressStore.getState().startTask({
        projectPath: "E:/OTHER-BOOK",
        kind: "chapter",
        total: 1,
        currentTitle: "第2章 雨夜",
        activeChapterPaths: [`${CHAPTERS_DIR}/第2章-雨夜.md`],
      })
    })
    await flush()

    // 路径文本一样，但项目不同 → 不能亮。
    expect(rowFor(container, "第2章-雨夜.md").querySelector("[data-ui-tree-memory-dot]")!.getAttribute("data-state"))
      .toBe("done")
    cleanup()
  })

  /*
   * 用户反馈：有小绿点的行和没小绿点的行混在一起时，标题左边界不一致，看起来"排序错乱"。
   * 修法是**每一行都占住圆点那一格**：有记忆的放真点，没有的放等宽占位。
   *
   * 这里断言的是"结构上每行都有且仅有一个点槽"，以及占位与真点用同一套尺寸 class ——
   * jsdom 没有布局引擎，量不出像素级的左边界是否一致，那部分由真实浏览器几何脚本承担
   * （docs/skill-card-and-chapter-dot-20261007/check-browser.mjs）。
   * 两层各管一半：这层管"组件确实渲染了占位"，那层管"渲染出来确实对齐"。
   */
  it("没有记忆的章节也留出圆点那一格，保证每行标题左边界一致", async () => {
    const { container, cleanup } = mount()
    await flush()

    const rows = [...container.querySelectorAll<HTMLElement>("[data-page-path]")]
    const chapterRows = rows.filter((row) => row.querySelector("button [class*='truncate'], button input"))
    expect(chapterRows.length).toBeGreaterThanOrEqual(3)

    for (const row of chapterRows) {
      const slots = row.querySelectorAll("[data-ui-tree-memory-dot], [data-ui-tree-memory-dot-spacer]")
      expect(slots.length, `${row.getAttribute("data-page-path")} 的点槽不是恰好一个`).toBe(1)
    }

    // 有记忆的那一行是真点，没有的是占位；两者都不能缺失。
    const doneRow = rowFor(container, "第2章-雨夜.md")
    const noneRow = rowFor(container, "第5章-归途.md")
    expect(doneRow.querySelector("[data-ui-tree-memory-dot]")).not.toBeNull()
    expect(doneRow.querySelector("[data-ui-tree-memory-dot-spacer]")).toBeNull()
    expect(noneRow.querySelector("[data-ui-tree-memory-dot]")).toBeNull()
    expect(noneRow.querySelector("[data-ui-tree-memory-dot-spacer]")).not.toBeNull()

    /*
     * 占位必须与真点同尺寸，否则"留位"就白留了。
     * 判据是**子集**而不是相等：真点会多一个颜色 class（bg-emerald-500 或灰+animate-pulse），
     * 那是状态差异、不影响宽度。所以要求占位上的每个 class 都出现在真点上，
     * 再额外钉住两个宽度 class 确实在场 —— 这样谁把 MEMORY_DOT_SLOT_CLASS 改歪都会红。
     */
    const spacer = noneRow.querySelector<HTMLElement>("[data-ui-tree-memory-dot-spacer]")!
    const dot = doneRow.querySelector<HTMLElement>("[data-ui-tree-memory-dot]")!
    const spacerClasses = [...spacer.classList]
    expect(spacerClasses.length, "占位点没有尺寸 class").toBeGreaterThan(0)
    for (const name of spacerClasses) {
      expect([...dot.classList], `真点缺少占位点的 class ${name}`).toContain(name)
    }
    expect(spacerClasses).toContain("h-1.5")
    expect(spacerClasses).toContain("w-1.5")
    expect(spacerClasses).toContain("shrink-0")
    cleanup()
  })

  it("占位点对屏幕阅读器与悬停都不存在（它不是「已提取」声明）", async () => {
    const { container, cleanup } = mount()
    await flush()

    const spacer = rowFor(container, "第5章-归途.md").querySelector<HTMLElement>("[data-ui-tree-memory-dot-spacer]")!
    // 占位是纯布局用的：不能有 role/title/aria-label，否则会被读成"这章已提取/正在提取"。
    expect(spacer.getAttribute("role")).toBeNull()
    expect(spacer.getAttribute("title")).toBeNull()
    expect(spacer.getAttribute("aria-label")).toBeNull()
    expect(spacer.getAttribute("aria-hidden")).toBe("true")
    cleanup()
  })
})
