import {
  createDirectory,
  deleteFile,
  fileExists,
  listDirectory,
  readFile,
  writeFileAtomic,
} from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { withProjectLock } from "@/lib/project-mutex"
import { hashNormalizedNovel } from "./batch-import-hash"
import type {
  BatchImportBatch,
  BatchImportCheckpoint,
  BatchImportTask,
  BatchImportTaskStatus,
} from "./batch-import-types"

const INTERRUPTED_ERROR = "软件上次关闭时任务尚未完成"
const TASK_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const TASK_STATUSES = new Set<BatchImportTaskStatus>([
  "queued",
  "copying",
  "splitting",
  "interrupted",
  "failed",
  "cancelled",
  "skipped",
  "completed",
])

function normalizeProjectKey(projectPath: string): string {
  const normalized = normalizePath(projectPath).replace(/\/+$/, "")
  if (!normalized) throw new Error("项目路径不能为空")
  return normalized
}

function isValidTaskId(taskId: unknown): taskId is string {
  return typeof taskId === "string" && TASK_ID_PATTERN.test(taskId)
}

function assertValidTaskId(taskId: string): void {
  if (!isValidTaskId(taskId)) {
    throw new Error(`任务 ID 不合法：${taskId || "空值"}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function isNullableNonNegativeNumber(value: unknown): value is number | null {
  return value === null || isNonNegativeNumber(value)
}

function validatePersistedTask(
  value: unknown,
  expectedProjectKey: string,
  expectedTaskId: string,
): string | null {
  if (!isRecord(value)) return `批量导入任务数据无效：${expectedTaskId}`
  if (value.id !== expectedTaskId) return `任务身份不匹配：${expectedTaskId}`
  if (!isNonEmptyString(value.projectPath)) {
    return `批量导入任务数据无效：${expectedTaskId}`
  }
  if (normalizeProjectKey(value.projectPath) !== expectedProjectKey) {
    return `任务身份不匹配：${expectedTaskId}`
  }
  if (
    value.version !== 1
    || !isValidTaskId(value.id)
    || !isNonEmptyString(value.batchId)
    || !isNonEmptyString(value.originalPath)
    || !isNonEmptyString(value.originalFileName)
    || typeof value.cachedSourcePath !== "string"
    || !isNullableString(value.sourceSha256)
    || !isNonEmptyString(value.requestedTitle)
    || !isNullableString(value.finalTitle)
    || !isNonEmptyString(value.bookId)
    || typeof value.status !== "string"
    || !TASK_STATUSES.has(value.status as BatchImportTaskStatus)
    || !isNonNegativeNumber(value.completed)
    || !isNonNegativeNumber(value.total)
    || !isNullableString(value.error)
    || !isNullableString(value.skipReason)
    || !isNonNegativeNumber(value.createdAt)
    || !isNullableNonNegativeNumber(value.startedAt)
    || !isNullableNonNegativeNumber(value.completedAt)
    || !isNonNegativeNumber(value.updatedAt)
  ) {
    return `批量导入任务数据无效：${expectedTaskId}`
  }
  return null
}

function assertTaskForPath(task: BatchImportTask): string {
  assertValidTaskId(task.id)
  const projectKey = normalizeProjectKey(task.projectPath)
  const validationError = validatePersistedTask(task, projectKey, task.id)
  if (validationError) throw new Error(validationError)
  return projectKey
}

function isBatchImportBatch(
  value: unknown,
  expectedProjectKey: string,
): value is BatchImportBatch {
  if (!isRecord(value)) return false
  if (
    value.version !== 1
    || !isValidTaskId(value.id)
    || !isNonEmptyString(value.projectPath)
    || !Array.isArray(value.taskIds)
    || !value.taskIds.every(isValidTaskId)
    || !isNonNegativeNumber(value.createdAt)
    || !isNonNegativeNumber(value.updatedAt)
  ) {
    return false
  }
  try {
    return normalizeProjectKey(value.projectPath) === expectedProjectKey
  } catch {
    return false
  }
}

function assertBatchImportBatch(batch: BatchImportBatch, projectKey: string): void {
  const batchId = batch.id
  if (!isBatchImportBatch(batch, projectKey)) {
    throw new Error(`批量导入批次数据无效：${batchId || "未知批次"}`)
  }
}

export async function withBatchImportTaskLock<T>(
  projectPath: string,
  taskId: string,
  fn: () => Promise<T>,
): Promise<T> {
  assertValidTaskId(taskId)
  const projectKey = normalizeProjectKey(projectPath)
  return withProjectLock(`${projectKey}#${taskId}`, fn)
}

export function importTasksRoot(projectPath: string): string {
  return `${normalizeProjectKey(projectPath)}/book-analysis/import-tasks`
}

export function importTaskDir(projectPath: string, taskId: string): string {
  assertValidTaskId(taskId)
  return `${importTasksRoot(projectPath)}/${taskId}`
}

function taskFilePath(projectPath: string, taskId: string): string {
  return `${importTaskDir(projectPath, taskId)}/task.json`
}

function taskCheckpointPath(task: BatchImportTask): string {
  return `${importTaskDir(task.projectPath, task.id)}/checkpoint.json`
}

async function ensureTaskBaseDirectories(projectPath: string, taskId: string): Promise<void> {
  assertValidTaskId(taskId)
  const root = importTasksRoot(projectPath)
  const taskDir = importTaskDir(projectPath, taskId)
  await createDirectory(root)
  await createDirectory(taskDir)
}

async function ensureTaskDirectories(projectPath: string, taskId: string): Promise<void> {
  await ensureTaskBaseDirectories(projectPath, taskId)
  await createDirectory(`${importTaskDir(projectPath, taskId)}/chapters`)
}

export async function loadBatchImportTasks(
  projectPath: string,
): Promise<BatchImportTask[]> {
  const projectKey = normalizeProjectKey(projectPath)
  const root = importTasksRoot(projectKey)
  if (!(await fileExists(root))) return []

  const entries = await listDirectory(root)
  const tasks: BatchImportTask[] = []

  for (const entry of entries) {
    if (!entry.is_dir) continue
    if (!isValidTaskId(entry.name)) {
      console.warn(`批量导入：已跳过非法任务目录“${entry.name}”`)
      continue
    }

    const path = taskFilePath(projectKey, entry.name)
    try {
      if (!(await fileExists(path))) continue
      const parsed = JSON.parse(await readFile(path)) as unknown
      const validationError = validatePersistedTask(parsed, projectKey, entry.name)
      if (validationError) throw new Error(validationError)
      const task = parsed as unknown as BatchImportTask

      if (task.status === "copying" || task.status === "splitting") {
        const interruptedTask: BatchImportTask = {
          ...task,
          status: "interrupted",
          error: INTERRUPTED_ERROR,
          updatedAt: Date.now(),
        }
        await saveBatchImportTask(interruptedTask)
        tasks.push(interruptedTask)
      } else {
        tasks.push(task)
      }
    } catch (error) {
      console.warn(`批量导入：已跳过损坏任务“${entry.name}”`, error)
    }
  }

  return tasks.sort((left, right) => left.createdAt - right.createdAt)
}

export async function saveBatchImportTaskUnlocked(
  task: BatchImportTask,
  options: { ensureChaptersDirectory?: boolean } = {},
): Promise<void> {
  assertTaskForPath(task)
  if (options.ensureChaptersDirectory === false) {
    await ensureTaskBaseDirectories(task.projectPath, task.id)
  } else {
    await ensureTaskDirectories(task.projectPath, task.id)
  }
  await writeFileAtomic(
    taskFilePath(task.projectPath, task.id),
    JSON.stringify(task, null, 2),
  )
}

export async function saveBatchImportTask(task: BatchImportTask): Promise<void> {
  await withBatchImportTaskLock(task.projectPath, task.id, async () => {
    await saveBatchImportTaskUnlocked(task)
  })
}

export async function loadBatchImportBatches(
  projectPath: string,
): Promise<BatchImportBatch[]> {
  const projectKey = normalizeProjectKey(projectPath)
  const path = `${importTasksRoot(projectKey)}/batches.json`
  if (!(await fileExists(path))) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path)) as unknown
  } catch (error) {
    console.warn("批量导入：批次记录损坏，已忽略", error)
    return []
  }
  if (!Array.isArray(parsed)) return []

  const seenIds = new Set<string>()
  const batches: BatchImportBatch[] = []
  for (const item of parsed) {
    if (!isBatchImportBatch(item, projectKey) || seenIds.has(item.id)) continue
    seenIds.add(item.id)
    batches.push(item)
  }
  return batches
}
export async function saveBatchImportBatch(batch: BatchImportBatch): Promise<void> {
  const projectKey = normalizeProjectKey(batch.projectPath)
  assertBatchImportBatch(batch, projectKey)

  await withProjectLock(projectKey, async () => {
    const root = importTasksRoot(projectKey)
    const path = `${root}/batches.json`
    await createDirectory(root)

    let batches: BatchImportBatch[] = []
    if (await fileExists(path)) {
      try {
        const parsed = JSON.parse(await readFile(path)) as unknown
        if (!Array.isArray(parsed)) throw new Error("批次记录根结构不是数组")
        batches = parsed.filter((item) => isBatchImportBatch(item, projectKey))
      } catch (error) {
        console.warn("批量导入：批次记录损坏，保存时已从空列表恢复", error)
      }
    }

    const existingIndex = batches.findIndex((item) => item.id === batch.id)
    if (existingIndex === -1) {
      batches.push(batch)
    } else {
      batches[existingIndex] = batch
    }

    await writeFileAtomic(path, JSON.stringify(batches, null, 2))
  })
}

