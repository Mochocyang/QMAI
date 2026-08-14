import { listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { refreshProjectState } from "@/lib/project-refresh"
import i18n from "@/i18n"
import { useOutlineGenerationStore } from "@/stores/outline-generation-store"
import { useImportProgressStore } from "@/stores/import-progress-store"
import { useWikiStore } from "@/stores/wiki-store"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { mapWithConcurrency } from "@/lib/async-pool"
import {
  finalizeProjectMemoryRebuild,
  ingestOutline,
  syncSnapshotToMemory,
  type OutlineIngestResult,
} from "./chapter-ingest"
import { resolveNovelModel } from "@/lib/novel/model-resolver"
import { getOutlineFileName, outlineSnapshotExists } from "./outline-ingest-utils"

export function createOutlineIngestTask(projectPath: string, outlinePath: string): string {
  return useOutlineGenerationStore.getState().createTask({
    projectPath: normalizePath(projectPath),
    kind: "ingest",
    outlinePath: normalizePath(outlinePath),
    status: "ingesting",
    message: i18n.t("novel.outlineGenerator.ingestingNotification"),
    error: null,
  })
}

export class OutlineIngestNotReadyError extends Error {
  constructor() {
    super(i18n.t("novel.outlineGenerator.ingestNoLlm"))
    this.name = "OutlineIngestNotReadyError"
  }
}

export function assertOutlineIngestLlmReady(): void {
  const state = useWikiStore.getState()
  const runtimeLlmConfig = resolveNovelModel(state.llmConfig, state.novelConfig, "extract")
  if (!hasUsableLlm(runtimeLlmConfig, state.providerConfigs)) {
    throw new OutlineIngestNotReadyError()
  }
}

export const BULK_OUTLINE_INGEST_CONCURRENCY = 2

export interface OutlineIngestFailure {
  name: string
  path: string
  reason: string
}

export type BulkOutlineIngestMode = "all" | "pending"

export interface BulkOutlineIngestResult {
  total: number
  succeeded: number
  failed: number
  cancelled?: boolean
  failures: OutlineIngestFailure[]
  /** Present when total is 0 and the caller asked for a scoped bulk run. */
  emptyReason?: "no_outlines" | "already_extracted"
}

export interface RunBulkOutlineIngestOptions {
  mode?: BulkOutlineIngestMode
}

export interface RunOutlineIngestPathsOptions {
  onProgressTaskStarted?: (taskId: string) => void
}

export interface OutlineIngestTaskResult {
  success: boolean
  outlinePath: string
  outlineFileName: string
  error?: string
  truncated?: boolean
  bodyLength?: number
  originalLength?: number
  bodyBudget?: number
}

export interface RunOutlineIngestTaskOptions {
  signal?: AbortSignal
  parentProgressId?: string
  manageProgress?: boolean
}

function buildOutlineIngestFailureReason(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function getOutlineIngestCancelledMessage(): string {
  return i18n.t("novel.outlineGenerator.ingestCancelledNotification")
}

function finalizeOutstandingIngestTasks(taskIds: string[], cancelled: boolean): void {
  const message = cancelled
    ? getOutlineIngestCancelledMessage()
    : i18n.t("novel.outlineGenerator.ingestFailedNotification")
  for (const taskId of taskIds) {
    const task = useOutlineGenerationStore.getState().tasks.find((item) => item.id === taskId)
    if (task?.status !== "ingesting") continue
    useOutlineGenerationStore.getState().updateTask(taskId, {
      status: "error",
      message,
      error: message,
    })
  }
}

/** Clear orphaned ingest tasks when no outline import progress is running. */
export function reconcileStaleOutlineIngestTasks(projectPath: string): void {
  const pp = normalizePath(projectPath)
  const hasRunningOutlineImport = useImportProgressStore.getState().tasks.some(
    (task) => task.projectPath === pp && task.kind === "outline" && task.status === "running",
  )
  if (hasRunningOutlineImport) return

  const message = getOutlineIngestCancelledMessage()
  for (const task of useOutlineGenerationStore.getState().tasks) {
    if (task.projectPath !== pp || task.kind !== "ingest" || task.status !== "ingesting") continue
    useOutlineGenerationStore.getState().updateTask(task.id, {
      status: "error",
      message,
      error: message,
    })
  }
}

function buildBulkIngestProgressMessage(result: BulkOutlineIngestResult): string {
  if (result.cancelled) {
    return i18n.t("novel.outlineGenerator.bulkIngestCancelledProgress", {
      succeeded: result.succeeded,
      total: result.total,
    })
  }
  if (result.failed > 0) {
    const preview = result.failures
      .slice(0, 3)
      .map((failure) => `${failure.name}: ${failure.reason}`)
      .join("；")
    return i18n.t("novel.outlineGenerator.bulkIngestProgressWithFailures", {
      succeeded: result.succeeded,
      failed: result.failed,
      preview,
    })
  }
  return i18n.t("novel.outlineGenerator.bulkIngestProgressDone", {
    succeeded: result.succeeded,
    total: result.total,
  })
}

export function formatBulkOutlineIngestResult(result: BulkOutlineIngestResult): string {
  if (result.total === 0) {
    if (result.emptyReason === "already_extracted") {
      return i18n.t("novel.outlineGenerator.bulkIngestAlreadyExtracted")
    }
    return i18n.t("novel.outlineGenerator.bulkIngestEmpty")
  }
  if (result.cancelled) {
    return i18n.t("novel.outlineGenerator.bulkIngestCancelled", {
      succeeded: result.succeeded,
      failed: result.failed,
      total: result.total,
    })
  }
  if (result.failed === 0) {
    return i18n.t("novel.outlineGenerator.bulkIngestResult", {
      total: result.total,
      succeeded: result.succeeded,
      failed: result.failed,
    })
  }

  const lines = result.failures
    .slice(0, 5)
    .map((failure) => `· ${failure.name}: ${failure.reason}`)
  const extra = result.failures.length > 5
    ? `\n${i18n.t("novel.outlineGenerator.bulkIngestMoreFailures", { count: result.failures.length - 5 })}`
    : ""

  return [
    i18n.t("novel.outlineGenerator.bulkIngestResultWithFailures", {
      total: result.total,
      succeeded: result.succeeded,
      failed: result.failed,
    }),
    ...lines,
  ].join("\n") + extra
}

type OutlineExtractOutcome =
  | { kind: "success"; path: string; taskId: string; ingestResult: OutlineIngestResult }
  | { kind: "failure"; path: string; taskId: string; reason: string }
  | { kind: "skipped"; path: string; taskId: string }

export async function runOutlineIngestPaths(
  projectPath: string,
  outlinePaths: string[],
  options?: RunOutlineIngestPathsOptions,
): Promise<BulkOutlineIngestResult> {
  assertOutlineIngestLlmReady()

  const pp = normalizePath(projectPath)
  const normalizedPaths = outlinePaths.map((path) => normalizePath(path))
  if (normalizedPaths.length === 0) {
    return { total: 0, succeeded: 0, failed: 0, failures: [] }
  }

  const abortController = new AbortController()
  const signal = abortController.signal
  const taskIds = normalizedPaths.map((outlinePath) => createOutlineIngestTask(pp, outlinePath))
  const progressTaskId = useImportProgressStore.getState().startTask({
    projectPath: pp,
    kind: "outline",
    total: normalizedPaths.length,
    currentTitle: getOutlineFileName(normalizedPaths[0] ?? ""),
    message: i18n.t("novel.outlineGenerator.bulkIngesting"),
    abortController,
    concurrency: BULK_OUTLINE_INGEST_CONCURRENCY,
    activeTitles: [],
  })
  options?.onProgressTaskStarted?.(progressTaskId)

  const failures: OutlineIngestFailure[] = []
  const extractProgress = {
    completed: 0,
    inFlight: new Set<string>(),
  }

  function publishExtractProgress(): void {
    const activeTitles = [...extractProgress.inFlight]
    useImportProgressStore.getState().updateTask(progressTaskId, {
      completed: extractProgress.completed,
      currentTitle: activeTitles[0] ?? "",
      activeTitles,
      concurrency: BULK_OUTLINE_INGEST_CONCURRENCY,
      message: activeTitles.length > 1
        ? i18n.t("novel.outlineGenerator.bulkIngestParallel", {
          active: activeTitles.length,
          concurrency: BULK_OUTLINE_INGEST_CONCURRENCY,
        })
        : i18n.t("novel.outlineGenerator.bulkIngesting"),
    })
  }

  const extractOutcomes = (await mapWithConcurrency(
    normalizedPaths,
    BULK_OUTLINE_INGEST_CONCURRENCY,
    async (outlinePath, index) => {
      const outlineFileName = getOutlineFileName(outlinePath)
      const taskId = taskIds[index]!

      if (signal.aborted) {
        useOutlineGenerationStore.getState().updateTask(taskId, {
          status: "error",
          message: getOutlineIngestCancelledMessage(),
          error: getOutlineIngestCancelledMessage(),
        })
        return { kind: "skipped", path: outlinePath, taskId } satisfies OutlineExtractOutcome
      }

      extractProgress.inFlight.add(outlineFileName)
      publishExtractProgress()

      useOutlineGenerationStore.getState().updateTask(taskId, {
        status: "ingesting",
        message: i18n.t("novel.outlineGenerator.ingestingNotification"),
        error: null,
      })

      try {
        const ingestResult = await ingestOutline(pp, outlinePath, signal, { skipSync: true })
        if (ingestResult.failureReason === "no_llm") {
          const reason = i18n.t("novel.outlineGenerator.ingestNoLlm")
          useOutlineGenerationStore.getState().updateTask(taskId, {
            status: "error",
            message: reason,
            error: reason,
          })
          return { kind: "failure", path: outlinePath, taskId, reason } satisfies OutlineExtractOutcome
        }
        if (!ingestResult.snapshot) {
          const reason = i18n.t("novel.outlineGenerator.ingestFailedNotification")
          useOutlineGenerationStore.getState().updateTask(taskId, {
            status: "error",
            message: reason,
            error: reason,
          })
          return { kind: "failure", path: outlinePath, taskId, reason } satisfies OutlineExtractOutcome
        }
        return { kind: "success", path: outlinePath, taskId, ingestResult } satisfies OutlineExtractOutcome
      } catch (err) {
        const reason = buildOutlineIngestFailureReason(err)
        useOutlineGenerationStore.getState().updateTask(taskId, {
          status: "error",
          message: reason,
          error: reason,
        })
        return { kind: "failure", path: outlinePath, taskId, reason } satisfies OutlineExtractOutcome
      } finally {
        extractProgress.inFlight.delete(outlineFileName)
        if (!signal.aborted) {
          extractProgress.completed += 1
        } else {
          const task = useOutlineGenerationStore.getState().tasks.find((item) => item.id === taskId)
          if (task?.status === "ingesting") {
            useOutlineGenerationStore.getState().updateTask(taskId, {
              status: "error",
              message: getOutlineIngestCancelledMessage(),
              error: getOutlineIngestCancelledMessage(),
            })
          }
        }
        publishExtractProgress()
      }
    },
    { signal },
  )).filter((outcome): outcome is OutlineExtractOutcome => outcome != null)

  const cancelled = signal.aborted
  const extractSuccesses = extractOutcomes.filter(
    (outcome): outcome is Extract<OutlineExtractOutcome, { kind: "success" }> => outcome.kind === "success",
  )

  for (const outcome of extractOutcomes) {
    if (outcome.kind === "failure") {
      failures.push({
        name: getOutlineFileName(outcome.path),
        path: outcome.path,
        reason: outcome.reason,
      })
    }
  }

  let succeeded = 0
  let syncCompleted = 0

  for (const item of extractSuccesses) {
    if (signal.aborted) break

    const outlineFileName = getOutlineFileName(item.path)
    useImportProgressStore.getState().updateTask(progressTaskId, {
      completed: syncCompleted,
      currentTitle: i18n.t("novel.outlineGenerator.bulkIngestSyncing", { name: outlineFileName }),
      activeTitles: [outlineFileName],
      concurrency: 1,
      message: i18n.t("novel.outlineGenerator.bulkIngestSyncing", { name: outlineFileName }),
    })

    try {
      await syncSnapshotToMemory(pp, item.ingestResult.snapshot!, {
        deferStructuredMemoryExport: true,
        deferDerivedRebuild: true,
      })
      const successMessage = item.ingestResult.truncated
        ? i18n.t("novel.outlineGenerator.ingestSuccessTruncatedNotification", {
          used: item.ingestResult.bodyLength,
          total: item.ingestResult.originalLength,
          budget: item.ingestResult.bodyBudget,
        })
        : i18n.t("novel.outlineGenerator.ingestSuccessNotification")
      useOutlineGenerationStore.getState().updateTask(item.taskId, {
        status: "done",
        message: successMessage,
        error: null,
      })
      succeeded += 1
    } catch (err) {
      const reason = buildOutlineIngestFailureReason(err)
      useOutlineGenerationStore.getState().updateTask(item.taskId, {
        status: "error",
        message: reason,
        error: reason,
      })
      failures.push({
        name: outlineFileName,
        path: item.path,
        reason,
      })
    } finally {
      syncCompleted += 1
      useImportProgressStore.getState().updateTask(progressTaskId, {
        completed: syncCompleted,
        activeTitles: [],
      })
    }
  }

  if (succeeded > 0) {
    await finalizeProjectMemoryRebuild(pp)
    await refreshProjectState(pp)
  }

  const result: BulkOutlineIngestResult = {
    total: normalizedPaths.length,
    succeeded,
    failed: failures.length,
    cancelled: cancelled || undefined,
    failures,
  }

  useImportProgressStore.getState().finishTask(
    progressTaskId,
    cancelled ? "cancelled" : failures.length > 0 ? "error" : "done",
    {
      completed: syncCompleted,
      total: normalizedPaths.length,
      currentTitle: "",
      activeTitles: [],
      message: buildBulkIngestProgressMessage(result),
    },
  )

  finalizeOutstandingIngestTasks(taskIds, cancelled)

  return result
}

export async function runSingleOutlineIngest(
  projectPath: string,
  outlinePath: string,
): Promise<BulkOutlineIngestResult> {
  return runOutlineIngestPaths(projectPath, [normalizePath(outlinePath)])
}

export function startOutlineIngestTask(projectPath: string, outlinePath: string): string {
  const taskId = createOutlineIngestTask(projectPath, outlinePath)
  void runOutlineIngestTask(taskId)
  return taskId
}

function collectOutlineMarkdownPaths(
  nodes: Array<{ path: string; name: string; is_dir: boolean; children?: Array<{ path: string; name: string; is_dir: boolean; children?: unknown[] }> }>,
): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      paths.push(...collectOutlineMarkdownPaths(node.children as Array<{ path: string; name: string; is_dir: boolean; children?: Array<{ path: string; name: string; is_dir: boolean; children?: unknown[] }> }>))
      continue
    }
    if (!node.is_dir && node.name.endsWith(".md")) {
      paths.push(normalizePath(node.path))
    }
  }
  return paths
}

