import { beforeEach, describe, expect, it, vi } from "vitest"
import { useImportProgressStore } from "@/stores/import-progress-store"

const io = vi.hoisted(() => ({ files: new Map<string, string>() }))

vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!io.files.has(path)) throw new Error(`文件缺失：${path}`)
    return io.files.get(path)!
  },
  fileExists: async (path: string) => io.files.has(path),
  listDirectory: async (dir: string) => {
    // 目录树按路径前缀合成：真实 Rust 侧 list_directory 默认 max_depth=30 递归，
    // 会带 children。这里也带 children，否则 flattenMdFiles 看不见子目录里的章节。
    const prefix = dir.endsWith("/") ? dir : `${dir}/`
    const dirs = new Set<string>()
    const files: Array<{ name: string; path: string; is_dir: boolean }> = []
    for (const path of io.files.keys()) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      const parts = rest.split("/")
      let walked = prefix
      for (let index = 0; index < parts.length - 1; index += 1) {
        walked = `${walked}${parts[index]}/`
        dirs.add(walked)
      }
      files.push({ name: parts[parts.length - 1], path, is_dir: false })
    }
    // 把子目录挂到父节点的 children 上
    const nodes: Array<{ name: string; path: string; is_dir: boolean; children?: unknown[] }> = []
    const byPath = new Map<string, { name: string; path: string; is_dir: boolean; children: unknown[] }>()
    for (const dirPath of [...dirs].sort()) {
      const trimmed = dirPath.slice(0, -1)
      const name = trimmed.slice(trimmed.lastIndexOf("/") + 1)
      byPath.set(dirPath, { name, path: trimmed, is_dir: true, children: [] })
    }
    for (const file of files) {
      const parent = file.path.slice(0, file.path.lastIndexOf("/") + 1)
      const node = byPath.get(parent)
      if (node) node.children.push(file)
      else nodes.push(file)
    }
    for (const [dirPath, node] of byPath) {
      const parent = dirPath.slice(0, -1)
      const parentPath = `${parent.slice(0, parent.lastIndexOf("/") + 1)}`
      const parentNode = byPath.get(parentPath)
      if (parentNode) parentNode.children.push(node)
      else nodes.push(node)
    }
    return nodes
  },
  writeFileAtomic: async () => {},
  createDirectory: async () => {},
}))

const ingestMock = vi.hoisted(() => vi.fn())

vi.mock("./chapter-ingest", () => ({
  chapterSnapshotJsonPath: (projectPath: string, chapterNumber: number) =>
    `${projectPath}/.novel/snapshots/${String(chapterNumber).padStart(3, "0")}.snapshot.json`,
  ingestChapter: ingestMock,
}))

import {
  formatBulkChapterIngestResult,
  runBulkChapterIngest,
} from "./chapter-bulk-ingest"

const project = "C:/proj"

function chapterFile(folder: string, name: string, chapterNumber: number) {
  const path = `${project}/wiki/chapters/${folder}${name}.md`
  io.files.set(path, `---\ntype: chapter\nchapter_number: ${chapterNumber}\nstatus: final\n---\n\n正文\n`)
  return path
}

function snapshot(chapterNumber: number) {
  io.files.set(
    `${project}/.novel/snapshots/${String(chapterNumber).padStart(3, "0")}.snapshot.json`,
    "{}",
  )
}

function runningTasks() {
  return useImportProgressStore.getState().tasks
}

