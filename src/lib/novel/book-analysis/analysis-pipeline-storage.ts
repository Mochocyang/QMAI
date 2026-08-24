import {
  createDirectory,
  deleteFile,
  fileExists,
  listDirectory,
  readFile,
  writeFileAtomic,
} from "@/commands/fs"
import { joinPath, normalizePath } from "@/lib/path-utils"
import {
  ANALYSIS_SKILL_ORDER,
  type AnalysisChunkRecord,
  type AnalysisSkill,
  type BookAnalysisModuleManifest,
  type BookAnalysisPipelineTask,
} from "./analysis-pipeline-types"

const INTERRUPTED_ERROR = "软件上次关闭时分析尚未完成"
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/

export interface AnalysisStorageEntry {
  name: string
  path: string
  is_dir: boolean
}

export interface AnalysisPipelineStorageIo {
  createDirectory(path: string): Promise<void>
  deleteFile(path: string): Promise<void>
  fileExists(path: string): Promise<boolean>
  listDirectory(path: string): Promise<AnalysisStorageEntry[]>
  readFile(path: string): Promise<string>
  writeFileAtomic(path: string, contents: string): Promise<void>
}

const defaultIo: AnalysisPipelineStorageIo = {
  createDirectory,
  deleteFile,
  fileExists,
  listDirectory: async (path) => listDirectory(path),
  readFile,
  writeFileAtomic,
}

interface RecoveredAnalysisState {
  tasks: BookAnalysisPipelineTask[]
  chunks: AnalysisChunkRecord[]
}

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID_PATTERN.test(value)) throw new Error(`${label}不合法`)
}

function normalized(path: string): string {
  return normalizePath(path).replace(/\/+$/, "")
}

function analysisRoot(bookPath: string): string {
  return normalized(joinPath(bookPath, "analysis"))
}

function analysisTasksRoot(bookPath: string): string {
  return normalized(joinPath(analysisRoot(bookPath), "tasks"))
}

function analysisTaskPath(bookPath: string, taskId: string): string {
  assertSafeId(taskId, "分析任务 ID")
  return normalized(joinPath(analysisTasksRoot(bookPath), `${taskId}.json`))
}

function analysisChunksRoot(bookPath: string, taskId: string): string {
  assertSafeId(taskId, "分析任务 ID")
  return normalized(joinPath(analysisRoot(bookPath), "chunks", taskId))
}

function analysisChunkDir(bookPath: string, taskId: string, skill: AnalysisSkill): string {
  return normalized(joinPath(analysisChunksRoot(bookPath, taskId), skill))
}

function analysisChunkPath(bookPath: string, chunk: AnalysisChunkRecord): string {
  assertSafeId(chunk.id, "分析区块 ID")
  return normalized(joinPath(
    analysisChunkDir(bookPath, chunk.taskId, chunk.skill),
    `${chunk.id}.json`,
  ))
}

function analysisChunkResultPath(bookPath: string, chunk: AnalysisChunkRecord): string {
  assertSafeId(chunk.id, "分析区块 ID")
  return normalized(joinPath(
    analysisChunkDir(bookPath, chunk.taskId, chunk.skill),
    `${chunk.id}.result.json`,
  ))
}

async function ensureTaskDirectories(
  bookPath: string,
  taskId: string,
  io: AnalysisPipelineStorageIo,
): Promise<void> {
  await io.createDirectory(analysisRoot(bookPath))
  await io.createDirectory(analysisTasksRoot(bookPath))
  await io.createDirectory(analysisChunksRoot(bookPath, taskId))
}

export async function saveAnalysisTask(
  task: BookAnalysisPipelineTask,
  io: AnalysisPipelineStorageIo = defaultIo,
): Promise<void> {
  assertSafeId(task.id, "分析任务 ID")
  assertSafeId(task.bookId, "作品 ID")
  await ensureTaskDirectories(task.bookPath, task.id, io)
  await io.writeFileAtomic(analysisTaskPath(task.bookPath, task.id), JSON.stringify(task, null, 2))
}