export async function runBulkOutlineIngest(
  projectPath: string,
  options?: RunBulkOutlineIngestOptions,
): Promise<BulkOutlineIngestResult> {
  const pp = normalizePath(projectPath)
  const mode: BulkOutlineIngestMode = options?.mode ?? "all"
  let outlinePaths: string[] = []

  try {
    const tree = await listDirectory(`${pp}/wiki/outlines`)
    outlinePaths = collectOutlineMarkdownPaths(tree as Array<{ path: string; name: string; is_dir: boolean; children?: Array<{ path: string; name: string; is_dir: boolean; children?: unknown[] }> }>)
      .sort((a, b) => a.localeCompare(b, "zh-CN"))
  } catch {
    return { total: 0, succeeded: 0, failed: 0, failures: [], emptyReason: "no_outlines" }
  }

  if (outlinePaths.length === 0) {
    return { total: 0, succeeded: 0, failed: 0, failures: [], emptyReason: "no_outlines" }
  }

  if (mode === "pending") {
    const pending: string[] = []
    for (const outlinePath of outlinePaths) {
      if (!(await outlineSnapshotExists(pp, outlinePath))) {
        pending.push(outlinePath)
      }
    }
    if (pending.length === 0) {
      return { total: 0, succeeded: 0, failed: 0, failures: [], emptyReason: "already_extracted" }
    }
    outlinePaths = pending
  }

  return runOutlineIngestPaths(pp, outlinePaths)
}

