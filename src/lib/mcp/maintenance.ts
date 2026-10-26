import { fileExists, readFile } from "@/commands/fs"
import { normalizeComparablePath } from "@/lib/path-utils"
import { refreshProjectState } from "@/lib/project-refresh"
import { getEffectiveSavedModels, isProviderAvailable } from "@/lib/llm-model-keys"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { resolveDefaultModel, resolveModelConfig, resolveUsableModelKey } from "@/lib/novel/model-resolver"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"
import { MEMORY_FIELDS, MEMORY_LABELS, type MemoryField } from "@/lib/novel/memory-cleanup-policy"
import { applyMemoryCleanup, keepMemoryCleanupIssue, loadMemoryCleanupScan, runMemoryCleanupScan, undoLastMemoryCleanup } from "@/lib/novel/memory-cleanup-runner"
import type { MemoryCleanupScan, MemoryCleanupScope } from "@/lib/novel/memory-cleanup"
import { loadMemoryMaintenanceOverview, loadMemoryMaintenanceSettings, memoryMaintenanceWarnings, updateMemoryMaintenanceSettings, MAINTENANCE_KINDS, type MemoryMaintenanceSettings } from "@/lib/novel/memory-maintenance"
import { getOpenDocumentGuard } from "./open-document"
import { lastMemoryCleanupId, maintenanceProgressStore } from "./maintenance-progress"
import { writingRunRegistry } from "./stop-writing"

export const MAINTENANCE_TOOL_NAMES = [
  "get_maintenance_status", "scan_memory_cleanup", "get_memory_cleanup_result", "apply_memory_cleanup",
  "keep_memory_cleanup_issues", "undo_memory_cleanup", "get_maintenance_progress", "stop_maintenance_task", "update_maintenance_settings",
] as const

