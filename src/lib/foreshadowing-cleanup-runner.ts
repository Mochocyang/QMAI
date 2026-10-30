/**
 * I/O wrapper for foreshadowing cleanup: scan + execute + backup + sync docs.
 */
import {
  readFile,
  writeFile,
  deleteFile,
  listDirectory,
  fileExists,
  createDirectory,
} from "@/commands/fs"
import { streamChat } from "@/lib/llm-client"
import { normalizePath } from "@/lib/path-utils"
import type { LlmConfig } from "@/stores/wiki-store"
import {
  buildOverview,
  defaultCleanupAction,
  detectCleanupIssues,
  toForeshadowingSummary,
  type CleanupApplyAction,
  type CleanupBatchProgress,
  type CleanupIssue,
  type CleanupLlmCall,
} from "@/lib/foreshadowing-cleanup"
import {
  loadForeshadowingTracker,
  type ForeshadowingStore,
} from "@/lib/novel/foreshadowing-tracker"
import {
  finalizeProjectMemoryRebuild,
  listSnapshots,
} from "@/lib/novel/chapter-ingest"
import { loadForeshadowingKeep } from "@/lib/foreshadowing-cleanup-cache"
import type { FileNode } from "@/types/wiki"

export type ForeshadowingCleanupScanStage = "loading" | "detecting"
export type ForeshadowingCleanupApplyStage = "loading" | "applying" | "writing"

type CleanupLogFn = (message: string) => void

export interface ForeshadowingCleanupScanProgress {
  stage: ForeshadowingCleanupScanStage
  /** 0–100; loading uses a small fixed value, detecting follows batches */
  percent: number
  batch?: CleanupBatchProgress
}
function describeLlm(llmConfig: LlmConfig): string {
  const provider = llmConfig.provider?.trim() || "unknown"
  const model = llmConfig.model?.trim() || "unknown"
  return `${provider}/${model}`
}

function buildCleanupLlmCall(llmConfig: LlmConfig): CleanupLlmCall {
  return async (systemPrompt, userMessage, signal) => {
    let result = ""
    let streamError: Error | null = null
    await new Promise<void>((resolve) => {
      streamChat(
        llmConfig,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        {
          onToken: (t) => {
            result += t
          },
          onDone: () => resolve(),
          onError: (err) => {
            streamError = err
            resolve()
          },
        },
        signal,
        { temperature: 0.1 },
      ).catch((err) => {
        streamError = err instanceof Error ? err : new Error(String(err))
        resolve()
      })
    })
    if (streamError) throw streamError
    return result
  }
}

export async function resolveCurrentChapter(projectPath: string): Promise<number> {
  const numbers = await listSnapshots(projectPath)
  const positive = numbers.filter((n) => n > 0)
  if (positive.length === 0) return 1
  return Math.max(...positive)
}

interface ForeshadowingCleanupScanResult {
  issues: CleanupIssue[]
  scannedItemCount: number
  currentChapter: number
  overview: ReturnType<typeof buildOverview>
  store: ForeshadowingStore
}