export async function deleteFailedBatchImportTask(
  projectPath: string,
  taskId: string,
): Promise<void> {
  assertValidTaskId(taskId)
  const projectKey = normalizeProjectKey(projectPath)
  await withBatchImportTaskLock(projectKey, taskId, async () => {
    const taskPath = taskFilePath(projectKey, taskId)
    if (!(await fileExists(taskPath))) throw new Error(`找不到批量导入任务：${taskId}`)
    const parsed = JSON.parse(await readFile(taskPath)) as unknown
    const validationError = validatePersistedTask(parsed, projectKey, taskId)
    if (validationError) throw new Error(validationError)
    if ((parsed as BatchImportTask).status !== "failed") {
      throw new Error("只能删除导入失败的任务")
    }

    await withProjectLock(projectKey, async () => {
      const batchesPath = `${importTasksRoot(projectKey)}/batches.json`
      const hadBatchesFile = await fileExists(batchesPath)
      const originalRaw = hadBatchesFile ? await readFile(batchesPath) : null
      let batches: BatchImportBatch[] = []
      if (originalRaw !== null) {
        const original = JSON.parse(originalRaw) as unknown
        if (!Array.isArray(original)) throw new Error("批量导入批次数据无效")
        batches = original.filter((item): item is BatchImportBatch => isBatchImportBatch(item, projectKey))
      }
      const nextBatches = batches
        .map((batch) => ({
          ...batch,
          taskIds: batch.taskIds.filter((id) => id !== taskId),
          updatedAt: batch.taskIds.includes(taskId) ? Date.now() : batch.updatedAt,
        }))
        .filter((batch) => batch.taskIds.length > 0)

      if (originalRaw !== null) {
        await writeFileAtomic(batchesPath, JSON.stringify(nextBatches, null, 2))
      }
      try {
        await deleteFile(importTaskDir(projectKey, taskId))
      } catch (error) {
        if (originalRaw !== null) {
          try {
            await writeFileAtomic(batchesPath, originalRaw)
          } catch (rollbackError) {
            console.error("删除批量导入任务：回滚批次记录失败", rollbackError)
          }
        }
        throw error
      }
    })
  })
}