export async function runOutlineIngestTask(
  taskId: string,
  options: RunOutlineIngestTaskOptions = {},
): Promise<OutlineIngestTaskResult | null> {
  const task = useOutlineGenerationStore.getState().tasks.find((item) => item.id === taskId)
  if (!task?.outlinePath) return null

  const outlinePath = task.outlinePath
  const outlineFileName = getOutlineFileName(outlinePath)
  const manageProgress = options.manageProgress !== false
  const abortController = options.signal ? null : new AbortController()
  const signal = options.signal ?? abortController!.signal
  let progressTaskId = options.parentProgressId

  if (manageProgress && !progressTaskId) {
    progressTaskId = useImportProgressStore.getState().startTask({
      projectPath: task.projectPath,
      kind: "outline",
      total: 1,
      currentTitle: outlineFileName,
      message: "正在提取大纲记忆",
      abortController: abortController ?? undefined,
    })
  }

  try {
    useOutlineGenerationStore.getState().updateTask(taskId, {
      status: "ingesting",
      message: i18n.t("novel.outlineGenerator.ingestingNotification"),
      error: null,
    })
    const ingestResult = await ingestOutline(task.projectPath, outlinePath, signal)
    const snapshot = ingestResult.snapshot

    if (ingestResult.failureReason === "no_llm") {
      const reason = i18n.t("novel.outlineGenerator.ingestNoLlm")
      useOutlineGenerationStore.getState().updateTask(taskId, {
        status: "error",
        message: reason,
        error: reason,
      })
      if (manageProgress && progressTaskId) {
        useImportProgressStore.getState().finishTask(progressTaskId, "error", {
          completed: 0,
          total: 1,
          currentTitle: "",
          message: `${outlineFileName} 提取失败：${reason}`,
        })
      }
      return { success: false, outlinePath, outlineFileName, error: reason }
    }

    if (snapshot) {
      await refreshProjectState(task.projectPath)
    }

    const successMessage = snapshot
      ? ingestResult.truncated
        ? i18n.t("novel.outlineGenerator.ingestSuccessTruncatedNotification", {
          used: ingestResult.bodyLength,
          total: ingestResult.originalLength,
          budget: ingestResult.bodyBudget,
        })
        : i18n.t("novel.outlineGenerator.ingestSuccessNotification")
      : i18n.t("novel.outlineGenerator.ingestFailedNotification")
    const errorMessage = snapshot ? undefined : i18n.t("novel.outlineGenerator.ingestFailedNotification")

    useOutlineGenerationStore.getState().updateTask(taskId, {
      status: snapshot ? "done" : "error",
      message: successMessage,
      error: errorMessage ?? null,
    })

    if (manageProgress && progressTaskId) {
      useImportProgressStore.getState().finishTask(progressTaskId, snapshot ? "done" : "error", {
        completed: snapshot ? 1 : 0,
        total: 1,
        currentTitle: "",
        message: snapshot
          ? ingestResult.truncated
            ? i18n.t("novel.outlineGenerator.ingestProgressTruncated", {
              name: outlineFileName,
              used: ingestResult.bodyLength,
              total: ingestResult.originalLength,
            })
            : `${outlineFileName} 提取完成`
          : `${outlineFileName} 提取失败`,
      })
    }

    return {
      success: Boolean(snapshot),
      outlinePath,
      outlineFileName,
      error: errorMessage,
      truncated: ingestResult.truncated,
      bodyLength: ingestResult.bodyLength,
      originalLength: ingestResult.originalLength,
      bodyBudget: ingestResult.bodyBudget,
    }
  } catch (err) {
    const message = buildOutlineIngestFailureReason(err)
    useOutlineGenerationStore.getState().updateTask(taskId, {
      status: "error",
      message,
      error: message,
    })
    if (manageProgress && progressTaskId) {
      useImportProgressStore.getState().finishTask(progressTaskId, "error", {
        completed: 0,
        total: 1,
        currentTitle: "",
        message: `${outlineFileName} 提取失败：${message}`,
      })
    }
    return { success: false, outlinePath, outlineFileName, error: message }
  }
}
