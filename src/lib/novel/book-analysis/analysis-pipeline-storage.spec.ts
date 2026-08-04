import { describe, expect, it } from "vitest"
import type {
  AnalysisChunkRecord,
  AnalysisModuleState,
  AnalysisSkill,
  BookAnalysisPipelineTask,
} from "./analysis-pipeline-types"
import {
  loadAndRecoverAnalysisTasks,
  replaceAnalysisTaskChunks,
  saveAnalysisChunk,
  saveAnalysisTask,
  saveCompletedChunk,
  type AnalysisPipelineStorageIo,
} from "./analysis-pipeline-storage"

function moduleState(skill: AnalysisSkill): AnalysisModuleState {
  return {
    skill,
    status: skill === "characters" ? "running" : "pending",
    range: { startOrder: 1, endOrder: 20 },
    chunkIds: ["chunk-0001-0010", "chunk-0011-0020"],
    completedChunkIds: ["chunk-0001-0010"],
    failedChunkId: null,
    resultPath: null,
    analysisVersion: 1,
    updatedAt: 10,
  }
}

function task(): BookAnalysisPipelineTask {
  return {
    version: 1,
    id: "analysis-1",
    batchId: null,
    projectPath: "E:/Novel",
    bookId: "book-1",
    bookPath: "E:/Novel/book-analysis/book-1",
    selectedSkills: ["characters", "story", "style"],
    range: { startOrder: 1, endOrder: 20 },
    status: "running",
    currentSkill: "characters",
    modules: {
      characters: moduleState("characters"),
      story: moduleState("story"),
      style: moduleState("style"),
    },
    error: null,
    createdAt: 1,
    startedAt: 2,
    completedAt: null,
    updatedAt: 10,
  }
}

function chunk(id: string, status: AnalysisChunkRecord["status"]): AnalysisChunkRecord {
  const startOrder = id === "chunk-0001-0010" ? 1 : 11
  const endOrder = startOrder + 9
  return {
    version: 1,
    id,
    taskId: "analysis-1",
    skill: "characters",
    chapterIds: Array.from({ length: 10 }, (_, index) => `ch-${startOrder + index}`),
    startOrder,
    endOrder,
    wordCount: 20000,
    status,
    attempts: 1,
    resultPath: status === "completed" ? `${id}.result.json` : null,
    error: null,
    startedAt: 3,
    completedAt: status === "completed" ? 4 : null,
    updatedAt: 4,
  }
}

function createMemoryIo() {
  const files = new Map<string, string>()
  const directories = new Set<string>()
  const writes: string[] = []
  const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "")

  const io: AnalysisPipelineStorageIo = {
    async createDirectory(path) {
      const normalized = normalize(path)
      const parts = normalized.split("/")
      for (let index = 1; index <= parts.length; index += 1) {
        directories.add(parts.slice(0, index).join("/"))
      }
    },
    async deleteFile(path) {
      const normalized = normalize(path)
      const prefix = `${normalized}/`
      for (const file of [...files.keys()]) {
        if (file === normalized || file.startsWith(prefix)) files.delete(file)
      }
      for (const directory of [...directories]) {
        if (directory === normalized || directory.startsWith(prefix)) directories.delete(directory)
      }
    },
    async fileExists(path) {
      const normalized = normalize(path)
      return files.has(normalized) || directories.has(normalized)
    },
    async listDirectory(path) {
      const normalized = normalize(path)
      const prefix = `${normalized}/`
      const names = new Map<string, boolean>()
      for (const directory of directories) {
        if (!directory.startsWith(prefix)) continue
        const rest = directory.slice(prefix.length)
        if (rest && !rest.includes("/")) names.set(rest, true)
      }
      for (const file of files.keys()) {
        if (!file.startsWith(prefix)) continue
        const rest = file.slice(prefix.length)
        if (rest && !rest.includes("/")) names.set(rest, false)
      }
      return [...names].map(([name, is_dir]) => ({ name, path: `${normalized}/${name}`, is_dir }))
    },
    async readFile(path) {
      const value = files.get(normalize(path))
      if (value === undefined) throw new Error("文件不存在")
      return value
    },
    async writeFileAtomic(path, contents) {
      const normalized = normalize(path)
      files.set(normalized, contents)
      writes.push(normalized)
    },
  }
  return { io, files, writes }
}

describe("analysis pipeline storage", () => {
  it("启动时把运行任务改为暂停并把运行区块恢复为等待", async () => {
    const memory = createMemoryIo()
    await saveAnalysisTask(task(), memory.io)
    await saveCompletedChunk(
      task().bookPath,
      chunk("chunk-0001-0010", "running"),
      { characters: [] },
      memory.io,
      50,
    )
    await saveAnalysisChunk(task().bookPath, chunk("chunk-0011-0020", "running"), memory.io)

    const recovered = await loadAndRecoverAnalysisTasks("E:/Novel", memory.io)

    expect(recovered.tasks).toHaveLength(1)
    expect(recovered.tasks[0].status).toBe("paused")
    expect(recovered.tasks[0].error).toBe("软件上次关闭时分析尚未完成")
    expect(recovered.chunks.find((item) => item.id === "chunk-0001-0010")?.status).toBe("completed")
    expect(recovered.chunks.find((item) => item.id === "chunk-0011-0020")?.status).toBe("pending")
  })

  it("完成区块时先写结果再写 completed 状态", async () => {
    const memory = createMemoryIo()
    const running = chunk("chunk-0011-0020", "running")

    const completed = await saveCompletedChunk(
      task().bookPath,
      running,
      { characters: [] },
      memory.io,
      100,
    )

    expect(completed.status).toBe("completed")
    expect(completed.resultPath).toContain("chunk-0011-0020.result.json")
    expect(memory.writes.at(-2)).toContain("chunk-0011-0020.result.json")
    expect(memory.writes.at(-1)).toContain("chunk-0011-0020.json")
  })

  it("replaceAnalysisTaskChunks 清空旧区块文件后再写入新区块", async () => {
    const memory = createMemoryIo()
    const current = task()
    const bookPath = current.bookPath
    await saveAnalysisTask(current, memory.io)
    await saveCompletedChunk(bookPath, chunk("chunk-0001-0010", "completed"), { characters: [] }, memory.io, 50)
    await saveAnalysisChunk(bookPath, chunk("chunk-0011-0020", "pending"), memory.io)

    const next = [{
      ...chunk("chunk-0001-0005", "pending"),
      chapterIds: ["ch-1", "ch-2", "ch-3", "ch-4", "ch-5"],
      startOrder: 1,
      endOrder: 5,
      resultPath: null,
      completedAt: null,
      status: "pending" as const,
      attempts: 0,
      startedAt: null,
    }]
    await replaceAnalysisTaskChunks(bookPath, "analysis-1", next, memory.io)

    const recovered = await loadAndRecoverAnalysisTasks("E:/Novel", memory.io)
    expect(recovered.chunks.map((item) => item.id)).toEqual(["chunk-0001-0005"])
    expect([...memory.files.keys()].some((path) => path.includes("chunk-0001-0010"))).toBe(false)
    expect([...memory.files.keys()].some((path) => path.includes("chunk-0011-0020"))).toBe(false)
    expect([...memory.files.keys()].some((path) => path.includes("chunk-0001-0005.json"))).toBe(true)
  })
})