describe("runBulkChapterIngest", () => {
  beforeEach(() => {
    io.files.clear()
    ingestMock.mockReset()
    ingestMock.mockImplementation(async () => ({ snapshot: { chapterNumber: 1 } }))
    useImportProgressStore.setState({ tasks: [] })
  })

  it("默认只处理还没有快照的章节（已有快照的原样跳过）", async () => {
    chapterFile("", "第1章", 1)
    chapterFile("", "第2章", 2)
    chapterFile("", "第3章", 3)
    snapshot(1)
    snapshot(2)

    const result = await runBulkChapterIngest(project)

    expect(result.total).toBe(1)
    expect(result.succeeded).toBe(1)
    expect(ingestMock).toHaveBeenCalledTimes(1)
    expect(ingestMock.mock.calls[0][1]).toContain("第3章")
  })

  it("mode=all 连已有快照的章节一起重提取", async () => {
    chapterFile("", "第1章", 1)
    chapterFile("", "第2章", 2)
    snapshot(1)
    snapshot(2)

    const result = await runBulkChapterIngest(project, { mode: "all" })

    expect(result.total).toBe(2)
    expect(ingestMock).toHaveBeenCalledTimes(2)
  })

  it("子目录里的章节也要看得见（真实项目的章节常放在分卷目录下）", async () => {
    chapterFile("第一卷/", "第1章", 1)
    chapterFile("", "第2章", 2)

    const result = await runBulkChapterIngest(project)

    expect(result.total).toBe(2)
  })

  it("子目录形式的章节号也能认出来（chapter-010.md 这类命名）", async () => {
    chapterFile("第一卷/", "chapter-010", 10)

    const result = await runBulkChapterIngest(project)

    expect(result.total).toBe(1)
    expect(ingestMock.mock.calls[0][4]).toBe(10)
  })
})

describe("runBulkChapterIngest：进度任务", () => {
  beforeEach(() => {
    io.files.clear()
    ingestMock.mockReset()
    ingestMock.mockImplementation(async () => ({ snapshot: { chapterNumber: 1 } }))
    useImportProgressStore.setState({ tasks: [] })
  })

  it("创建一条 kind=chapter 的进度任务（这样树里的进度条与取消按钮才有东西可显示）", async () => {
    chapterFile("", "第1章", 1)
    chapterFile("", "第2章", 2)

    await runBulkChapterIngest(project)

    // finishTask 会 prune 掉已结束的任务到最近 3 条，所以这里还能看到它
    const task = runningTasks().find((item) => item.kind === "chapter")
    expect(task, "章节一键提取必须创建进度任务，否则界面全程无反馈").toBeTruthy()
    expect(task!.total).toBe(2)
  })

  it("每章都点亮 activeChapterPaths，结束时清空", async () => {
    chapterFile("", "第1章", 1)
    const seen: Array<string[] | undefined> = []
    ingestMock.mockImplementation(async () => {
      seen.push(runningTasks()[0]?.activeChapterPaths)
      return { snapshot: { chapterNumber: 1 } }
    })

    await runBulkChapterIngest(project)

    expect(seen[0]?.some((path) => path.includes("第1章"))).toBe(true)
    // finishTask 由 store 自己清空，避免残留让绿点永远显示「提取中」
    expect(runningTasks()[0]?.activeChapterPaths).toEqual([])
  })

  it("把 abort signal 传给 ingestChapter（取消才刹得住）", async () => {
    chapterFile("", "第1章", 1)

    await runBulkChapterIngest(project)

    expect(ingestMock.mock.calls[0][3]).toBeInstanceOf(AbortSignal)
  })

  it("以 allowDraft 调用 ingestChapter：草稿章节也要能提取（右键菜单的既有语义）", async () => {
    chapterFile("", "第1章", 1)

    await runBulkChapterIngest(project)

    expect(ingestMock.mock.calls[0][5]).toEqual({ allowDraft: true })
  })

  it("取消后停止循环、不继续提取后面的章节，并回报 cancelled", async () => {
    chapterFile("", "第1章", 1)
    chapterFile("", "第2章", 2)
    chapterFile("", "第3章", 3)
    let calls = 0
    ingestMock.mockImplementation(async () => {
      calls += 1
      if (calls === 1) {
        const task = runningTasks().find((item) => item.kind === "chapter")!
        useImportProgressStore.getState().cancelTask(task.id)
      }
      return { snapshot: { chapterNumber: 1 } }
    })

    const result = await runBulkChapterIngest(project)

    expect(ingestMock).toHaveBeenCalledTimes(1)
    expect(result.cancelled).toBe(true)
    expect(runningTasks().find((item) => item.kind === "chapter")?.status).toBe("cancelled")
  })

  it("结束后把成功/失败数量写进 message", async () => {
    chapterFile("", "第1章", 1)
    chapterFile("", "第2章", 2)
    let calls = 0
    ingestMock.mockImplementation(async () => {
      calls += 1
      if (calls === 2) return { snapshot: null, failReason: "extract_failed", error: "模型没吐正文" }
      return { snapshot: { chapterNumber: 1 } }
    })

    const result = await runBulkChapterIngest(project)

    expect(result.failed).toBe(1)
    const task = runningTasks().find((item) => item.kind === "chapter")!
    expect(task.status).toBe("error")
    expect(task.message).toContain("成功 1 个")
    expect(task.message).toContain("模型没吐正文")
  })

  it("失败原因带回 failures 明细（不是只说一句「提取失败」）", async () => {
    chapterFile("", "第1章", 1)
    ingestMock.mockImplementation(async () => ({ snapshot: null, error: "模型不可用" }))

    const result = await runBulkChapterIngest(project)

    expect(result.failures).toEqual([{ name: "第1章", reason: "模型不可用" }])
  })

  it("ingestChapter 抛异常不中断整批，算这一章失败", async () => {
    chapterFile("", "第1章", 1)
    chapterFile("", "第2章", 2)
    let calls = 0
    ingestMock.mockImplementation(async () => {
      calls += 1
      if (calls === 1) throw new Error("网络断了")
      return { snapshot: { chapterNumber: 2 } }
    })

    const result = await runBulkChapterIngest(project)

    expect(result.failed).toBe(1)
    expect(result.succeeded).toBe(1)
    expect(result.failures[0].reason).toContain("网络断了")
  })
})

