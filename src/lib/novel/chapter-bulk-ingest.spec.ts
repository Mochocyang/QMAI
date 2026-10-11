import { beforeEach, describe, expect, it, vi } from "vitest"
import { useImportProgressStore } from "@/stores/import-progress-store"

const io = vi.hoisted(() => ({ files: new Map<string, string>() }))

/**
 * 让 `fileExists` 挂起的闸门：用来观察「筛选待提取章节」那段时间里
 * 界面上到底有没有一条真实任务。
 */
const gate = vi.hoisted(() => ({ blockFileExists: null as Promise<void> | null }))

vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!io.files.has(path)) throw new Error(`文件缺失：${path}`)
    return io.files.get(path)!
  },
  fileExists: async (path: string) => {
    if (gate.blockFileExists) await gate.blockFileExists
    return io.files.has(path)
  },
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
    gate.blockFileExists = null
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
    gate.blockFileExists = null
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

  /*
   * 上面那条只断言了 status —— 而 cancelTask 自己就会把状态写成 cancelled，
   * 所以「任务结算文案有没有补上」它根本管不着。用户能看到的恰恰是那句文案：
   * 少了它，任务栏会一直停在「正在一键提取章节记忆」的旧文案上。
   */
  it("取消时把「已完成几个」补进任务文案，不留着「正在一键提取」的旧文案", async () => {
    chapterFile("", "第1章", 1)
    chapterFile("", "第2章", 2)
    let calls = 0
    ingestMock.mockImplementation(async () => {
      calls += 1
      if (calls === 1) {
        const task = runningTasks().find((item) => item.kind === "chapter")!
        useImportProgressStore.getState().cancelTask(task.id)
      }
      return { snapshot: { chapterNumber: 1 } }
    })

    await runBulkChapterIngest(project)

    const task = runningTasks().find((item) => item.kind === "chapter")!
    expect(task.status).toBe("cancelled")
    expect(task.completed).toBe(1)
    expect(task.total).toBe(2)
    expect(task.message).toContain("已取消")
    expect(task.message).toContain("1/2")
    expect(task.message).not.toContain("正在一键提取")
    // 取消后不该留着点亮状态，否则那一行永远显示「提取中」
    expect(task.activeChapterPaths).toEqual([])
  })

  it("筛选待提取章节期间就已经有一条真实任务（那几秒图标也该在转）", async () => {
    chapterFile("", "第1章", 1)
    chapterFile("", "第2章", 2)

    let release = () => {}
    gate.blockFileExists = new Promise<void>((resolve) => { release = resolve })

    const running = runBulkChapterIngest(project)
    // 让筛选循环推进到 fileExists 并挂住
    for (let index = 0; index < 5; index += 1) await Promise.resolve()

    const duringScan = runningTasks().find((item) => item.kind === "chapter")
    expect(duringScan, "筛选阶段没有任务的话，那几秒图标是静的、取消是灰的").toBeTruthy()
    expect(duringScan!.status).toBe("running")
    expect(duringScan!.message).toContain("检查待提取")

    release()
    expect((await running).total).toBe(2)
  })

  it("筛选阶段取消也要收尾，不留一条永远 running 的任务", async () => {
    chapterFile("", "第1章", 1)

    let release = () => {}
    gate.blockFileExists = new Promise<void>((resolve) => { release = resolve })

    const running = runBulkChapterIngest(project)
    for (let index = 0; index < 5; index += 1) await Promise.resolve()

    const task = runningTasks().find((item) => item.kind === "chapter")!
    useImportProgressStore.getState().cancelTask(task.id)
    release()

    const result = await running
    expect(result.cancelled).toBe(true)
    expect(result.succeeded).toBe(0)
    expect(ingestMock).not.toHaveBeenCalled()
    const settled = runningTasks().find((item) => item.kind === "chapter")!
    expect(settled.status).toBe("cancelled")
    expect(settled.message).toContain("已取消")
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
    gate.blockFileExists = null
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

  /*
   * 回归：算不出章号的章节以前被整章静默跳过，而 mode=all 还会回一句
   * 「所有章节都已提取过」—— 用户明明按的是「提取全部」，却被告知没事可做，
   * 那个文件就永远躺在那里没人提取。
   */
  it("算不出章号的章节不会被静默丢掉：放行让 ingestChapter 明确报错并计入失败", async () => {
    // 文件名没有数字、frontmatter 也没有 chapter_number
    const path = `${project}/wiki/chapters/序章.md`
    io.files.set(path, "---\ntype: chapter\nstatus: final\n---\n\n正文\n")
    ingestMock.mockImplementation(async () => ({ snapshot: null, failReason: "invalid_chapter_number", error: "章节号无效" }))

    const result = await runBulkChapterIngest(project, {
      mode: "all",
      chapters: [{ path, title: "序章" }],
    })

    expect(ingestMock, "不能悄悄跳过，必须真的交给摄取去处理").toHaveBeenCalledTimes(1)
    expect(result.total).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.failures[0].reason).toContain("章节号无效")
    // 按了「提取全部」就不能回「都已提取过」
    expect(result.emptyReason).toBeUndefined()
  })

  it("调用方给了 fileChapterNumber 就用它，不必再读盘（树算不出章号时的兜底）", async () => {
    const path = `${project}/wiki/chapters/无名.md`
    io.files.set(path, "---\ntype: chapter\nstatus: final\n---\n\n正文\n")

    const result = await runBulkChapterIngest(project, {
      chapters: [{ path, title: "无名", fileChapterNumber: 7 }],
    })

    expect(result.total).toBe(1)
    expect(ingestMock.mock.calls[0][4]).toBe(7)
  })

  it("mode=all 与 pending 的差别只在快照过滤：all 要连已提取的一起重来", async () => {
    chapterFile("", "第1章", 1)
    snapshot(1)

    const pendingRun = await runBulkChapterIngest(project, { mode: "pending" })
    expect(pendingRun.total).toBe(0)
    expect(pendingRun.emptyReason).toBe("already_extracted")

    const allRun = await runBulkChapterIngest(project, { mode: "all" })
    expect(allRun.total).toBe(1)
    expect(allRun.succeeded).toBe(1)
    // all 档即使真的没有候选，也不该报 already_extracted —— 那是 pending 的说法
    expect(allRun.emptyReason).toBeUndefined()
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