export async function cacheTaskSource(
  task: BatchImportTask,
): Promise<BatchImportTask> {
  const projectKey = assertTaskForPath(task)
  return withBatchImportTaskLock(projectKey, task.id, async () => {
    await ensureTaskDirectories(projectKey, task.id)
    const cachedSourcePath = `${importTaskDir(projectKey, task.id)}/source.txt`
    const sourceContent = await readFile(task.originalPath)
    await writeFileAtomic(cachedSourcePath, sourceContent)
    const cachedContent = await readFile(cachedSourcePath)
    const cachedTask: BatchImportTask = {
      ...task,
      projectPath: projectKey,
      cachedSourcePath,
      sourceSha256: await hashNormalizedNovel(cachedContent),
      updatedAt: Date.now(),
    }
    await saveBatchImportTaskUnlocked(cachedTask)
    return cachedTask
  })
}

export async function loadTaskCheckpoint(
  task: BatchImportTask,
): Promise<BatchImportCheckpoint | null> {
  assertTaskForPath(task)
  const path = taskCheckpointPath(task)
  if (!(await fileExists(path))) return null
  return JSON.parse(await readFile(path)) as BatchImportCheckpoint
}

export async function saveTaskCheckpointUnlocked(
  task: BatchImportTask,
  checkpoint: BatchImportCheckpoint,
): Promise<void> {
  assertTaskForPath(task)
  await ensureTaskDirectories(task.projectPath, task.id)
  await writeFileAtomic(taskCheckpointPath(task), JSON.stringify(checkpoint, null, 2))
}