describe("runBulkChapterIngest：目标集合与空集", () => {
  beforeEach(() => {
    io.files.clear()
    ingestMock.mockReset()
    ingestMock.mockImplementation(async () => ({ snapshot: { chapterNumber: 1 } }))
    useImportProgressStore.setState({ tasks: [] })
  })

  it("显式传入章节列表时不再扫盘（右键菜单那条路用的是树里已经算好的页）", async () => {
    chapterFile("", "第9章", 9)

    const result = await runBulkChapterIngest(project, {
      chapters: [{ path: `${project}/wiki/chapters/别的.md`, title: "别的", chapterNumber: 3 }],
    })

    expect(result.total).toBe(1)
    expect(ingestMock.mock.calls[0][1]).toContain("别的.md")
    expect(ingestMock.mock.calls[0][4]).toBe(3)
  })

  it("目录不存在时报 no_chapters", async () => {
    const result = await runBulkChapterIngest("C:/empty")

    expect(result.total).toBe(0)
    expect(result.emptyReason).toBe("no_chapters")
  })

  it("全部都已提取过时报 already_extracted", async () => {
    chapterFile("", "第1章", 1)
    snapshot(1)

    const result = await runBulkChapterIngest(project)

    expect(result.total).toBe(0)
    expect(result.emptyReason).toBe("already_extracted")
  })

  it("没有可提取章节时不创建进度任务（不留一条空任务在界面上）", async () => {
    const result = await runBulkChapterIngest("C:/empty")

    expect(result.total).toBe(0)
    expect(runningTasks()).toHaveLength(0)
  })
})

describe("formatBulkChapterIngestResult", () => {
  it("取消时说清楚已完成多少", () => {
    const text = formatBulkChapterIngestResult({
      total: 5,
      succeeded: 2,
      failed: 0,
      cancelled: true,
      failures: [],
    })
    expect(text).toContain("已取消")
    expect(text).toContain("2")
  })

  it("全部已提取过时给专门的文案", () => {
    expect(
      formatBulkChapterIngestResult({ total: 0, succeeded: 0, failed: 0, cancelled: false, failures: [], emptyReason: "already_extracted" }),
    ).toContain("都已提取")
  })
})
