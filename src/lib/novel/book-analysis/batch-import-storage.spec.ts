import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { __resetProjectLocksForTesting } from "@/lib/project-mutex"
import type {
  BatchImportBatch,
  BatchImportCheckpoint,
  BatchImportTask,
} from "./batch-import-types"

const fsMocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  directories: new Set<string>(),
  readFile: vi.fn<(path: string) => Promise<string>>(),
  writeFileAtomic: vi.fn<(path: string, contents: string) => Promise<void>>(),
  createDirectory: vi.fn<(path: string) => Promise<void>>(),
  copyFile: vi.fn<(source: string, destination: string) => Promise<void>>(),
  deleteFile: vi.fn<(path: string) => Promise<void>>(),
  fileExists: vi.fn<(path: string) => Promise<boolean>>(),
  listDirectory: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({
  readFile: fsMocks.readFile,
  writeFileAtomic: fsMocks.writeFileAtomic,
  createDirectory: fsMocks.createDirectory,
  copyFile: fsMocks.copyFile,
  deleteFile: fsMocks.deleteFile,
  fileExists: fsMocks.fileExists,
  listDirectory: fsMocks.listDirectory,
}))

import {
  cacheTaskSource,
  cleanupCompletedTaskWorkspaceUnlocked,
  importTaskDir,
  importTasksRoot,
  loadBatchImportBatches,
  loadBatchImportTasks,
  loadTaskCheckpoint,
  resetBatchImportTask,
  saveBatchImportBatch,
  saveBatchImportTask,
  saveBatchImportTaskUnlocked,
  saveTaskCheckpoint,
  saveTaskCheckpointUnlocked,
  withBatchImportTaskLock,
} from "./batch-import-storage"

function makeTask(overrides: Partial<BatchImportTask> = {}): BatchImportTask {
  return {
    version: 1,
    id: "task-1",
    batchId: "batch-1",
    projectPath: "E:/Novel",
    originalPath: "E:/Sources/长夜.txt",
    originalFileName: "长夜.txt",
    cachedSourcePath: "E:/Novel/book-analysis/import-tasks/task-1/source.txt",
    sourceSha256: null,
    requestedTitle: "长夜",
    finalTitle: null,
    bookId: "book-1",
    status: "queued",
    completed: 0,
    total: 0,
    error: null,
    skipReason: null,
    createdAt: 100,
    startedAt: null,
    completedAt: null,
    updatedAt: 100,
    ...overrides,
  }
}

function seedTask(task: BatchImportTask): void {
  const dir = importTaskDir(task.projectPath, task.id)
  fsMocks.directories.add(dir)
  fsMocks.files.set(`${dir}/task.json`, JSON.stringify(task))
}

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  __resetProjectLocksForTesting()
  vi.clearAllMocks()
  fsMocks.files.clear()
  fsMocks.directories.clear()

  fsMocks.readFile.mockImplementation(async (path) => {
    const contents = fsMocks.files.get(path)
    if (contents === undefined) throw new Error(`文件不存在：${path}`)
    return contents
  })
  fsMocks.writeFileAtomic.mockImplementation(async (path, contents) => {
    fsMocks.files.set(path, contents)
  })
  fsMocks.createDirectory.mockImplementation(async (path) => {
    fsMocks.directories.add(path)
  })
  fsMocks.copyFile.mockImplementation(async (source, destination) => {
    const contents = fsMocks.files.get(source)
    if (contents === undefined) throw new Error(`源文件不存在：${source}`)
    fsMocks.files.set(destination, contents)
  })
  fsMocks.deleteFile.mockImplementation(async (path) => {
    fsMocks.files.delete(path)
    for (const filePath of [...fsMocks.files.keys()]) {
      if (filePath.startsWith(`${path}/`)) fsMocks.files.delete(filePath)
    }
    fsMocks.directories.delete(path)
  })
  fsMocks.fileExists.mockImplementation(async (path) => (
    fsMocks.files.has(path) || fsMocks.directories.has(path)
  ))
  fsMocks.listDirectory.mockResolvedValue([])
})