export async function saveAnalysisChunk(
  bookPath: string,
  chunk: AnalysisChunkRecord,
  io: AnalysisPipelineStorageIo = defaultIo,
): Promise<void> {
  await ensureTaskDirectories(bookPath, chunk.taskId, io)
  await io.createDirectory(analysisChunkDir(bookPath, chunk.taskId, chunk.skill))
  await io.writeFileAtomic(analysisChunkPath(bookPath, chunk), JSON.stringify(chunk, null, 2))
}

/** 清空任务下旧区块（含 .result.json）后写入新区块，避免重配范围残留 orphan。 */
export async function replaceAnalysisTaskChunks(
  bookPath: string,
  taskId: string,
  nextChunks: AnalysisChunkRecord[],
  io: AnalysisPipelineStorageIo = defaultIo,
): Promise<void> {
  assertSafeId(taskId, "分析任务 ID")
  for (const chunk of nextChunks) {
    if (chunk.taskId !== taskId) throw new Error("区块不属于当前分析任务")
  }
  const root = analysisChunksRoot(bookPath, taskId)
  if (await io.fileExists(root)) await io.deleteFile(root)
  await ensureTaskDirectories(bookPath, taskId, io)
  for (const chunk of nextChunks) await saveAnalysisChunk(bookPath, chunk, io)
}

export async function saveCompletedChunk<T>(
  bookPath: string,
  chunk: AnalysisChunkRecord,
  result: T,
  io: AnalysisPipelineStorageIo = defaultIo,
  completedAt = Date.now(),
): Promise<AnalysisChunkRecord> {
  await ensureTaskDirectories(bookPath, chunk.taskId, io)
  await io.createDirectory(analysisChunkDir(bookPath, chunk.taskId, chunk.skill))
  const resultPath = analysisChunkResultPath(bookPath, chunk)
  await io.writeFileAtomic(resultPath, JSON.stringify(result, null, 2))
  const completed: AnalysisChunkRecord = {
    ...chunk,
    status: "completed",
    resultPath,
    error: null,
    completedAt,
    updatedAt: completedAt,
  }
  await io.writeFileAtomic(analysisChunkPath(bookPath, completed), JSON.stringify(completed, null, 2))
  return completed
}

export async function loadAnalysisChunkResult<T>(
  chunk: AnalysisChunkRecord,
  io: AnalysisPipelineStorageIo = defaultIo,
): Promise<T | null> {
  if (!chunk.resultPath || !(await io.fileExists(chunk.resultPath))) return null
  try {
    return JSON.parse(await io.readFile(chunk.resultPath)) as T
  } catch {
    return null
  }
}

export async function loadAnalysisManifest(
  bookPath: string,
  io: AnalysisPipelineStorageIo = defaultIo,
): Promise<BookAnalysisModuleManifest | null> {
  const path = normalized(joinPath(analysisRoot(bookPath), "manifest.json"))
  if (!(await io.fileExists(path))) return null
  try {
    return JSON.parse(await io.readFile(path)) as BookAnalysisModuleManifest
  } catch {
    return null
  }
}

export async function saveAnalysisManifest(
  bookPath: string,
  manifest: BookAnalysisModuleManifest,
  io: AnalysisPipelineStorageIo = defaultIo,
): Promise<void> {
  await io.createDirectory(analysisRoot(bookPath))
  const path = normalized(joinPath(analysisRoot(bookPath), "manifest.json"))
  await io.writeFileAtomic(path, JSON.stringify(manifest, null, 2))
}

function isPipelineTask(value: unknown): value is BookAnalysisPipelineTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Partial<BookAnalysisPipelineTask>
  return candidate.version === 1
    && typeof candidate.id === "string"
    && typeof candidate.bookId === "string"
    && typeof candidate.bookPath === "string"
    && Array.isArray(candidate.selectedSkills)
    && typeof candidate.status === "string"
    && typeof candidate.modules === "object"
}

