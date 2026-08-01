/**
 * Persistent serial queue for foreshadowing cleanup operations.
 * Mirrors dedup-queue.ts.
 */
import { readFile, writeFile } from "@/commands/fs"
import { useWikiStore } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"
import { getProjectPathById } from "@/lib/project-identity"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { resolveDefaultModel, resolveModelConfig } from "@/lib/novel/model-resolver"
import {
  cleanupIssueKey,
  cleanupTaskKey,
  defaultCleanupAction,
  type CleanupApplyAction,
  type CleanupIssue,
} from "@/lib/foreshadowing-cleanup"
import {
  executeCleanupTask,
  resolveCurrentChapter,
  type ForeshadowingCleanupApplyStage,
} from "@/lib/foreshadowing-cleanup-runner"
import { removeIssueFromForeshadowingScanCache } from "@/lib/foreshadowing-cleanup-cache"

export interface ForeshadowingCleanupTask {
  id: string
  projectId: string
  issue: CleanupIssue
  /** merge | delete | abandon — defaults from issue.kind */
  action?: CleanupApplyAction
  canonicalId?: string
  modelId?: string
  status: "pending" | "processing" | "done" | "failed"
  addedAt: number
  error: string | null
  retryCount: number
}

let queue: ForeshadowingCleanupTask[] = []
let processing = false
let currentProjectId = ""
let currentProjectPath = ""
let currentAbortController: AbortController | null = null
let currentApplyProgress: {
  taskId: string
  stage: ForeshadowingCleanupApplyStage
} | null = null
let currentApplyLogs: string[] = []

type CompleteListener = (task: ForeshadowingCleanupTask) => void
const completeListeners = new Set<CompleteListener>()

export function onForeshadowingCleanupComplete(
  listener: CompleteListener,
): () => void {
  completeListeners.add(listener)
  return () => completeListeners.delete(listener)
}

function notifyComplete(task: ForeshadowingCleanupTask): void {
  for (const listener of completeListeners) {
    try {
      listener(task)
    } catch (err) {
      console.error("[ForeshadowingCleanup Queue] listener failed:", err)
    }
  }
}

function queueFilePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/foreshadowing-cleanup-queue.json`
}

async function saveQueue(projectPath: string): Promise<void> {
  try {
    const toSave = queue.filter((t) => t.status !== "done")
    await writeFile(queueFilePath(projectPath), JSON.stringify(toSave, null, 2))
  } catch {
    // non-critical
  }
}

async function loadQueue(
  projectPath: string,
  projectId: string,
): Promise<ForeshadowingCleanupTask[]> {
  try {
    const raw = await readFile(queueFilePath(projectPath))
    const tasks = JSON.parse(raw) as ForeshadowingCleanupTask[]
    return tasks.map((t) => ({
      ...t,
      projectId: t.projectId ?? projectId,
    }))
  } catch {
    return []
  }
}

function generateId(): string {
  return `fsclean-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function foreshadowingCleanupIssueKey(issue: CleanupIssue): string {
  return cleanupIssueKey(issue)
}

export async function enqueueForeshadowingCleanup(
  projectId: string,
  issue: CleanupIssue,
  options: {
    canonicalId?: string
    modelId?: string
    action?: CleanupApplyAction
  } = {},
): Promise<string> {
  const active = useWikiStore.getState().project
  if (!active || active.id !== projectId) {
    throw new Error(
      `enqueueForeshadowingCleanup: project ${projectId} is not the active project`,
    )
  }

  await ensureForeshadowingCleanupQueueActive(active.id, active.path)

  if (!currentProjectId || currentProjectId !== projectId) {
    throw new Error(
      `enqueueForeshadowingCleanup: failed to activate queue for project ${projectId}`,
    )
  }

  const action = options.action ?? defaultCleanupAction(issue.kind)
  const key = cleanupTaskKey(issue, action)
  const existing = queue.find(
    (t) =>
      t.projectId === projectId &&
      t.status !== "done" &&
      cleanupTaskKey(t.issue, t.action ?? defaultCleanupAction(t.issue.kind)) ===
        key,
  )
  if (existing) return existing.id

  const task: ForeshadowingCleanupTask = {
    id: generateId(),
    projectId,
    issue,
    action,
    canonicalId:
      action === "merge"
        ? options.canonicalId?.trim() || issue.canonicalId
        : undefined,
    modelId: options.modelId?.trim() || undefined,
    status: "pending",
    addedAt: Date.now(),
    error: null,
    retryCount: 0,
  }

  queue.push(task)
  await saveQueue(currentProjectPath)
  processNext(currentProjectId)
  return task.id
}

export async function retryForeshadowingCleanupTask(taskId: string): Promise<void> {
  let task = queue.find((t) => t.id === taskId)
  if (!task) return
  const projectId = task.projectId

  const active = useWikiStore.getState().project
  if (!active || active.id !== projectId) return

  await ensureForeshadowingCleanupQueueActive(active.id, active.path)

  task = queue.find((t) => t.id === taskId)
  if (!task || task.projectId !== currentProjectId) return

  task.status = "pending"
  task.error = null
  task.retryCount = 0
  await saveQueue(currentProjectPath)
  processNext(currentProjectId)
}

export async function cancelForeshadowingCleanupTask(taskId: string): Promise<void> {
  let task = queue.find((t) => t.id === taskId)
  if (!task) return
  const projectId = task.projectId

  const active = useWikiStore.getState().project
  if (!active || active.id !== projectId) return

  await ensureForeshadowingCleanupQueueActive(active.id, active.path)

  task = queue.find((t) => t.id === taskId)
  if (!task || task.projectId !== currentProjectId) return

  if (task.status === "processing") {
    if (currentAbortController) {
      currentAbortController.abort()
      currentAbortController = null
    }
    processing = false
    currentApplyProgress = null
  }

  queue = queue.filter((t) => t.id !== taskId)
  await saveQueue(currentProjectPath)
  processNext(currentProjectId)
}