describe("batch import storage", () => {
  it("生成稳定的批量导入任务目录", () => {
    expect(importTasksRoot("E:\\Novel\\")).toBe("E:/Novel/book-analysis/import-tasks")
    expect(importTaskDir("E:\\Novel\\", "task-1")).toBe(
      "E:/Novel/book-analysis/import-tasks/task-1",
    )
  })

  it("任务根目录不存在时返回空列表", async () => {
    await expect(loadBatchImportTasks("E:/Novel")).resolves.toEqual([])
    expect(fsMocks.listDirectory).not.toHaveBeenCalled()
    expect(fsMocks.readFile).not.toHaveBeenCalled()
  })

  it("任务目录存在但 task.json 缺失时跳过该目录", async () => {
    const root = importTasksRoot("E:/Novel")
    const dir = importTaskDir("E:/Novel", "task-missing-json")
    fsMocks.directories.add(root)
    fsMocks.directories.add(dir)
    fsMocks.listDirectory.mockResolvedValue([
      { name: "task-missing-json", path: dir, is_dir: true },
    ])

    await expect(loadBatchImportTasks("E:/Novel")).resolves.toEqual([])

    expect(fsMocks.fileExists).toHaveBeenCalledWith(`${dir}/task.json`)
    expect(fsMocks.readFile).not.toHaveBeenCalled()
  })

  it("加载时把遗留运行状态改为已中断，等待中任务保持不变", async () => {
    const copying = makeTask({ id: "task-copying", status: "copying" })
    const splitting = makeTask({ id: "task-splitting", status: "splitting" })
    const queued = makeTask({ id: "task-queued", status: "queued" })
    for (const task of [copying, splitting, queued]) seedTask(task)

    fsMocks.directories.add(importTasksRoot("E:/Novel"))
    fsMocks.listDirectory.mockResolvedValue(
      [copying, splitting, queued].map((task) => ({
        name: task.id,
        path: importTaskDir(task.projectPath, task.id),
        is_dir: true,
      })),
    )
    vi.spyOn(Date, "now").mockReturnValue(999)

    const tasks = await loadBatchImportTasks("E:/Novel")

    expect(tasks).toEqual([
      expect.objectContaining({
        id: "task-copying",
        status: "interrupted",
        error: "软件上次关闭时任务尚未完成",
        updatedAt: 999,
      }),
      expect.objectContaining({
        id: "task-splitting",
        status: "interrupted",
        error: "软件上次关闭时任务尚未完成",
        updatedAt: 999,
      }),
      expect.objectContaining({
        id: "task-queued",
        status: "queued",
        error: null,
        updatedAt: 100,
      }),
    ])
    expect(fsMocks.writeFileAtomic).toHaveBeenCalledTimes(2)
    expect(fsMocks.copyFile).not.toHaveBeenCalled()
  })

  it("原子保存任务并创建任务与章节目录", async () => {
    const task = makeTask()

    await saveBatchImportTask(task)

    const dir = importTaskDir(task.projectPath, task.id)
    expect(fsMocks.createDirectory).toHaveBeenCalledWith(dir)
    expect(fsMocks.createDirectory).toHaveBeenCalledWith(`${dir}/chapters`)
    expect(fsMocks.writeFileAtomic).toHaveBeenCalledWith(
      `${dir}/task.json`,
      JSON.stringify(task, null, 2),
    )
  })

  it("原子写入 source.txt 后重新读取缓存全文计算 SHA-256", async () => {
    const task = makeTask({ cachedSourcePath: "", sourceSha256: null })
    fsMocks.files.set(task.originalPath, "abc")
    fsMocks.readFile.mockImplementation(async (path) => {
      const contents = fsMocks.files.get(path)
      if (contents === undefined) throw new Error(`文件不存在：${path}`)
      if (path === task.originalPath) fsMocks.files.set(path, "复制后原路径已变化")
      return contents
    })

    const saved = await cacheTaskSource(task)

    const sourcePath = `${importTaskDir(task.projectPath, task.id)}/source.txt`
    expect(fsMocks.copyFile).not.toHaveBeenCalled()
    expect(fsMocks.writeFileAtomic).toHaveBeenCalledWith(sourcePath, "abc")
    expect(fsMocks.readFile.mock.calls.map(([path]) => path)).toEqual([
      task.originalPath,
      sourcePath,
    ])
    expect(fsMocks.files.get(task.originalPath)).toBe("复制后原路径已变化")
    expect(saved).toEqual(expect.objectContaining({
      cachedSourcePath: sourcePath,
      sourceSha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    }))
    expect(fsMocks.writeFileAtomic).toHaveBeenCalledWith(
      `${importTaskDir(task.projectPath, task.id)}/task.json`,
      JSON.stringify(saved, null, 2),
    )
  })

  it("将批次写入 batches.json，并按批次 ID 更新已有记录", async () => {
    const root = importTasksRoot("E:/Novel")
    const oldBatch: BatchImportBatch = {
      version: 1,
      id: "batch-1",
      projectPath: "E:/Novel",
      taskIds: ["task-old"],
      createdAt: 100,
      updatedAt: 100,
    }
    const otherBatch: BatchImportBatch = {
      ...oldBatch,
      id: "batch-2",
      taskIds: ["task-2"],
    }
    const updatedBatch: BatchImportBatch = {
      ...oldBatch,
      taskIds: ["task-1"],
      updatedAt: 200,
    }
    fsMocks.directories.add(root)
    fsMocks.files.set(`${root}/batches.json`, JSON.stringify([oldBatch, otherBatch]))

    await saveBatchImportBatch(updatedBatch)

    expect(fsMocks.writeFileAtomic).toHaveBeenCalledWith(
      `${root}/batches.json`,
      JSON.stringify([updatedBatch, otherBatch], null, 2),
    )
  })

  it("batches.json 缺失时不读取旧批次并直接原子保存新批次", async () => {
    const batch: BatchImportBatch = {
      version: 1,
      id: "batch-new",
      projectPath: "E:/Novel",
      taskIds: ["task-1"],
      createdAt: 100,
      updatedAt: 100,
    }
    const path = `${importTasksRoot(batch.projectPath)}/batches.json`

    await saveBatchImportBatch(batch)

    expect(fsMocks.fileExists).toHaveBeenCalledWith(path)
    expect(fsMocks.readFile).not.toHaveBeenCalled()
    expect(fsMocks.writeFileAtomic).toHaveBeenCalledWith(
      path,
      JSON.stringify([batch], null, 2),
    )
  })

  it("检查点不存在时返回 null，保存与加载均使用任务检查点路径", async () => {
    const task = makeTask()
    const checkpoint: BatchImportCheckpoint = {
      version: 1,
      sourceSha256: "sha",
      totalChapters: 2,
      completedChapterIndexes: [0],
      totalWords: 1200,
      updatedAt: 200,
    }

    await expect(loadTaskCheckpoint(task)).resolves.toBeNull()
    await saveTaskCheckpoint(task, checkpoint)
    await expect(loadTaskCheckpoint(task)).resolves.toEqual(checkpoint)

    const path = `${importTaskDir(task.projectPath, task.id)}/checkpoint.json`
    expect(fsMocks.writeFileAtomic).toHaveBeenCalledWith(
      path,
      JSON.stringify(checkpoint, null, 2),
    )
  })

  it("完成清理只删除当前任务 chapters 和 checkpoint 并保留 source 与 task", async () => {
    const task = makeTask({ status: "completed", sourceSha256: "sha" })
    seedTask(task)
    const dir = importTaskDir(task.projectPath, task.id)
    fsMocks.directories.add(`${dir}/chapters`)
    fsMocks.files.set(`${dir}/source.txt`, "原文副本")
    fsMocks.files.set(`${dir}/chapters/ch-0001.md`, "章节")
    fsMocks.files.set(`${dir}/checkpoint.json`, "检查点")

    await withBatchImportTaskLock(task.projectPath, task.id, async () => {
      await cleanupCompletedTaskWorkspaceUnlocked(task)
    })

    expect(fsMocks.deleteFile.mock.calls.map(([path]) => path)).toEqual([
      `${dir}/chapters`,
      `${dir}/checkpoint.json`,
    ])
    expect(fsMocks.files.get(`${dir}/source.txt`)).toBe("原文副本")
    expect(fsMocks.files.has(`${dir}/task.json`)).toBe(true)
    expect(fsMocks.files.has(`${dir}/chapters/ch-0001.md`)).toBe(false)
    expect(fsMocks.files.has(`${dir}/checkpoint.json`)).toBe(false)
  })

  it("失败任务拒绝完成清理并保留章节断点", async () => {
    const task = makeTask({ status: "failed", error: "拆分失败" })
    const dir = importTaskDir(task.projectPath, task.id)
    fsMocks.directories.add(`${dir}/chapters`)
    fsMocks.files.set(`${dir}/chapters/ch-0001.md`, "已完成章节")
    fsMocks.files.set(`${dir}/checkpoint.json`, "检查点")

    await expect(cleanupCompletedTaskWorkspaceUnlocked(task)).rejects.toThrow(
      "只能清理已完成的批量导入任务工作区",
    )

    expect(fsMocks.files.has(`${dir}/chapters/ch-0001.md`)).toBe(true)
    expect(fsMocks.files.has(`${dir}/checkpoint.json`)).toBe(true)
    expect(fsMocks.deleteFile).not.toHaveBeenCalled()
  })

  it("reset 目标章节和检查点均缺失时不执行删除", async () => {
    const task = makeTask({ status: "failed", error: "拆分失败" })
    seedTask(task)

    const reset = await resetBatchImportTask(task.projectPath, task.id)

    expect(fsMocks.deleteFile).not.toHaveBeenCalled()
    expect(reset.status).toBe("queued")
  })

  it("task.json 缺失时抛出中文错误且不执行删除", async () => {
    const dir = importTaskDir("E:/Novel", "task-missing")
    fsMocks.directories.add(dir)
    fsMocks.directories.add(`${dir}/chapters`)
    fsMocks.files.set(`${dir}/checkpoint.json`, "{}")

    await expect(
      resetBatchImportTask("E:/Novel", "task-missing"),
    ).rejects.toThrow("找不到批量导入任务：task-missing")

    expect(fsMocks.deleteFile).not.toHaveBeenCalled()
  })

  it("重新生成只删除当前任务的 chapters 和 checkpoint 并保留所有 source.txt", async () => {
    const task = makeTask({
      status: "failed",
      completed: 2,
      total: 5,
      error: "拆分失败",
      skipReason: "旧原因",
      startedAt: 110,
      completedAt: 120,
    })
    const otherTask = makeTask({
      id: "task-2",
      originalPath: "E:/Sources/星河.txt",
      cachedSourcePath: "E:/Novel/book-analysis/import-tasks/task-2/source.txt",
      requestedTitle: "星河",
      bookId: "book-2",
      status: "splitting",
      completed: 1,
      total: 3,
    })
    seedTask(task)
    seedTask(otherTask)
    const dir = importTaskDir(task.projectPath, task.id)
    const otherDir = importTaskDir(otherTask.projectPath, otherTask.id)
    fsMocks.directories.add(`${dir}/chapters`)
    fsMocks.directories.add(`${otherDir}/chapters`)
    fsMocks.files.set(`${dir}/chapters/0001.md`, "当前任务章节")
    fsMocks.files.set(`${dir}/checkpoint.json`, "{}")
    fsMocks.files.set(`${dir}/source.txt`, "当前任务完整原文")
    fsMocks.files.set(`${otherDir}/chapters/0001.md`, "另一任务章节")
    fsMocks.files.set(`${otherDir}/checkpoint.json`, "{\"other\":true}")
    fsMocks.files.set(`${otherDir}/source.txt`, "另一任务完整原文")
    const otherTaskJsonBefore = fsMocks.files.get(`${otherDir}/task.json`)
    vi.spyOn(Date, "now").mockReturnValue(999)

    const reset = await resetBatchImportTask(task.projectPath, task.id)

    expect(fsMocks.deleteFile).toHaveBeenCalledTimes(2)
    expect(fsMocks.deleteFile).toHaveBeenNthCalledWith(1, `${dir}/chapters`)
    expect(fsMocks.deleteFile).toHaveBeenNthCalledWith(2, `${dir}/checkpoint.json`)
    expect(fsMocks.files.get(`${dir}/source.txt`)).toBe("当前任务完整原文")
    expect(fsMocks.files.get(`${otherDir}/source.txt`)).toBe("另一任务完整原文")
    expect(fsMocks.files.get(`${otherDir}/chapters/0001.md`)).toBe("另一任务章节")
    expect(fsMocks.files.get(`${otherDir}/checkpoint.json`)).toBe("{\"other\":true}")
    expect(fsMocks.files.get(`${otherDir}/task.json`)).toBe(otherTaskJsonBefore)
    expect(fsMocks.createDirectory).toHaveBeenCalledWith(`${dir}/chapters`)
    expect(reset).toEqual(expect.objectContaining({
      status: "queued",
      completed: 0,
      total: 0,
      error: null,
      skipReason: null,
      startedAt: null,
      completedAt: null,
      updatedAt: 999,
    }))
    expect(fsMocks.writeFileAtomic).toHaveBeenCalledWith(
      `${dir}/task.json`,
      JSON.stringify(reset, null, 2),
    )
  })
  it.each(["", "../escape", "a/b", "a\\b", "含空格"]) (
    "拒绝非法任务 ID：%s",
    async (taskId) => {
      expect(() => importTaskDir("E:/Novel", taskId)).toThrow("任务 ID 不合法")
      await expect(
        saveBatchImportTask(makeTask({ id: taskId })),
      ).rejects.toThrow("任务 ID 不合法")
      expect(fsMocks.createDirectory).not.toHaveBeenCalled()
      expect(fsMocks.fileExists).not.toHaveBeenCalled()
    },
  )

  it("加载时隔离坏 JSON、身份不匹配和基本字段非法任务并稳定排序", async () => {
    const root = importTasksRoot("E:/Novel")
    const documents: Array<[string, string]> = [
      ["bad-json", "{坏JSON"],
      ["wrong-id", JSON.stringify(makeTask({ id: "another-id" }))],
      ["wrong-project", JSON.stringify(makeTask({ id: "wrong-project", projectPath: "E:/Other" }))],
      ["bad-version", JSON.stringify({ ...makeTask({ id: "bad-version" }), version: 2 })],
      ["bad-status", JSON.stringify({ ...makeTask({ id: "bad-status" }), status: "running" })],
      ["missing-field", JSON.stringify({ ...makeTask({ id: "missing-field" }), originalPath: "" })],
      ["late", JSON.stringify(makeTask({ id: "late", createdAt: 300 }))],
      ["early-first", JSON.stringify(makeTask({ id: "early-first", createdAt: 100 }))],
      ["early-second", JSON.stringify(makeTask({ id: "early-second", createdAt: 100, projectPath: "E:\\Novel\\" }))],
    ]
    fsMocks.directories.add(root)
    fsMocks.listDirectory.mockResolvedValue(documents.map(([name]) => ({
      name,
      path: `${root}/${name}`,
      is_dir: true,
    })))
    for (const [name, raw] of documents) {
      const dir = `${root}/${name}`
      fsMocks.directories.add(dir)
      fsMocks.files.set(`${dir}/task.json`, raw)
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const tasks = await loadBatchImportTasks("E:/Novel")

    expect(tasks.map((task) => task.id)).toEqual(["early-first", "early-second", "late"])
    expect(warn).toHaveBeenCalledTimes(6)
  })

  it("加载时拒绝越界目录名且不拼接该任务路径", async () => {
    const root = importTasksRoot("E:/Novel")
    fsMocks.directories.add(root)
    fsMocks.listDirectory.mockResolvedValue([
      { name: "../escape", path: `${root}/../escape`, is_dir: true },
    ])
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    await expect(loadBatchImportTasks("E:/Novel")).resolves.toEqual([])

    expect(warn).toHaveBeenCalledTimes(1)
    expect(fsMocks.fileExists).toHaveBeenCalledTimes(1)
    expect(fsMocks.fileExists).toHaveBeenCalledWith(root)
  })

  it("同项目并发保存批次时串行读改写并保留两个批次", async () => {
    const firstBatch: BatchImportBatch = {
      version: 1,
      id: "batch-1",
      projectPath: "E:\\Novel\\",
      taskIds: ["task-1"],
      createdAt: 100,
      updatedAt: 100,
    }
    const secondBatch: BatchImportBatch = {
      ...firstBatch,
      id: "batch-2",
      projectPath: "E:/Novel",
      taskIds: ["task-2"],
    }
    let notifyFirstWrite!: () => void
    const firstWriteStarted = new Promise<void>((resolve) => { notifyFirstWrite = resolve })
    let releaseFirstWrite!: () => void
    const firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve })
    fsMocks.writeFileAtomic.mockImplementationOnce(async (path, contents) => {
      notifyFirstWrite()
      await firstWriteGate
      fsMocks.files.set(path, contents)
    })

    const first = saveBatchImportBatch(firstBatch)
    await firstWriteStarted
    const second = saveBatchImportBatch(secondBatch)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fsMocks.writeFileAtomic).toHaveBeenCalledTimes(1)
    releaseFirstWrite()
    await Promise.all([first, second])

    const batchesPath = `${importTasksRoot("E:/Novel")}/batches.json`
    const batches = JSON.parse(fsMocks.files.get(batchesPath)!) as BatchImportBatch[]
    expect(batches.map((batch) => batch.id)).toEqual(["batch-1", "batch-2"])
  })

  it("缓存 source.txt 原子保存失败时不保存任务且不留下缓存", async () => {
    const task = makeTask({ cachedSourcePath: "", sourceSha256: null })
    fsMocks.files.set(task.originalPath, "abc")
    fsMocks.writeFileAtomic.mockRejectedValueOnce(new Error("缓存保存失败"))

    await expect(cacheTaskSource(task)).rejects.toThrow("缓存保存失败")

    const dir = importTaskDir(task.projectPath, task.id)
    expect(fsMocks.copyFile).not.toHaveBeenCalled()
    expect(fsMocks.files.has(`${dir}/source.txt`)).toBe(false)
    expect(fsMocks.files.has(`${dir}/task.json`)).toBe(false)
    expect(fsMocks.writeFileAtomic).toHaveBeenCalledTimes(1)
  })

  it("同一任务并发缓存时按任务锁串行执行", async () => {
    const task = makeTask({ cachedSourcePath: "", sourceSha256: null })
    fsMocks.files.set(task.originalPath, "abc")
    let originalReads = 0
    let notifyFirstRead!: () => void
    const firstReadStarted = new Promise<void>((resolve) => { notifyFirstRead = resolve })
    let releaseFirstRead!: () => void
    const firstReadGate = new Promise<void>((resolve) => { releaseFirstRead = resolve })
    fsMocks.readFile.mockImplementation(async (path) => {
      const contents = fsMocks.files.get(path)
      if (contents === undefined) throw new Error(`文件不存在：${path}`)
      if (path === task.originalPath) {
        originalReads += 1
        if (originalReads === 1) {
          notifyFirstRead()
          await firstReadGate
        }
      }
      return contents
    })

    const first = cacheTaskSource(task)
    await firstReadStarted
    const second = cacheTaskSource(task)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(originalReads).toBe(1)
    releaseFirstRead()
    await Promise.all([first, second])
    expect(originalReads).toBe(2)
  })

  it("reset 读取后再次验证任务身份，身份不匹配时不写不删", async () => {
    const dir = importTaskDir("E:/Novel", "task-1")
    fsMocks.directories.add(dir)
    fsMocks.directories.add(`${dir}/chapters`)
    fsMocks.files.set(`${dir}/task.json`, JSON.stringify(makeTask({ id: "task-2" })))
    fsMocks.files.set(`${dir}/checkpoint.json`, "{}")

    await expect(
      resetBatchImportTask("E:/Novel", "task-1"),
    ).rejects.toThrow("任务身份不匹配")

    expect(fsMocks.writeFileAtomic).not.toHaveBeenCalled()
    expect(fsMocks.deleteFile).not.toHaveBeenCalled()
  })

  it("reset 拒绝项目身份不匹配的任务且不写不删", async () => {
    const dir = importTaskDir("E:/Novel", "task-1")
    fsMocks.directories.add(dir)
    fsMocks.directories.add(`${dir}/chapters`)
    fsMocks.files.set(`${dir}/task.json`, JSON.stringify(makeTask({ projectPath: "E:/Other" })))

    await expect(
      resetBatchImportTask("E:/Novel", "task-1"),
    ).rejects.toThrow("任务身份不匹配")

    expect(fsMocks.writeFileAtomic).not.toHaveBeenCalled()
    expect(fsMocks.deleteFile).not.toHaveBeenCalled()
  })
  it("reset 先原子保存 queued 状态，清理失败时任务仍保持 queued", async () => {
    const task = makeTask({ status: "failed", completed: 2, total: 5, error: "失败" })
    seedTask(task)
    const dir = importTaskDir(task.projectPath, task.id)
    fsMocks.directories.add(`${dir}/chapters`)
    fsMocks.files.set(`${dir}/checkpoint.json`, "{}")
    fsMocks.deleteFile.mockRejectedValueOnce(new Error("清理失败"))

    await expect(resetBatchImportTask(task.projectPath, task.id)).rejects.toThrow("清理失败")

    const saved = JSON.parse(fsMocks.files.get(`${dir}/task.json`)!) as BatchImportTask
    expect(saved).toEqual(expect.objectContaining({
      status: "queued",
      completed: 0,
      total: 0,
      error: null,
    }))
    expect(fsMocks.writeFileAtomic.mock.invocationCallOrder[0]).toBeLessThan(
      fsMocks.deleteFile.mock.invocationCallOrder[0],
    )
  })

  it("同一任务并发 reset 时按任务锁串行执行", async () => {
    const task = makeTask({ status: "failed", error: "失败" })
    seedTask(task)
    const dir = importTaskDir(task.projectPath, task.id)
    fsMocks.directories.add(`${dir}/chapters`)
    fsMocks.files.set(`${dir}/checkpoint.json`, "{}")
    let deleteCalls = 0
    let notifyFirstDelete!: () => void
    const firstDeleteStarted = new Promise<void>((resolve) => { notifyFirstDelete = resolve })
    let releaseFirstDelete!: () => void
    const firstDeleteGate = new Promise<void>((resolve) => { releaseFirstDelete = resolve })
    fsMocks.deleteFile.mockImplementation(async (path) => {
      deleteCalls += 1
      if (deleteCalls === 1) {
        notifyFirstDelete()
        await firstDeleteGate
      }
      fsMocks.files.delete(path)
      for (const filePath of [...fsMocks.files.keys()]) {
        if (filePath.startsWith(`${path}/`)) fsMocks.files.delete(filePath)
      }
      fsMocks.directories.delete(path)
    })

    const first = resetBatchImportTask(task.projectPath, task.id)
    await firstDeleteStarted
    const second = resetBatchImportTask(task.projectPath, task.id)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const taskPath = `${dir}/task.json`
    expect(deleteCalls).toBe(1)
    expect(fsMocks.writeFileAtomic.mock.calls.filter(([path]) => path === taskPath)).toHaveLength(1)
    releaseFirstDelete()
    await Promise.all([first, second])
    expect(fsMocks.writeFileAtomic.mock.calls.filter(([path]) => path === taskPath)).toHaveLength(2)
  })
  it("reset 等待已开始的公开任务状态保存，旧写入不能越过 reset", async () => {
    const persisted = makeTask({ status: "failed", error: "旧失败" })
    const oldState = makeTask({ status: "splitting", completed: 2, total: 5, error: null })
    seedTask(persisted)
    const dir = importTaskDir(persisted.projectPath, persisted.id)
    fsMocks.directories.add(`${dir}/chapters`)
    let notifyOldWrite!: () => void
    const oldWriteStarted = new Promise<void>((resolve) => { notifyOldWrite = resolve })
    let releaseOldWrite!: () => void
    const oldWriteGate = new Promise<void>((resolve) => { releaseOldWrite = resolve })
    fsMocks.writeFileAtomic.mockImplementationOnce(async (path, contents) => {
      notifyOldWrite()
      await oldWriteGate
      fsMocks.files.set(path, contents)
    })

    const oldSave = saveBatchImportTask(oldState)
    await oldWriteStarted
    const reset = resetBatchImportTask(persisted.projectPath, persisted.id)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fsMocks.deleteFile).not.toHaveBeenCalled()
    releaseOldWrite()
    await Promise.all([oldSave, reset])

    const finalTask = JSON.parse(fsMocks.files.get(`${dir}/task.json`)!) as BatchImportTask
    expect(finalTask.status).toBe("queued")
    expect(finalTask.completed).toBe(0)
  })

  it("reset 等待已开始的公开 checkpoint 保存并在之后清除旧检查点", async () => {
    const task = makeTask({ status: "failed", error: "旧失败" })
    const checkpoint: BatchImportCheckpoint = {
      version: 1,
      sourceSha256: "sha",
      totalChapters: 2,
      completedChapterIndexes: [0],
      totalWords: 100,
      updatedAt: 200,
    }
    seedTask(task)
    const dir = importTaskDir(task.projectPath, task.id)
    fsMocks.directories.add(`${dir}/chapters`)
    let notifyCheckpointWrite!: () => void
    const checkpointWriteStarted = new Promise<void>((resolve) => { notifyCheckpointWrite = resolve })
    let releaseCheckpointWrite!: () => void
    const checkpointWriteGate = new Promise<void>((resolve) => { releaseCheckpointWrite = resolve })
    fsMocks.writeFileAtomic.mockImplementationOnce(async (path, contents) => {
      notifyCheckpointWrite()
      await checkpointWriteGate
      fsMocks.files.set(path, contents)
    })

    const oldSave = saveTaskCheckpoint(task, checkpoint)
    await checkpointWriteStarted
    const reset = resetBatchImportTask(task.projectPath, task.id)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fsMocks.deleteFile).not.toHaveBeenCalled()
    releaseCheckpointWrite()
    await Promise.all([oldSave, reset])
    expect(fsMocks.files.has(`${dir}/checkpoint.json`)).toBe(false)
  })

  it("已持有任务锁时 unlocked 保存任务和 checkpoint 不会嵌套死锁", async () => {
    const task = makeTask()
    const checkpoint: BatchImportCheckpoint = {
      version: 1,
      sourceSha256: "sha",
      totalChapters: 1,
      completedChapterIndexes: [],
      totalWords: 0,
      updatedAt: 100,
    }

    await withBatchImportTaskLock(task.projectPath, task.id, async () => {
      await saveBatchImportTaskUnlocked(task)
      await saveTaskCheckpointUnlocked(task, checkpoint)
    })

    const dir = importTaskDir(task.projectPath, task.id)
    expect(fsMocks.files.has(`${dir}/task.json`)).toBe(true)
    expect(fsMocks.files.has(`${dir}/checkpoint.json`)).toBe(true)
  })

  it("不同任务的任务锁可以并行进入", async () => {
    let notifyFirstEntered!: () => void
    const firstEntered = new Promise<void>((resolve) => { notifyFirstEntered = resolve })
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    let secondEntered = false

    const first = withBatchImportTaskLock("E:/Novel", "task-1", async () => {
      notifyFirstEntered()
      await firstGate
    })
    await firstEntered
    const second = withBatchImportTaskLock("E:/Novel", "task-2", async () => {
      secondEntered = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(secondEntered).toBe(true)
    releaseFirst()
    await Promise.all([first, second])
  })


  it("加载批次时逐条过滤非法数据并按批次 ID 去重", async () => {
    const root = importTasksRoot("E:/Novel")
    const first: BatchImportBatch = {
      version: 1,
      id: "batch-same",
      projectPath: "E:\\Novel\\",
      taskIds: ["task-missing", "task-1"],
      createdAt: 100,
      updatedAt: 100,
    }
    const duplicate = { ...first, taskIds: ["task-2"], updatedAt: 200 }
    const valid: BatchImportBatch = { ...first, id: "batch-valid", taskIds: ["unknown-task"] }
    fsMocks.directories.add(root)
    fsMocks.files.set(`${root}/batches.json`, JSON.stringify([
      null,
      first,
      { ...first, id: "bad id" },
      { ...first, projectPath: "E:/Other" },
      duplicate,
      valid,
    ]))

    await expect(loadBatchImportBatches("E:/Novel")).resolves.toEqual([first, valid])
  })

  it.each([
    ["损坏 JSON", "{bad-json"],
    ["损坏根结构", JSON.stringify({ batches: [] })],
  ])("保存批次遇到%s时中文警告并从空列表恢复", async (_label, contents) => {
    const root = importTasksRoot("E:/Novel")
    const batch: BatchImportBatch = {
      version: 1,
      id: "batch-new",
      projectPath: "E:/Novel",
      taskIds: ["task-1"],
      createdAt: 100,
      updatedAt: 100,
    }
    fsMocks.directories.add(root)
    fsMocks.files.set(`${root}/batches.json`, contents)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    await saveBatchImportBatch(batch)

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("批次记录损坏"),
      expect.anything(),
    )
    expect(JSON.parse(fsMocks.files.get(`${root}/batches.json`)!)).toEqual([batch])
  })
  it("保存批次时过滤 batches.json 中的 null 和非法元素", async () => {
    const root = importTasksRoot("E:/Novel")
    const validBatch: BatchImportBatch = {
      version: 1,
      id: "batch-valid",
      projectPath: "E:/Novel",
      taskIds: ["task-1"],
      createdAt: 100,
      updatedAt: 100,
    }
    const newBatch: BatchImportBatch = {
      ...validBatch,
      id: "batch-new",
      taskIds: ["task-2"],
    }
    fsMocks.directories.add(root)
    fsMocks.files.set(
      `${root}/batches.json`,
      JSON.stringify([null, validBatch, { id: "bad" }]),
    )

    await saveBatchImportBatch(newBatch)

    const saved = JSON.parse(fsMocks.files.get(`${root}/batches.json`)!) as BatchImportBatch[]
    expect(saved.map((batch) => batch.id)).toEqual(["batch-valid", "batch-new"])
  })
})
