// @vitest-environment jsdom
//
// 用**真实作品**的章号数据钉住绿点的取号规则。
//
// 数据来源：D:\QM-BOOK\他，只想活着\wiki\chapters —— 文件名、frontmatter chapter_number、
// 标题里的数字三者大面积互相矛盾，是本仓库能找到的最好的反例集：
//
//   文件名              fm   标题数字   文件名数字
//   chapter-012.md      10      12         12     ← 标题与文件名一致，但都和 fm 不同
//   chapter-015.md      13       8         15     ← 三个来源三个数
//   chapter-018.md      18       2         18     ← 标题数字严重错位
//   第17章.md            15      17         17
//   第2章.md              2       2          2     ← 唯一三者一致的一章（也正是盘上有快照的那章）
//
// 关键事实：写入快照的一侧（chapter-bulk-ingest.ts 的 chapterNumberOf）是
// **frontmatter 优先、否则文件名**；所以这 5 章的真实快照号是 {10,13,18,15,2}。
// 绿点这一侧必须算出同一组号，否则用户真实作品里会出现"明明提取过却没有绿点"。
//
// 反过来，标题数字在这份真实数据里是**错的**（chapter-018 的标题写着第2章）。
// 所以下面第二条用例专门断言：只给标题/文件名那组号（{12,8,2,17}）时，
// 这些章**一个都不许**亮 —— 如果谁把取号改成"标题优先"或"文件名优先"，它会立刻变红。
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

const PROJECT = "D:/QM-BOOK/他，只想活着"
const CHAPTERS_DIR = `${PROJECT}/wiki/chapters`
const SNAPSHOTS_DIR = `${PROJECT}/.novel/snapshots`

/** 真实文件（名字与 fm 都照抄盘上内容）。 */
const REAL_CHAPTERS = [
  { file: "chapter-012.md", fm: 10, title: "第 12 章 无名有路" },
  { file: "chapter-015.md", fm: 13, title: "第8章 林深无径" },
  { file: "chapter-018.md", fm: 18, title: "第2章 雨线断处" },
  { file: "第17章.md", fm: 15, title: "第17章" },
  { file: "第2章.md", fm: 2, title: "第2章" },
]

const CHAPTER_FILES = REAL_CHAPTERS.map((c) => ({
  name: c.file, path: `${CHAPTERS_DIR}/${c.file}`, is_dir: false,
}))

const FILE_TREE = [{
  name: "他，只想活着", path: PROJECT, is_dir: true, children: [{
    name: "wiki", path: `${PROJECT}/wiki`, is_dir: true, children: [{
      name: "chapters", path: CHAPTERS_DIR, is_dir: true, children: CHAPTER_FILES,
    }],
  }],
}]

const CONTENTS: Record<string, string> = Object.fromEntries(REAL_CHAPTERS.map((c) => [
  `${CHAPTERS_DIR}/${c.file}`,
  `---\nchapter_number: ${c.fm}\ntitle: "${c.title}"\n---\n\n正文。\n`,
]))

/** 这一轮盘上要放哪些快照号。 */
function snapshotFiles(numbers: number[]) {
  return numbers.map((n) => ({
    name: `${String(n).padStart(3, "0")}.snapshot.json`,
    path: `${SNAPSHOTS_DIR}/${String(n).padStart(3, "0")}.snapshot.json`,
    is_dir: false,
  }))
}

function mount(numbers: number[]) {
  const snaps = snapshotFiles(numbers)
  listDirectory.mockImplementation(async (path: string) => {
    if (path === CHAPTERS_DIR) return CHAPTER_FILES
    if (path === `${PROJECT}/wiki/outlines`) return []
    if (path === SNAPSHOTS_DIR) return snaps
    return []
  })
  readFile.mockImplementation(async (path: string) => CONTENTS[path] ?? "")

  useWikiStore.setState({
    project: { id: "p-real", name: "他，只想活着", path: PROJECT },
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
    cleanup: () => { act(() => root.unmount()); document.body.removeChild(container) },
  }
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const dotOf = (container: HTMLElement, file: string) =>
  container.querySelector<HTMLElement>(`[data-page-path$="${file}"] [data-ui-tree-memory-dot]`)

describe("绿点取号：真实作品的矛盾章号", () => {
  beforeEach(() => {
    listDirectory.mockReset()
    readFile.mockReset()
    useImportProgressStore.setState({ tasks: [] })
  })

  afterEach(() => {
    useWikiStore.setState(useWikiStore.getInitialState())
    useImportProgressStore.setState({ tasks: [] })
  })

  it("frontmatter 优先：按入库侧同一组号（10/13/18/15/2）全部亮起", async () => {
    // 这 5 个号正是 chapter-bulk-ingest 会写出的文件名（它也是 fm 优先、否则文件名）。
    const { container, cleanup } = mount([10, 13, 18, 15, 2])
    await flush()

    for (const c of REAL_CHAPTERS) {
      const dot = dotOf(container, c.file)
      expect(dot, `${c.file}（fm=${c.fm}，标题「${c.title}」）应该有绿点`).not.toBeNull()
      expect(dot!.getAttribute("data-state")).toBe("done")
    }
    expect(container.querySelectorAll("[data-ui-tree-memory-dot]").length).toBe(REAL_CHAPTERS.length)
    cleanup()
  })

  it("不许改用标题或文件名取号：只给那组错号（12/8/2/17）时一个都不亮", async () => {
    /*
     * 真实数据里 chapter-018.md 的 fm 是 18，标题却写着「第2章 雨线断处」；
     * chapter-015.md 的 fm 是 13，标题写着「第8章」，文件名是 15。
     * 也就是说：盘上如果只有 {12,8,2,17} 这几个号，它们对应的**并不是**这些文件。
     * 一旦取号规则回归成"标题优先"或"文件名优先"，这里就会有章错误地亮起绿点。
     */
    const { container, cleanup } = mount([12, 8, 2, 17])
    await flush()

    /*
     * 唯一合法的交集是 2：chapter-018 的标题数字恰好是 2，

     * 但按 fm 优先规则 第2章.md（fm=2）才是第 2 章 —— 所以这里应当**恰好一个**绿点，
     * 且它必须落在 第2章.md 上，而不是 chapter-018.md。
     */
    const lit = [...container.querySelectorAll<HTMLElement>("[data-page-path]")]
      .filter((row) => row.querySelector("[data-ui-tree-memory-dot]"))
      .map((row) => row.getAttribute("data-page-path")!.split("/").pop())
    expect(lit).toEqual(["第2章.md"])
    expect(dotOf(container, "chapter-018.md"), "标题写着第2章，但它的真实章号是 18").toBeNull()
    expect(dotOf(container, "chapter-015.md")).toBeNull()
    expect(dotOf(container, "chapter-012.md")).toBeNull()
    cleanup()
  })

  it("盘上只有 2 号快照时，只有第2章.md 亮（其余 16 章都不亮）", async () => {
    // 这是用户这台机器上的真实现状：.novel/snapshots 里只有 002.snapshot.json。
    const { container, cleanup } = mount([2])
    await flush()

    expect(dotOf(container, "第2章.md")).not.toBeNull()
    for (const c of REAL_CHAPTERS.filter((x) => x.file !== "第2章.md")) {
      expect(dotOf(container, c.file), `${c.file} 不该亮`).toBeNull()
    }
    expect(container.querySelectorAll("[data-ui-tree-memory-dot]").length).toBe(1)
    cleanup()
  })
})
