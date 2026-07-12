import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BatchImportCheckpoint, BatchImportTask } from "./batch-import-types"

const fsMocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  directories: new Set<string>(),
  readFile: vi.fn<(path: string) => Promise<string>>(),
  writeFile: vi.fn<(path: string, contents: string) => Promise<void>>(),
  writeFileAtomic: vi.fn<(path: string, contents: string) => Promise<void>>(),
  createDirectory: vi.fn<(path: string) => Promise<void>>(),
  copyDirectory: vi.fn<(source: string, destination: string) => Promise<string[]>>(),
  deleteFile: vi.fn<(path: string) => Promise<void>>(),
  fileExists: vi.fn<(path: string) => Promise<boolean>>(),
  listDirectory: vi.fn(),
}))

const libraryMocks = vi.hoisted(() => ({
  findBookLibraryEntry: vi.fn(),
  removeBookLibraryEntry: vi.fn(),
  upsertBookLibraryEntry: vi.fn(),
}))

const storageMocks = vi.hoisted(() => ({
  withBatchImportTaskLock: vi.fn(),
  cleanupCompletedTaskWorkspaceUnlocked: vi.fn(),
  loadTaskCheckpoint: vi.fn(),
  saveBatchImportTaskUnlocked: vi.fn(),
  saveTaskCheckpointUnlocked: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({
  readFile: fsMocks.readFile,
  writeFile: fsMocks.writeFile,
  writeFileAtomic: fsMocks.writeFileAtomic,
  createDirectory: fsMocks.createDirectory,
  copyDirectory: fsMocks.copyDirectory,
  deleteFile: fsMocks.deleteFile,
  fileExists: fsMocks.fileExists,
  listDirectory: fsMocks.listDirectory,
}))

vi.mock("./library-store", () => ({
  findBookLibraryEntry: libraryMocks.findBookLibraryEntry,
  removeBookLibraryEntry: libraryMocks.removeBookLibraryEntry,
  upsertBookLibraryEntry: libraryMocks.upsertBookLibraryEntry,
}))

vi.mock("./batch-import-storage", () => ({
  cleanupCompletedTaskWorkspaceUnlocked: storageMocks.cleanupCompletedTaskWorkspaceUnlocked,
  importTaskDir: (projectPath: string, taskId: string) => (
    `${projectPath}/book-analysis/import-tasks/${taskId}`
  ),
  withBatchImportTaskLock: storageMocks.withBatchImportTaskLock,
  loadTaskCheckpoint: storageMocks.loadTaskCheckpoint,
  saveBatchImportTaskUnlocked: storageMocks.saveBatchImportTaskUnlocked,
  saveTaskCheckpointUnlocked: storageMocks.saveTaskCheckpointUnlocked,
}))

import {
  buildChapterMarkdown,
  parseNovelChapters,
  splitNovelIntoChapters,
} from "./analysis-engine"
import { hashNormalizedNovel } from "./batch-import-hash"
import { runBatchImportTask } from "./batch-import-engine"

const SOURCE_CONTENT = [
  "第一章 起",
  "正文甲",
  "第二章 承",
  "正文乙",
  "第三章 终",
  "正文丙",
].join("\n")
const PROJECT_PATH = "E:/Novel"
const TASK_DIR = `${PROJECT_PATH}/book-analysis/import-tasks/task-1`
const CACHED_SOURCE_PATH = `${TASK_DIR}/source.txt`
const BOOK_PATH = `${PROJECT_PATH}/book-analysis/book-fixed`

let checkpoint: BatchImportCheckpoint | null
let task: BatchImportTask
let sourceSha256: string
let lockActive: boolean
let savedTasks: BatchImportTask[]
let operations: string[]
let libraryBookIds: Set<string>

function workspaceChapterPath(index: number): string {
  return `${TASK_DIR}/chapters/ch-${String(index + 1).padStart(4, "0")}.md`
}

function seedChapter(index: number, contents?: string): void {
  const chapter = parseNovelChapters(SOURCE_CONTENT)[index]
  fsMocks.files.set(
    workspaceChapterPath(index),
    contents ?? buildChapterMarkdown(task.bookId, chapter),
  )
}

function seedCheckpoint(completedChapterIndexes: number[]): void {
  const chapters = parseNovelChapters(SOURCE_CONTENT)
  checkpoint = {
    version: 1,
    sourceSha256,
    totalChapters: chapters.length,
    completedChapterIndexes,
    totalWords: completedChapterIndexes.reduce(
      (sum, index) => sum + chapters[index].content.length,
      0,
    ),
    updatedAt: 100,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(async () => {
  vi.clearAllMocks()
  fsMocks.files.clear()
  fsMocks.directories.clear()
  checkpoint = null
  lockActive = false
  savedTasks = []
  operations = []
  libraryBookIds = new Set()
  sourceSha256 = await hashNormalizedNovel(SOURCE_CONTENT)
  task = {
    version: 1,
    id: "task-1",
    batchId: "batch-1",
    projectPath: PROJECT_PATH,
    originalPath: "E:/Sources/长夜.txt",
    originalFileName: "长夜.txt",
    cachedSourcePath: CACHED_SOURCE_PATH,
    sourceSha256,
    requestedTitle: "长夜",
    finalTitle: "长夜（2）",
    bookId: "book-fixed",
    status: "splitting",
    completed: 0,
    total: 0,
    error: "软件上次关闭时任务尚未完成",
    skipReason: null,
    createdAt: 100,
    startedAt: 110,
    completedAt: null,
    updatedAt: 120,
  }
  fsMocks.files.set(CACHED_SOURCE_PATH, SOURCE_CONTENT)

  fsMocks.readFile.mockImplementation(async (path) => {
    if (path === CACHED_SOURCE_PATH && !lockActive) {
      throw new Error("缓存验证未持有任务锁")
    }
    const contents = fsMocks.files.get(path)
    if (contents === undefined) throw new Error(`文件不存在：${path}`)
    return contents
  })
  fsMocks.writeFile.mockImplementation(async (path, contents) => {
    operations.push(`write:${path}`)
    fsMocks.files.set(path, contents)
  })
  fsMocks.writeFileAtomic.mockImplementation(async (path, contents) => {
    if (!lockActive) {
      throw new Error("批量导入原子写入未持有任务锁")
    }
    operations.push(`atomic:${path}`)
    fsMocks.files.set(path, contents)
  })
  fsMocks.createDirectory.mockImplementation(async (path) => {
    operations.push(`mkdir:${path}`)
    fsMocks.directories.add(path)
  })
  fsMocks.copyDirectory.mockImplementation(async (source, destination) => {
    operations.push(`copy:${source}->${destination}`)
    const copied: string[] = []
    for (const [path, contents] of [...fsMocks.files.entries()]) {
      if (!path.startsWith(`${source}/`)) continue
      const target = `${destination}${path.slice(source.length)}`
      fsMocks.files.set(target, contents)
      copied.push(target)
    }
    return copied
  })
  fsMocks.deleteFile.mockImplementation(async (path) => {
    operations.push(`delete:${path}`)
    fsMocks.files.delete(path)
  })
  fsMocks.fileExists.mockImplementation(async (path) => (
    fsMocks.files.has(path) || fsMocks.directories.has(path)
  ))
  fsMocks.listDirectory.mockResolvedValue([])

  libraryMocks.findBookLibraryEntry.mockResolvedValue(undefined)
  libraryMocks.removeBookLibraryEntry.mockImplementation(async (
    _projectPath: string,
    bookId: string,
  ) => {
    operations.push("library:remove")
    libraryBookIds.delete(bookId)
  })
  libraryMocks.upsertBookLibraryEntry.mockImplementation(async (
    _projectPath: string,
    entry: { bookId: string },
  ) => {
    operations.push("library:upsert")
    libraryBookIds.add(entry.bookId)
  })
  storageMocks.withBatchImportTaskLock.mockImplementation(async (...args: unknown[]) => {
    const action = args.at(-1)
    if (typeof action !== "function") throw new Error("任务锁缺少执行函数")
    lockActive = true
    try {
      return await action()
    } finally {
      lockActive = false
    }
  })
  storageMocks.cleanupCompletedTaskWorkspaceUnlocked.mockImplementation(async () => {
    if (!lockActive) throw new Error("完成清理未持有任务锁")
    operations.push("cleanup:completed-workspace")
  })
  storageMocks.loadTaskCheckpoint.mockImplementation(async () => {
    if (!lockActive) throw new Error("检查点读取未持有任务锁")
    return checkpoint
  })
  storageMocks.saveTaskCheckpointUnlocked.mockImplementation(
    async (_task: BatchImportTask, next: BatchImportCheckpoint) => {
      if (!lockActive) throw new Error("检查点保存未持有任务锁")
      operations.push(`checkpoint:${next.completedChapterIndexes.join(",")}`)
      checkpoint = structuredClone(next)
    },
  )
  storageMocks.saveBatchImportTaskUnlocked.mockImplementation(
    async (next: BatchImportTask) => {
      if (!lockActive) throw new Error("任务保存未持有任务锁")
      operations.push(`task:${next.status}`)
      savedTasks.push(structuredClone(next))
    },
  )
})

describe("analysis engine chapter helpers", () => {
  it("解析章节时保持旧拆分规则、章节顺序和正文内容", () => {
    const chapters = parseNovelChapters(
      "作品前言\n第一章 开始\n这是正文一\n第二章 继续\n这是正文二",
    )

    expect(chapters).toEqual([
      { title: "第一章 开始", content: "第一章 开始\n这是正文一", order: 1 },
      { title: "第二章 继续", content: "第二章 继续\n这是正文二", order: 2 },
    ])
  })

  it("没有章节标记时保留旧中文错误", () => {
    expect(() => parseNovelChapters("没有章节标题")).toThrow(
      "未能识别到章节标记，请确保小说文件包含\"第X章\"格式的章节标题",
    )
  })

  it("构建与旧引擎相同的章节 Markdown", () => {
    expect(buildChapterMarkdown("book-fixed", {
      title: "第一章 开始",
      content: "第一章 开始\n正文",
      order: 1,
    })).toBe(`---
id: ch-0001
title: 第一章 开始
order: 1
wordCount: 9
---

第一章 开始
正文
`)
  })

  it("旧 splitNovelIntoChapters API 仍按原路径和格式写入", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1234)
    const sourcePath = "E:/Sources/旧入口.txt"
    fsMocks.files.set(sourcePath, "第一章 开始\n正文\n第二章 结束\n尾声")

    const result = await splitNovelIntoChapters(
      sourcePath,
      PROJECT_PATH,
      {} as never,
    )

    expect(result.bookId).toBe("book-1234")
    expect(result.chapters).toEqual([
      {
        id: "ch-0001",
        title: "第一章 开始",
        order: 1,
        wordCount: 9,
        path: "E:/Novel/book-analysis/book-1234/chapters/ch-0001.md",
      },
      {
        id: "ch-0002",
        title: "第二章 结束",
        order: 2,
        wordCount: 9,
        path: "E:/Novel/book-analysis/book-1234/chapters/ch-0002.md",
      },
    ])
    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      "E:/Novel/book-analysis/book-1234/chapters/ch-0001.md",
      buildChapterMarkdown("book-1234", {
        title: "第一章 开始",
        content: "第一章 开始\n正文",
        order: 1,
      }),
    )
    expect(libraryMocks.upsertBookLibraryEntry).toHaveBeenCalledTimes(1)
  })
})

describe("runBatchImportTask", () => {
  it.each(["completed", "skipped"] as const)(
    "直接调用 engine 时拒绝终态 %s 且不写正式目录",
    async (status) => {
      task = { ...task, status }

      await expect(runBatchImportTask(task, {
        signal: new AbortController().signal,
      })).rejects.toThrow("批量导入任务状态不允许执行")

      expect(fsMocks.createDirectory).not.toHaveBeenCalled()
      expect(fsMocks.copyDirectory).not.toHaveBeenCalled()
      expect(fsMocks.writeFileAtomic).not.toHaveBeenCalled()
      expect(libraryMocks.upsertBookLibraryEntry).not.toHaveBeenCalled()
      expect(storageMocks.saveBatchImportTaskUnlocked).not.toHaveBeenCalled()
    },
  )

  it("继续时跳过已验证章节并从首个缺失章节写入", async () => {
    seedCheckpoint([0, 1])
    seedChapter(0)
    seedChapter(1)

    const result = await runBatchImportTask(task, {
      signal: new AbortController().signal,
    })

    const workspaceWrites = fsMocks.writeFileAtomic.mock.calls
      .map(([path]) => path)
      .filter((path) => path.startsWith(`${TASK_DIR}/chapters/`))
    expect(workspaceWrites).toEqual([workspaceChapterPath(2)])
    expect(storageMocks.withBatchImportTaskLock).toHaveBeenCalledWith(
      PROJECT_PATH,
      "task-1",
      expect.any(Function),
    )
    expect(result.chapters).toHaveLength(3)
    expect(checkpoint?.completedChapterIndexes).toEqual([0, 1, 2])
  })

  it.each([
    ["非空正文被篡改", (markdown: string) => markdown.replace("正文乙", "正文被篡改")],
    ["title 损坏", (markdown: string) => markdown.replace("title: 第二章 承", "title: 损坏")],
    ["wordCount 损坏", (markdown: string) => markdown.replace(/wordCount: \d+/, "wordCount: 999")],
  ])("已完成章节%s时从该章开始重写后续章节", async (_label, damage) => {
    seedCheckpoint([0, 1, 2])
    seedChapter(0)
    const secondChapter = parseNovelChapters(SOURCE_CONTENT)[1]
    seedChapter(1, damage(buildChapterMarkdown(task.bookId, secondChapter)))
    seedChapter(2)

    await runBatchImportTask(task, {
      signal: new AbortController().signal,
    })

    const workspaceWrites = fsMocks.writeFileAtomic.mock.calls
      .map(([path]) => path)
      .filter((path) => path.startsWith(`${TASK_DIR}/chapters/`))
    expect(workspaceWrites).toEqual([
      workspaceChapterPath(1),
      workspaceChapterPath(2),
    ])
  })

  it("checkpoint JSON 损坏时警告并从第一章重来", async () => {
    seedCheckpoint([0, 1, 2])
    seedChapter(0)
    seedChapter(1)
    seedChapter(2)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    storageMocks.loadTaskCheckpoint.mockRejectedValueOnce(new SyntaxError("JSON 格式错误"))

    await runBatchImportTask(task, {
      signal: new AbortController().signal,
    })

    const workspaceWrites = fsMocks.writeFileAtomic.mock.calls
      .map(([path]) => path)
      .filter((path) => path.startsWith(`${TASK_DIR}/chapters/`))
    expect(workspaceWrites).toEqual([
      workspaceChapterPath(0),
      workspaceChapterPath(1),
      workspaceChapterPath(2),
    ])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("checkpoint 数据损坏"),
      expect.any(SyntaxError),
    )
  })

  it("checkpoint 真实读取错误继续向上抛出", async () => {
    storageMocks.loadTaskCheckpoint.mockRejectedValueOnce(new Error("磁盘读取失败"))

    await expect(runBatchImportTask(task, {
      signal: new AbortController().signal,
    })).rejects.toThrow("磁盘读取失败")

    expect(fsMocks.writeFileAtomic).not.toHaveBeenCalled()
  })

  it("运行中取消会抛中文错误且不写 metadata", async () => {
    const controller = new AbortController()

    await expect(runBatchImportTask(task, {
      signal: controller.signal,
      onProgress: (completed) => {
        if (completed === 1) controller.abort()
      },
    })).rejects.toThrow("用户取消导入")

    expect(fsMocks.writeFileAtomic.mock.calls.some(
      ([path]) => path.endsWith("/metadata.json"),
    )).toBe(false)
    expect(libraryMocks.upsertBookLibraryEntry).not.toHaveBeenCalled()
    expect(savedTasks.some((saved) => saved.status === "completed")).toBe(false)
  })

  it("metadata 写入期间发生 abort 仍完成提交", async () => {
    const controller = new AbortController()
    const writeAtomic = fsMocks.writeFileAtomic.getMockImplementation()!
    fsMocks.writeFileAtomic.mockImplementation(async (path, contents) => {
      await writeAtomic(path, contents)
      if (path === `${BOOK_PATH}/metadata.json`) controller.abort()
    })

    const result = await runBatchImportTask(task, { signal: controller.signal })

    expect(controller.signal.aborted).toBe(true)
    expect(result.task.status).toBe("completed")
    expect(savedTasks.at(-1)?.status).toBe("completed")
    expect(libraryBookIds.has(task.bookId)).toBe(true)
  })

  it("library 写入期间发生 abort 仍完成提交", async () => {
    const controller = new AbortController()
    libraryMocks.upsertBookLibraryEntry.mockImplementationOnce(async (
      _projectPath: string,
      entry: { bookId: string },
    ) => {
      operations.push("library:upsert")
      libraryBookIds.add(entry.bookId)
      controller.abort()
    })

    const result = await runBatchImportTask(task, { signal: controller.signal })

    expect(controller.signal.aborted).toBe(true)
    expect(result.task.status).toBe("completed")
    expect(savedTasks.at(-1)?.status).toBe("completed")
    expect(libraryBookIds.has(task.bookId)).toBe(true)
  })
  it("缓存 source 的 SHA-256 不匹配时停止且不发布", async () => {
    task = { ...task, sourceSha256: "0".repeat(64) }

    await expect(runBatchImportTask(task, {
      signal: new AbortController().signal,
    })).rejects.toThrow("缓存源文件校验失败")

    expect(fsMocks.writeFileAtomic).not.toHaveBeenCalled()
    expect(libraryMocks.upsertBookLibraryEntry).not.toHaveBeenCalled()
  })

  it("正式发布先复制章节和原子写 source，metadata 最后写入，再更新索引和任务", async () => {
    vi.spyOn(Date, "now").mockReturnValue(999)

    const result = await runBatchImportTask(task, {
      signal: new AbortController().signal,
    })

    const copyIndex = operations.indexOf(`copy:${TASK_DIR}/chapters->${BOOK_PATH}/chapters`)
    const sourceIndex = operations.indexOf(`atomic:${BOOK_PATH}/source.txt`)
    const metadataIndex = operations.indexOf(`atomic:${BOOK_PATH}/metadata.json`)
    const libraryIndex = operations.indexOf("library:upsert")
    const taskIndex = operations.indexOf("task:completed")
    expect(copyIndex).toBeGreaterThanOrEqual(0)
    expect(sourceIndex).toBeGreaterThan(copyIndex)
    expect(metadataIndex).toBeGreaterThan(sourceIndex)
    expect(libraryIndex).toBeGreaterThan(metadataIndex)
    expect(taskIndex).toBeGreaterThan(libraryIndex)
    expect(result.metadata).toEqual(expect.objectContaining({
      title: "长夜（2）",
      totalChapters: 3,
      createdAt: 100,
      updatedAt: 999,
    }))
  })

  it("作品索引保存完整 SHA 且 sourcePath 指向正式 source", async () => {
    await runBatchImportTask(task, {
      signal: new AbortController().signal,
    })

    expect(libraryMocks.upsertBookLibraryEntry).toHaveBeenCalledWith(
      PROJECT_PATH,
      expect.objectContaining({
        bookId: "book-fixed",
        title: "长夜（2）",
        sourcePath: `${BOOK_PATH}/source.txt`,
        contentSha256: sourceSha256,
        status: "completed",
      }),
    )
    expect(savedTasks.at(-1)).toEqual(expect.objectContaining({
      status: "completed",
      cachedSourcePath: `${BOOK_PATH}/source.txt`,
      completed: 3,
      total: 3,
    }))
  })

  it("索引更新失败时回滚 metadata 和索引且不把任务标记为完成", async () => {
    libraryMocks.upsertBookLibraryEntry.mockRejectedValueOnce(new Error("索引保存失败"))

    await expect(runBatchImportTask(task, {
      signal: new AbortController().signal,
    })).rejects.toThrow("索引保存失败")

    expect(fsMocks.files.has(`${BOOK_PATH}/metadata.json`)).toBe(false)
    expect(libraryMocks.removeBookLibraryEntry).toHaveBeenCalledWith(PROJECT_PATH, task.bookId)
    expect(libraryBookIds.has(task.bookId)).toBe(false)
    expect(savedTasks.some((saved) => saved.status === "completed")).toBe(false)
    expect(fsMocks.files.has(`${BOOK_PATH}/source.txt`)).toBe(true)
    expect(fsMocks.files.has(`${BOOK_PATH}/chapters/ch-0001.md`)).toBe(true)
  })

  it("metadata 写入失败时回滚可见标志但保留正式章节和 source", async () => {
    const writeAtomic = fsMocks.writeFileAtomic.getMockImplementation()!
    fsMocks.writeFileAtomic.mockImplementation(async (path, contents) => {
      await writeAtomic(path, contents)
      if (path === `${BOOK_PATH}/metadata.json`) throw new Error("metadata 保存失败")
    })

    await expect(runBatchImportTask(task, {
      signal: new AbortController().signal,
    })).rejects.toThrow("metadata 保存失败")

    expect(fsMocks.files.has(`${BOOK_PATH}/metadata.json`)).toBe(false)
    expect(libraryMocks.removeBookLibraryEntry).toHaveBeenCalledWith(PROJECT_PATH, task.bookId)
    expect(fsMocks.files.has(`${BOOK_PATH}/source.txt`)).toBe(true)
    expect(fsMocks.files.has(`${BOOK_PATH}/chapters/ch-0001.md`)).toBe(true)
  })

  it("library 成功但 completed 任务保存失败时回滚可见提交点", async () => {
    storageMocks.saveBatchImportTaskUnlocked.mockRejectedValueOnce(new Error("任务状态保存失败"))

    await expect(runBatchImportTask(task, {
      signal: new AbortController().signal,
    })).rejects.toThrow("任务状态保存失败")

    expect(fsMocks.files.has(`${BOOK_PATH}/metadata.json`)).toBe(false)
    expect(libraryBookIds.has(task.bookId)).toBe(false)
    expect(libraryMocks.removeBookLibraryEntry).toHaveBeenCalledWith(PROJECT_PATH, task.bookId)
    expect(savedTasks.some((saved) => saved.status === "completed")).toBe(false)
    expect(fsMocks.files.has(`${BOOK_PATH}/source.txt`)).toBe(true)
    expect(fsMocks.files.has(`${BOOK_PATH}/chapters/ch-0001.md`)).toBe(true)
  })

  it("提交回滚失败时仅警告并保留原始提交错误", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    storageMocks.saveBatchImportTaskUnlocked.mockRejectedValueOnce(new Error("原始任务保存失败"))
    libraryMocks.removeBookLibraryEntry.mockRejectedValueOnce(new Error("索引回滚失败"))
    fsMocks.deleteFile.mockRejectedValueOnce(new Error("metadata 回滚失败"))

    await expect(runBatchImportTask(task, {
      signal: new AbortController().signal,
    })).rejects.toThrow("原始任务保存失败")

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("回滚作品索引失败"),
      expect.any(Error),
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("回滚 metadata 失败"),
      expect.any(Error),
    )
  })

  it("完成持久化成功后清理工作区并保留原文副本", async () => {
    const result = await runBatchImportTask(task, {
      signal: new AbortController().signal,
    })

    expect(result.task.status).toBe("completed")
    expect(operations.indexOf("cleanup:completed-workspace")).toBeGreaterThan(
      operations.indexOf("task:completed"),
    )
    expect(storageMocks.cleanupCompletedTaskWorkspaceUnlocked).toHaveBeenCalledWith(result.task)
    expect(fsMocks.deleteFile).not.toHaveBeenCalledWith(CACHED_SOURCE_PATH)
    expect(fsMocks.files.get(CACHED_SOURCE_PATH)).toBe(SOURCE_CONTENT)
  })

  it("完成后清理失败仅中文警告且不降级 completed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    storageMocks.cleanupCompletedTaskWorkspaceUnlocked.mockRejectedValueOnce(new Error("目录占用"))

    const result = await runBatchImportTask(task, {
      signal: new AbortController().signal,
    })

    expect(result.task.status).toBe("completed")
    expect(savedTasks.at(-1)?.status).toBe("completed")
    expect(warn).toHaveBeenCalledWith(
      "批量导入：清理已完成任务工作区失败",
      expect.any(Error),
    )
  })

  it("任务完成持久化失败时不清理并保留章节断点", async () => {
    storageMocks.saveBatchImportTaskUnlocked.mockRejectedValueOnce(new Error("任务状态保存失败"))

    await expect(runBatchImportTask(task, {
      signal: new AbortController().signal,
    })).rejects.toThrow("任务状态保存失败")

    expect(storageMocks.cleanupCompletedTaskWorkspaceUnlocked).not.toHaveBeenCalled()
    expect(checkpoint?.completedChapterIndexes).toEqual([0, 1, 2])
  })
})
