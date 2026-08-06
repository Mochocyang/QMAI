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
import { useWikiStore } from "@/stores/wiki-store"
import {
  applyBulkDeleteAndAbandon,
  applyCleanupIssue,
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
  saveForeshadowingTracker,
  type ForeshadowingStore,
} from "@/lib/novel/foreshadowing-tracker"
import { writeForeshadowingMd } from "@/lib/novel/tracking-files"
import {
  exportStructuredMemoryToWiki,
  finalizeProjectMemoryRebuild,
  listSnapshots,
  loadSnapshot,
} from "@/lib/novel/chapter-ingest"
import { loadForeshadowingKeep } from "@/lib/foreshadowing-cleanup-cache"
import type { FileNode } from "@/types/wiki"

export type ForeshadowingCleanupScanStage = "loading" | "detecting"
export type ForeshadowingCleanupApplyStage = "loading" | "applying" | "writing"

export type CleanupLogFn = (message: string) => void

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

export function buildCleanupLlmCall(llmConfig: LlmConfig): CleanupLlmCall {
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

export interface ForeshadowingCleanupScanResult {
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

async function syncDerivedDocs(projectPath: string, store: ForeshadowingStore): Promise<void> {
  const pp = normalizePath(projectPath)
  const resolvedRecords = store.items
    .filter((f) => f.status === "resolved" && f.resolvedChapter != null)
    .map((f) => ({
      id: f.id,
      resolvedInChapter: f.resolvedChapter!,
      resolution: `伏笔「${f.name}」在第${f.resolvedChapter}章回收`,
    }))

  try {
    await writeForeshadowingMd(pp, store.items, resolvedRecords)
  } catch (err) {
    console.warn("[ForeshadowingCleanup] writeForeshadowingMd failed:", err)
  }

  try {
    const numbers = await listSnapshots(pp)
    const latestPositive = numbers.filter((n) => n > 0).sort((a, b) => b - a)[0]
    if (latestPositive != null) {
      const snap = await loadSnapshot(pp, latestPositive)
      if (snap) {
        await exportStructuredMemoryToWiki(pp, snap)
      }
    }
  } catch (err) {
    console.warn("[ForeshadowingCleanup] memory doc rewrite failed:", err)
  }
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
  const pp = normalizePath(projectPath)
  const log = options.onLog
  const action = options.action ?? defaultCleanupAction(issue.kind)
  options.signal?.throwIfAborted()

  const actionLabel =
    action === "delete" ? "删除" : action === "abandon" ? "放弃" : "合并"
  log?.(
    `开始${actionLabel} ${issue.kind}：${issue.ids.join(", ")}${
      action === "merge" ? ` → ${options.canonicalId || issue.canonicalId}` : ""
    }`,
  )

  options.onProgress?.("loading")
  const store = await loadForeshadowingTracker(pp)
  const present = issue.ids.filter((id) => store.items.some((f) => f.id === id))
  const missing = issue.ids.filter((id) => !present.includes(id))
  if (present.length === 0) {
    throw new Error(
      `伏笔已不存在：${issue.ids.join(", ")} — 可能已被先前任务处理或重建覆盖`,
    )
  }
  if (missing.length > 0) {
    if (action === "delete") {
      log?.(`部分条目已不存在，将删除剩余 ${present.length} 条：${present.join(", ")}`)
    } else {
      throw new Error(
        `伏笔已不存在：${missing.join(", ")} — 可能已被先前任务处理或重建覆盖`,
      )
    }
  }

  options.onProgress?.("applying")
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const backupDir = await backupFiles(pp, stamp)
  log?.(`已备份 → ${backupDir}`)

  const effectiveIssue =
    action === "delete" && missing.length > 0
      ? { ...issue, ids: present }
      : issue

  applyCleanupIssue(store, effectiveIssue, {
    canonicalId: options.canonicalId,
    reason: issue.reason,
    chapter: options.currentChapter,
    action,
  })

  options.onProgress?.("writing")
  await saveForeshadowingTracker(pp, store)
  log?.("已写入 foreshadowing-tracker.json")
  await syncDerivedDocs(pp, store)
  log?.("已同步 tracking / memory 文档")

  useWikiStore.getState().bumpDataVersion()
  log?.("处理完成")
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
  const pp = normalizePath(projectPath)
  const log = options.onLog
  const deleteIds = [...new Set(options.deleteIds.filter(Boolean))]
  const abandonIds = [...new Set(options.abandonIds.filter(Boolean))].filter(
    (id) => !deleteIds.includes(id),
  )

  if (deleteIds.length === 0 && abandonIds.length === 0) {
    log?.("没有可清理的噪声/失效条目")
    return { deleted: 0, abandoned: 0 }
  }

  options.signal?.throwIfAborted()
  log?.(
    `开始一键清理：删除噪声 ${deleteIds.length} 条，放弃失效 ${abandonIds.length} 条`,
  )

  options.onProgress?.("loading")
  const store = await loadForeshadowingTracker(pp)

  options.onProgress?.("applying")
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const backupDir = await backupFiles(pp, `bulk-${stamp}`)
  log?.(`已备份 → ${backupDir}`)

  const result = applyBulkDeleteAndAbandon(store, {
    deleteIds,
    abandonIds,
    reason: "一键清理噪声/失效",
    chapter: options.currentChapter,
  })
  log?.(`已处理：删除 ${result.deleted} 条，放弃 ${result.abandoned} 条`)

  options.onProgress?.("writing")
  await saveForeshadowingTracker(pp, store)
  log?.("已写入 foreshadowing-tracker.json")
  await syncDerivedDocs(pp, store)
  log?.("已同步 tracking / memory 文档")

  useWikiStore.getState().bumpDataVersion()
  log?.("一键清理完成")
  return result
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

export { buildOverview }