export function getForeshadowingCleanupQueue(): readonly ForeshadowingCleanupTask[] {
  return queue
}

export function getForeshadowingCleanupProgress(): {
  taskId: string
  stage: ForeshadowingCleanupApplyStage
} | null {
  return currentApplyProgress
}

export function getForeshadowingCleanupLogs(): readonly string[] {
  return currentApplyLogs
}

export async function ensureForeshadowingCleanupQueueActive(
  projectId: string,
  projectPath: string,
): Promise<void> {
  const pp = normalizePath(projectPath)
  if (currentProjectId === projectId && currentProjectPath === pp) return
  await restoreForeshadowingCleanupQueue(projectId, projectPath)
}

export async function pauseForeshadowingCleanupQueue(): Promise<void> {
  if (!currentProjectId || !currentProjectPath) return

  const pausedProjectPath = currentProjectPath

  if (currentAbortController) {
    currentAbortController.abort()
    currentAbortController = null
  }
  processing = false
  currentApplyProgress = null
  currentApplyLogs = []

  for (const task of queue) {
    if (task.status === "processing") {
      task.status = "pending"
    }
  }

  await saveQueue(pausedProjectPath)

  queue = []
  currentProjectId = ""
  currentProjectPath = ""
}

export async function restoreForeshadowingCleanupQueue(
  projectId: string,
  projectPath: string,
): Promise<void> {
  const pp = normalizePath(projectPath)
  queue = []
  processing = false
  currentAbortController = null
  currentProjectId = projectId
  currentProjectPath = pp

  const saved = await loadQueue(pp, projectId)
  if (saved.length === 0) return

  const mine = saved.filter((t) => t.projectId === projectId)
  let restored = 0
  for (const task of mine) {
    if (task.status === "processing") {
      task.status = "pending"
      restored++
    }
  }

  queue = mine
  await saveQueue(pp)

  const pending = queue.filter((t) => t.status === "pending").length
  if (pending > 0 || restored > 0) {
    console.log(
      `[ForeshadowingCleanup Queue] Restored: ${pending} pending, ${restored} resumed`,
    )
    processNext(projectId)
  }
}

const MAX_RETRIES = 3

async function processNext(projectId: string): Promise<void> {
  if (processing) return
  if (currentProjectId !== projectId) return

  const next = queue.find(
    (t) => t.projectId === projectId && t.status === "pending",
  )
  if (!next) return

  const registryPath = await getProjectPathById(projectId)
  const pp = registryPath ? normalizePath(registryPath) : ""
  if (currentProjectId !== projectId) return

  if (!pp) {
    next.status = "failed"
    next.error = "项目未在注册表中找到（可能已被删除？）"
    await saveQueue(currentProjectPath)
    processNext(projectId)
    return
  }

  processing = true
  next.status = "processing"
  await saveQueue(pp)
  if (currentProjectId !== projectId) return

  const state = useWikiStore.getState()
  const llmConfig = next.modelId?.trim()
    ? resolveModelConfig(next.modelId, state.llmConfig, state.providerConfigs)
    : resolveDefaultModel(state.llmConfig)

  // Cleanup apply itself doesn't need LLM, but we still check config for consistency
  // with the rest of the app's model resolution paths.
  void hasUsableLlm
  void llmConfig

  currentAbortController = new AbortController()
  currentApplyProgress = { taskId: next.id, stage: "loading" }
  currentApplyLogs = []

  const appendLog = (message: string) => {
    const stamp = new Date().toLocaleTimeString()
    currentApplyLogs = [...currentApplyLogs, `${stamp}  ${message}`]
    console.log(`[ForeshadowingCleanup Queue] ${message}`)
  }

  try {
    const currentChapter = await resolveCurrentChapter(pp)
    await executeCleanupTask(pp, next.issue, {
      canonicalId: next.canonicalId,
      action: next.action ?? defaultCleanupAction(next.issue.kind),
      signal: currentAbortController.signal,
      onProgress: (stage) => {
        currentApplyProgress = { taskId: next.id, stage }
      },
      onLog: appendLog,
      currentChapter,
    })

    await removeIssueFromForeshadowingScanCache(pp, next.issue).catch((err) => {
      console.error(
        "[ForeshadowingCleanup Queue] failed to update scan cache:",
        err,
      )
    })

    if (currentProjectId !== projectId) return

    currentAbortController = null
    currentApplyProgress = null
    const completedTask = { ...next }
    queue = queue.filter((t) => t.id !== next.id)
    await saveQueue(pp)
    useWikiStore.getState().bumpDataVersion()
    notifyComplete(completedTask)
  } catch (err) {
    if (currentProjectId !== projectId) return
    currentAbortController = null
    currentApplyProgress = null
    const message = err instanceof Error ? err.message : String(err)
    appendLog(`失败：${message}`)

    const missing =
      /已不存在|not found|ENOENT|No such file|文件不存在/i.test(message)
    if (missing) {
      await removeIssueFromForeshadowingScanCache(pp, next.issue).catch(() => {})
      queue = queue.filter((t) => t.id !== next.id)
      await saveQueue(pp)
      appendLog("候选伏笔已不存在，已从列表移除")
      processing = false
      processNext(projectId)
      return
    }

    next.retryCount++
    next.error = message
    if (next.retryCount >= MAX_RETRIES) {
      next.status = "failed"
    } else {
      next.status = "pending"
    }
    await saveQueue(pp)
  }

  processing = false
  processNext(projectId)
}