export async function saveTaskCheckpoint(
  task: BatchImportTask,
  checkpoint: BatchImportCheckpoint,
): Promise<void> {
  await withBatchImportTaskLock(task.projectPath, task.id, async () => {
    await saveTaskCheckpointUnlocked(task, checkpoint)
  })
}

export async function cleanupCompletedTaskWorkspaceUnlocked(
  task: BatchImportTask,
): Promise<void> {
  assertTaskForPath(task)
  if (task.status !== "completed") {
    throw new Error("只能清理已完成的批量导入任务工作区")
  }

  const dir = importTaskDir(task.projectPath, task.id)
  const chaptersPath = `${dir}/chapters`
  const checkpointPath = `${dir}/checkpoint.json`
  if (await fileExists(chaptersPath)) await deleteFile(chaptersPath)
  if (await fileExists(checkpointPath)) await deleteFile(checkpointPath)
}

export async function resetBatchImportTask(
  projectPath: string,
  taskId: string,
): Promise<BatchImportTask> {
  assertValidTaskId(taskId)
  const projectKey = normalizeProjectKey(projectPath)
  return withBatchImportTaskLock(projectKey, taskId, async () => {
    const dir = importTaskDir(projectKey, taskId)
    const path = taskFilePath(projectKey, taskId)
    if (!(await fileExists(path))) {
      throw new Error(`找不到批量导入任务：${taskId}`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(path)) as unknown
    } catch {
      throw new Error(`批量导入任务数据损坏：${taskId}`)
    }
    const validationError = validatePersistedTask(parsed, projectKey, taskId)
    if (validationError) throw new Error(validationError)
    const task = parsed as BatchImportTask
    const resetTask: BatchImportTask = {
      ...task,
      projectPath: projectKey,
      status: "queued",
      completed: 0,
      total: 0,
      error: null,
      skipReason: null,
      startedAt: null,
      completedAt: null,
      updatedAt: Date.now(),
    }

    await saveBatchImportTaskUnlocked(resetTask, { ensureChaptersDirectory: false })

    const chaptersPath = `${dir}/chapters`
    const checkpointPath = `${dir}/checkpoint.json`
    if (await fileExists(chaptersPath)) await deleteFile(chaptersPath)
    if (await fileExists(checkpointPath)) await deleteFile(checkpointPath)
    await createDirectory(chaptersPath)
    return resetTask
  })
}