function isChunkRecord(value: unknown): value is AnalysisChunkRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Partial<AnalysisChunkRecord>
  return candidate.version === 1
    && typeof candidate.id === "string"
    && typeof candidate.taskId === "string"
    && typeof candidate.skill === "string"
    && Array.isArray(candidate.chapterIds)
    && typeof candidate.status === "string"
}

async function loadTaskChunks(
  task: BookAnalysisPipelineTask,
  io: AnalysisPipelineStorageIo,
): Promise<AnalysisChunkRecord[]> {
  const taskRoot = analysisChunksRoot(task.bookPath, task.id)
  if (!(await io.fileExists(taskRoot))) return []
  const chunks: AnalysisChunkRecord[] = []

  for (const skill of ANALYSIS_SKILL_ORDER) {
    const skillRoot = analysisChunkDir(task.bookPath, task.id, skill)
    if (!(await io.fileExists(skillRoot))) continue
    for (const entry of await io.listDirectory(skillRoot)) {
      if (entry.is_dir || !entry.name.endsWith(".json") || entry.name.endsWith(".result.json")) continue
      try {
        const parsed = JSON.parse(await io.readFile(entry.path)) as unknown
        if (!isChunkRecord(parsed) || parsed.taskId !== task.id || parsed.skill !== skill) continue
        chunks.push(parsed)
      } catch {
        // 损坏区块不能作为已完成结果恢复。
      }
    }
  }
  return chunks.sort((left, right) => left.startOrder - right.startOrder)
}

async function recoverChunk(
  bookPath: string,
  chunk: AnalysisChunkRecord,
  io: AnalysisPipelineStorageIo,
): Promise<AnalysisChunkRecord> {
  const missingResult = chunk.status === "completed"
    && (!chunk.resultPath || !(await io.fileExists(chunk.resultPath)))
  if (chunk.status !== "running" && !missingResult) return chunk

  const recovered: AnalysisChunkRecord = {
    ...chunk,
    status: "pending",
    resultPath: missingResult ? null : chunk.resultPath,
    error: null,
    startedAt: null,
    completedAt: null,
    updatedAt: Date.now(),
  }
  await saveAnalysisChunk(bookPath, recovered, io)
  return recovered
}

export async function loadAndRecoverAnalysisTasks(
  projectPath: string,
  io: AnalysisPipelineStorageIo = defaultIo,
): Promise<RecoveredAnalysisState> {
  const booksRoot = normalized(joinPath(projectPath, "book-analysis"))
  if (!(await io.fileExists(booksRoot))) return { tasks: [], chunks: [] }

  const tasks: BookAnalysisPipelineTask[] = []
  const chunks: AnalysisChunkRecord[] = []
  for (const bookEntry of await io.listDirectory(booksRoot)) {
    if (!bookEntry.is_dir || !bookEntry.name.startsWith("book-")) continue
    const taskRoot = analysisTasksRoot(bookEntry.path)
    if (!(await io.fileExists(taskRoot))) continue

    for (const taskEntry of await io.listDirectory(taskRoot)) {
      if (taskEntry.is_dir || !taskEntry.name.endsWith(".json")) continue
      try {
        const parsed = JSON.parse(await io.readFile(taskEntry.path)) as unknown
        if (!isPipelineTask(parsed) || normalized(parsed.bookPath) !== normalized(bookEntry.path)) continue
        const recoveredTask: BookAnalysisPipelineTask = parsed.status === "running"
          ? {
              ...parsed,
              status: "paused",
              error: INTERRUPTED_ERROR,
              updatedAt: Date.now(),
            }
          : parsed
        if (recoveredTask !== parsed) await saveAnalysisTask(recoveredTask, io)
        const recoveredChunks = await Promise.all(
          (await loadTaskChunks(recoveredTask, io)).map((chunk) => recoverChunk(recoveredTask.bookPath, chunk, io)),
        )
        tasks.push(recoveredTask)
        chunks.push(...recoveredChunks)
      } catch {
        // 单个损坏任务不阻止其他作品恢复。
      }
    }
  }
  tasks.sort((left, right) => left.createdAt - right.createdAt)
  return { tasks, chunks }
}