export async function runForeshadowingCleanupScan(
  projectPath: string,
  llmConfig: LlmConfig,
  options: {
    signal?: AbortSignal
    onProgress?: (progress: ForeshadowingCleanupScanProgress) => void
    onLog?: CleanupLogFn
  } = {},
): Promise<ForeshadowingCleanupScanResult> {
  const log = options.onLog
  const report = (progress: ForeshadowingCleanupScanProgress) => {
    options.onProgress?.(progress)
  }
  const pp = normalizePath(projectPath)
  log?.(`开始扫描伏笔，模型：${describeLlm(llmConfig)}`)
  report({ stage: "loading", percent: 2 })
  log?.("正在读取伏笔追踪器…")

  const store = await loadForeshadowingTracker(pp)
  const currentChapter = await resolveCurrentChapter(pp)
  const overview = buildOverview(store)
  log?.(
    `已读取 ${store.items.length} 条伏笔（活跃 ${overview.active} / 已回收 ${overview.resolved} / 已放弃 ${overview.abandoned}），当前约第 ${currentChapter} 章`,
  )
  report({ stage: "loading", percent: 8 })

  if (store.items.length === 0) {
    log?.("无伏笔数据，跳过检测")
    report({ stage: "detecting", percent: 100 })
    return {
      issues: [],
      scannedItemCount: 0,
      currentChapter,
      overview,
      store,
    }
  }

  report({ stage: "detecting", percent: 10 })
  const keep = await loadForeshadowingKeep(pp)
  if (keep.length > 0) {
    log?.(`已加载 ${keep.length} 组「保留」白名单`)
  }
  const activeCount = overview.active
  const estimatedBatches = Math.max(1, Math.ceil(activeCount / 80))
  log?.(
    `正在调用模型分析伏笔问题（活跃 ${activeCount} 条，约 ${estimatedBatches} 批）…`,
  )
  const llm = buildCleanupLlmCall(llmConfig)
  const summaries = store.items.map(toForeshadowingSummary)
  const issues = await detectCleanupIssues(summaries, currentChapter, llm, {
    signal: options.signal,
    keepKeys: keep,
    onBatchProgress: (batch) => {
      // loading 10% + detecting 90%
      const base = 10
      const span = 90
      const completed =
        batch.phase === "batch_done" ? batch.current : batch.current - 1
      const percent = Math.min(
        99,
        Math.round(base + (completed / Math.max(1, batch.total)) * span),
      )
      if (batch.phase === "batch_start") {
        log?.(
          `分析第 ${batch.current}/${batch.total} 批（本批 ${batch.batchSize} 条，活跃共 ${batch.activeCount} 条）…`,
        )
      } else {
        log?.(`第 ${batch.current}/${batch.total} 批完成`)
      }
      report({ stage: "detecting", percent, batch })
    },
  })
  report({ stage: "detecting", percent: 100 })
  log?.(
    `分析完成：${issues.filter((i) => i.kind === "duplicate").length} 组重复，${issues.filter((i) => i.kind === "noise").length} 条噪声，${issues.filter((i) => i.kind === "stale").length} 条失效`,
  )

  return {
    issues,
    scannedItemCount: store.items.length,
    currentChapter,
    overview,
    store,
  }
}

async function backupFiles(
  projectPath: string,
  stamp: string,
): Promise<string> {
  const pp = normalizePath(projectPath)
  const backupDir = `${pp}/.qmai/page-history/foreshadowing-${stamp}`
  await createDirectory(backupDir)

  const trackerPath = `${pp}/.novel/foreshadowing-tracker.json`
  if (await fileExists(trackerPath)) {
    const content = await readFile(trackerPath)
    await writeFile(`${backupDir}/foreshadowing-tracker.json`, content)
  }

  for (const rel of [
    "wiki/tracking/伏笔.md",
    "QM/tracking/伏笔.md",
    "wiki/memory/foreshadowing-tracker.md",
    "QM/memory/foreshadowing-tracker.md",
  ]) {
    const abs = `${pp}/${rel}`
    try {
      if (await fileExists(abs)) {
        const content = await readFile(abs)
        const sanitized = rel.replace(/[/\\]/g, "_")
        await writeFile(`${backupDir}/${sanitized}`, content)
      }
    } catch {
      // optional paths
    }
  }
  return backupDir
}

export async function executeCleanupTask(
  projectPath: string,
  issue: CleanupIssue,
  options: {
    canonicalId?: string
    action?: CleanupApplyAction
    signal?: AbortSignal
    onProgress?: (stage: ForeshadowingCleanupApplyStage) => void
    onLog?: CleanupLogFn
    currentChapter?: number
  } = {},
): Promise<void> {
  options.signal?.throwIfAborted()
  const action = options.action ?? defaultCleanupAction(issue.kind)
  if (action !== "delete") {
    throw new Error("旧版合并/放弃任务需要重新定位来源，请到「清理写作记忆」重新扫描。")
  }
  options.onProgress?.("applying")
  const { cleanupLegacyForeshadowingSources } = await import("@/lib/novel/memory-cleanup-runner")
  await cleanupLegacyForeshadowingSources(projectPath, issue.ids, options.onLog)
  options.onProgress?.("writing")
}