function activeProject(args: Record<string, unknown>): string {
  const project = useWikiStore.getState().project
  if (!project) throw new Error("请先通过 open_bookshelf 打开要维护的项目。")
  if (args.projectPath !== undefined && typeof args.projectPath !== "string") throw new Error("projectPath 必须是项目目录字符串")
  const current = normalizeComparablePath(project.path)
  if (typeof args.projectPath === "string" && args.projectPath.trim() && normalizeComparablePath(args.projectPath.trim()) !== current) {
    throw new Error("维护任务必须针对当前打开的项目，请先通过 open_bookshelf 切换到目标项目。")
  }
  return current
}
function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`请提供 ${name}`)
  return value.trim()
}
function integer(value: unknown, name: string, min: number, max: number, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`${name} 必须是 ${min}–${max} 之间的整数`)
  return value
}
function issueIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 100 || value.some((id) => typeof id !== "string" || !id.trim())) throw new Error("issueIds 必须包含 1–100 个候选 ID")
  return [...new Set(value as string[])]
}
function requireCleanEditor(projectPath: string): void {
  const selected = useWikiStore.getState().selectedFile
  if (selected && isMemoryDocument(selected) && getOpenDocumentGuard(selected)?.isDirty()) throw new Error("当前记忆文档有未保存修改，请先保存或放弃编辑，再执行维护。")
  if (normalizeComparablePath(useWikiStore.getState().project?.path ?? "") !== projectPath) throw new Error("当前项目已变化，未执行维护。")
}
function isMemoryDocument(path: string): boolean { return /\/(?:wiki|QM)\/(?:memory|tracking|entities)\/|\/\.novel\/|\/retrieval\//.test(path.replace(/\\/g, "/")) }
async function refreshLive(projectPath: string, documents: boolean) {
  const state = useWikiStore.getState()
  if (normalizeComparablePath(state.project?.path ?? "") !== projectPath) return
  const path = state.selectedFile
  if (documents && path && isMemoryDocument(path)) {
    const guard = getOpenDocumentGuard(path)
    if (guard && !guard.isDirty()) {
      try {
        if (await fileExists(path)) guard.applyMarkdown(await readFile(path))
        else useWikiStore.getState().setSelectedFile(null)
      } catch (error) { console.warn("[MCP maintenance] 编辑器刷新失败:", error) }
    }
  }
  if (documents) await refreshProjectState(projectPath)
  else state.bumpDataVersion()
}
function safeError(error: unknown): string {
  const state = useWikiStore.getState()
  let message = error instanceof Error ? error.message : String(error)
  for (const secret of [state.llmConfig.apiKey, ...Object.values(state.providerConfigs).map((p) => p.apiKey)].filter((s): s is string => typeof s === "string" && s.length > 3)) {
    message = message.split(secret).join("[已隐藏]").split(encodeURIComponent(secret)).join("[已隐藏]")
  }
  return message.replace(/Bearer\s+[^\s"']+/gi, "Bearer [已隐藏]").slice(0, 2000)
}
async function selectedScan(projectPath: string, scanId: unknown): Promise<MemoryCleanupScan> {
  const id = requiredText(scanId, "scanId")
  const scan = await loadMemoryCleanupScan(projectPath)
  if (!scan || scan.scanId !== id) throw new Error("扫描结果已变化、已过期或不属于该项目，请重新扫描。")
  return scan
}
function selectedIssues(scan: MemoryCleanupScan, value: unknown) {
  const ids = issueIds(value)
  const selected = ids.map((id) => scan.issues.find((issue) => issue.id === id))
  if (selected.some((issue) => !issue)) throw new Error("包含当前扫描结果中不存在的候选 ID")
  return selected.filter((issue): issue is NonNullable<typeof issue> => !!issue)
}
function availableModels() {
  const state = useWikiStore.getState()
  return Object.entries(state.providerConfigs).filter(([id, config]) => isProviderAvailable(id, config))
    .flatMap(([provider, config]) => getEffectiveSavedModels(config).map((model) => ({ id: `${provider}/${model.model}`, name: model.name, provider })))
}
async function resolveScanModel(projectPath: string, requested: unknown): Promise<{ config: LlmConfig; id: string }> {
  if (requested !== undefined && (typeof requested !== "string" || !requested.trim())) throw new Error("model 必须是已配置模型的完整 ID")
  const state = useWikiStore.getState()
  const settings = await loadMemoryMaintenanceSettings(projectPath)
  const model = typeof requested === "string" ? requested.trim() : settings.modelId.trim()
  let config: LlmConfig
  if (model) {
    const id = resolveUsableModelKey(model, state.llmConfig, state.providerConfigs)
    if (!id) throw new Error(`找不到可用的检测模型：${model}。请用 get_maintenance_status 查询 availableModels。`)
    config = resolveModelConfig(id, state.llmConfig, state.providerConfigs)
  } else config = resolveDefaultModel(state.llmConfig)
  if (!hasUsableLlm(config, state.providerConfigs)) throw new Error("当前没有可用的检测模型")
  return { config: structuredClone(config), id: `${config.provider}/${config.model}` }
}

export async function dispatchMaintenanceTool(name: string, args: Record<string, unknown>): Promise<string> {
  const progressOnly = name === "get_maintenance_progress" || name === "stop_maintenance_task"
  const projectPath = progressOnly && args.projectPath !== undefined
    ? normalizeComparablePath(requiredText(args.projectPath, "projectPath")) : activeProject(args)
  if (name === "get_maintenance_status") {
    const [overview, settings, scan, cleanupId] = await Promise.all([
      loadMemoryMaintenanceOverview(projectPath), loadMemoryMaintenanceSettings(projectPath), loadMemoryCleanupScan(projectPath), lastMemoryCleanupId(projectPath),
    ])
    const selected = useWikiStore.getState().selectedFile
    return JSON.stringify({ projectPath, overview, settings, warnings: memoryMaintenanceWarnings(overview, settings), availableModels: availableModels(),
      editor: { path: selected, isDirty: selected ? getOpenDocumentGuard(selected)?.isDirty() ?? false : false }, writing: writingRunRegistry.has(projectPath),
      activeRunId: maintenanceProgressStore.active(projectPath), lastCleanupId: cleanupId,
      scan: scan ? { scanId: scan.scanId, scannedAt: scan.scannedAt, scope: scan.scope, recordCount: scan.records.length, issueCount: scan.issues.length,
        complete: scan.complete !== false, completedBatches: scan.completedBatches ?? null, totalBatches: scan.totalBatches ?? null, scannedRecordCount: scan.scannedRecordCount ?? scan.records.length } : null,
    })
  }
  if (name === "get_maintenance_progress") return JSON.stringify(await maintenanceProgressStore.get({ projectPath, runId: requiredText(args.runId, "runId"),
    afterRevision: args.afterRevision === undefined ? undefined : integer(args.afterRevision, "afterRevision", 0, Number.MAX_SAFE_INTEGER),
    waitMs: integer(args.waitMs, "waitMs", 0, 30000, 0),
  }))
  if (name === "stop_maintenance_task") return JSON.stringify(await maintenanceProgressStore.stop(projectPath, requiredText(args.runId, "runId")))
  if (name === "scan_memory_cleanup") {
    let fields: MemoryField[] | undefined
    if (args.fields !== undefined) {
      if (!Array.isArray(args.fields) || !args.fields.length || args.fields.some((field) => !MEMORY_FIELDS.includes(field as MemoryField))) throw new Error("fields 必须是有效且非空的记忆类别列表")
      fields = [...new Set(args.fields as MemoryField[])]
    }
    const scope: MemoryCleanupScope | undefined = args.fromChapter === undefined && args.toChapter === undefined ? undefined : {
      ...(args.fromChapter === undefined ? {} : { fromChapter: integer(args.fromChapter, "fromChapter", 1, 1000000) }),
      ...(args.toChapter === undefined ? {} : { toChapter: integer(args.toChapter, "toChapter", 1, 1000000) }),
    }
    if (scope?.fromChapter !== undefined && scope.toChapter !== undefined && scope.fromChapter > scope.toChapter) throw new Error("fromChapter 不能大于 toChapter")
    const { config, id } = await resolveScanModel(projectPath, args.model)
    return JSON.stringify(await maintenanceProgressStore.start({ projectPath, operation: "scan", model: id }, async (task) => {
      task.report("读取来源记忆")
      const scan = await runMemoryCleanupScan(projectPath, config, { fields, scope, signal: task.signal, onLog: task.log,
        onProgress: (done, total) => task.report("模型识别清理候选", { done, total }) })
      await refreshLive(projectPath, false)
      return { scanId: scan.scanId, scope: scan.scope, recordCount: scan.records.length, issueCount: scan.issues.length }
    }, safeError))
  }
  if (name === "get_memory_cleanup_result") {
    const scan = args.scanId === undefined ? await loadMemoryCleanupScan(projectPath) : await selectedScan(projectPath, args.scanId)
    if (!scan) return JSON.stringify({ projectPath, scan: null, message: "没有有效的扫描结果，请先扫描。" })
    const offset = integer(args.offset, "offset", 0, Number.MAX_SAFE_INTEGER, 0), limit = integer(args.limit, "limit", 1, 100, 20)
    const lookup = new Map(scan.records.map((record) => [record.id, record]))
    const issues = scan.issues.slice(offset, offset + limit).map((issue) => ({ ...issue,
      remove: issue.removeIds.map((id) => ({ ...lookup.get(id)!, category: MEMORY_LABELS[lookup.get(id)!.field] })),
      keep: issue.keepId ? lookup.get(issue.keepId) : undefined,
    }))
    return JSON.stringify({ projectPath, scanId: scan.scanId, scope: scan.scope, scannedAt: scan.scannedAt, recordCount: scan.records.length,
      totalIssues: scan.issues.length, offset, limit, hasMore: offset + limit < scan.issues.length, issues })
  }
  if (name === "apply_memory_cleanup") {
    requireCleanEditor(projectPath)
    const scan = await selectedScan(projectPath, args.scanId), selected = selectedIssues(scan, args.issueIds)
    return JSON.stringify(await maintenanceProgressStore.start({ projectPath, operation: "apply" }, async (task) => {
      requireCleanEditor(projectPath)
      task.report("备份并清理来源记忆")
      const warnings: string[] = []
      const deletedCount = await applyMemoryCleanup(projectPath, scan, selected, (message) => { if (message.startsWith("警告：")) warnings.push(message); task.log(message); task.report(message.startsWith("同步向量") ? "同步向量索引" : "同步来源和派生文档") })
      await refreshLive(projectPath, true)
      return { scanId: scan.scanId, issueCount: selected.length, deletedCount, cleanupId: await lastMemoryCleanupId(projectPath), warnings }
    }, safeError))
  }
  if (name === "keep_memory_cleanup_issues") {
    if (maintenanceProgressStore.active(projectPath)) throw new Error("该项目已有维护任务正在执行，请等待完成。")
    const scan = await selectedScan(projectPath, args.scanId), selected = selectedIssues(scan, args.issueIds)
    for (const issue of selected) await keepMemoryCleanupIssue(projectPath, issue)
    await refreshLive(projectPath, false)
    return JSON.stringify({ projectPath, scanId: scan.scanId, keptIssueIds: selected.map((issue) => issue.id) })
  }
  if (name === "undo_memory_cleanup") {
    requireCleanEditor(projectPath)
    const cleanupId = await lastMemoryCleanupId(projectPath)
    if (!cleanupId) throw new Error("没有可撤销的清理记录")
    if (args.cleanupId !== undefined && requiredText(args.cleanupId, "cleanupId") !== cleanupId) throw new Error("最近一次清理已变化，未撤销其他清理任务。")
    return JSON.stringify(await maintenanceProgressStore.start({ projectPath, operation: "undo" }, async (task) => {
      requireCleanEditor(projectPath)
      if (await lastMemoryCleanupId(projectPath) !== cleanupId) throw new Error("最近一次清理已变化，请重新查询维护状态。")
      task.report("恢复最近一次清理备份")
      const warnings: string[] = []
      await undoLastMemoryCleanup(projectPath, (message) => { task.log(message); if (message.startsWith("警告：")) warnings.push(message) })
      await refreshLive(projectPath, true)
      return { cleanupId, restored: true, warnings }
    }, safeError))
  }
  if (name === "update_maintenance_settings") {
    const patch: Partial<MemoryMaintenanceSettings> = {}
    if (args.enabled !== undefined) { if (typeof args.enabled !== "boolean") throw new Error("enabled 必须是布尔值"); patch.enabled = args.enabled }
    if (args.limits !== undefined) {
      if (!args.limits || typeof args.limits !== "object" || Array.isArray(args.limits)) throw new Error("limits 必须是阈值对象")
      const values = args.limits as Record<string, unknown>
      if (Object.keys(values).some((key) => !MAINTENANCE_KINDS.includes(key as typeof MAINTENANCE_KINDS[number]))) throw new Error("limits 包含未知类别")
      const current = await loadMemoryMaintenanceSettings(projectPath)
      patch.limits = { ...current.limits }
      for (const key of MAINTENANCE_KINDS) if (values[key] !== undefined) patch.limits[key] = integer(values[key], key, 1, 1000000)
    }
    if (args.cognitionChars !== undefined) patch.cognitionChars = integer(args.cognitionChars, "cognitionChars", 100, 100000000)
    if (args.model !== undefined) { const resolved = await resolveScanModel(projectPath, args.model); patch.modelId = resolved.id }
    const settings = await updateMemoryMaintenanceSettings(projectPath, patch)
    await refreshLive(projectPath, false)
    return JSON.stringify({ projectPath, settings })
  }
  throw new Error(`未知的维护工具：${name}`)
}