export async function executeBulkNoiseAndStaleCleanup(
  projectPath: string,
  options: {
    deleteIds: readonly string[]
    abandonIds: readonly string[]
    currentChapter?: number
    onLog?: CleanupLogFn
    onProgress?: (stage: ForeshadowingCleanupApplyStage) => void
    signal?: AbortSignal
  },
): Promise<{ deleted: number; abandoned: number }> {
  options.signal?.throwIfAborted()
  if (options.abandonIds.length) {
    throw new Error("旧版放弃任务需要重新定位来源，请到「清理写作记忆」重新扫描。")
  }
  if (!options.deleteIds.length) return { deleted: 0, abandoned: 0 }
  const { cleanupLegacyForeshadowingSources } = await import("@/lib/novel/memory-cleanup-runner")
  options.onProgress?.("applying")
  await cleanupLegacyForeshadowingSources(projectPath, options.deleteIds, options.onLog)
  options.onProgress?.("writing")
  return { deleted: new Set(options.deleteIds).size, abandoned: 0 }
}

export async function rebuildForeshadowingFromSnapshots(
  projectPath: string,
  options: { onLog?: CleanupLogFn } = {},
): Promise<void> {
  const pp = normalizePath(projectPath)
  const log = options.onLog
  log?.("正在备份当前伏笔数据…")
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const backupDir = await backupFiles(pp, `rebuild-${stamp}`)
  log?.(`已备份 → ${backupDir}`)
  log?.("正在从快照全量重建伏笔追踪器…")
  await finalizeProjectMemoryRebuild(pp)
  const store = await loadForeshadowingTracker(pp)
  const overview = buildOverview(store)
  log?.(
    `重建完成：共 ${overview.total} 条（活跃 ${overview.active} / 已回收 ${overview.resolved} / 已放弃 ${overview.abandoned}）`,
  )
}

export interface InvalidSnapshotInfo {
  fileName: string
  path: string
  chapterNumber: number
  foreshadowingChangeCount: number
}

function* walkFiles(nodes: FileNode[], prefix: string): Generator<FileNode> {
  for (const node of nodes) {
    if (node.is_dir) {
      if (node.children) yield* walkFiles(node.children, prefix)
      continue
    }
    if (node.path.includes(prefix)) yield node
  }
}

export async function listInvalidSnapshots(
  projectPath: string,
): Promise<InvalidSnapshotInfo[]> {
  const pp = normalizePath(projectPath)
  let tree: FileNode[]
  try {
    tree = await listDirectory(pp)
  } catch {
    return []
  }

  const results: InvalidSnapshotInfo[] = []
  for (const node of walkFiles(tree, ".novel/snapshots")) {
    if (!node.name.endsWith(".snapshot.json")) continue
    try {
      const raw = await readFile(node.path)
      const data = JSON.parse(raw) as {
        chapterNumber?: number
        foreshadowingChanges?: string[]
      }
      const chapterNumber = data.chapterNumber
      if (typeof chapterNumber !== "number" || chapterNumber > 0) continue
      results.push({
        fileName: node.name,
        path: node.path,
        chapterNumber,
        foreshadowingChangeCount: Array.isArray(data.foreshadowingChanges)
          ? data.foreshadowingChanges.length
          : 0,
      })
    } catch {
      // skip unreadable
    }
  }
  return results.sort((a, b) => a.chapterNumber - b.chapterNumber)
}

export async function deleteInvalidSnapshots(
  _projectPath: string,
  paths: string[],
  options: { onLog?: CleanupLogFn } = {},
): Promise<number> {
  const log = options.onLog
  let deleted = 0
  for (const path of paths) {
    try {
      await deleteFile(path)
      // also try companion .md
      if (path.endsWith(".json")) {
        const md = path.replace(/\.json$/, ".md")
        try {
          if (await fileExists(md)) await deleteFile(md)
        } catch {
          // ignore
        }
      }
      deleted++
      log?.(`已删除 ${path.split("/").pop()}`)
    } catch (err) {
      log?.(
        `删除失败 ${path}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return deleted
}
