import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Lightbulb,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Trash2,
  RotateCcw,
  Clock,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { ChatModelSelector } from "@/components/chat/chat-model-selector"
import { useWikiStore } from "@/stores/wiki-store"
import { getFirstAvailableModelKey, getEffectiveSavedModels } from "@/lib/llm-model-keys"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { normalizePath } from "@/lib/path-utils"
import { resolveDefaultModel, resolveModelConfig } from "@/lib/novel/model-resolver"
import {
  buildOverview,
  type CleanupApplyAction,
  type CleanupIssue,
  type CleanupIssueKind,
} from "@/lib/foreshadowing-cleanup"
import {
  runForeshadowingCleanupScan,
  rebuildForeshadowingFromSnapshots,
  listInvalidSnapshots,
  deleteInvalidSnapshots,
  executeBulkNoiseAndStaleCleanup,
  type ForeshadowingCleanupScanProgress,
  type InvalidSnapshotInfo,
} from "@/lib/foreshadowing-cleanup-runner"
import {
  loadForeshadowingCleanupScanCache,
  saveForeshadowingCleanupScanCache,
  loadForeshadowingCleanupModelPrefs,
  saveForeshadowingCleanupModelPrefs,
  addForeshadowingKeep,
  removeIssuesFromForeshadowingScanCache,
  type ForeshadowingCleanupScanEntry,
} from "@/lib/foreshadowing-cleanup-cache"
import {
  enqueueForeshadowingCleanup,
  cancelForeshadowingCleanupTask,
  retryForeshadowingCleanupTask,
  getForeshadowingCleanupQueue,
  getForeshadowingCleanupProgress,
  getForeshadowingCleanupLogs,
  foreshadowingCleanupIssueKey,
  ensureForeshadowingCleanupQueueActive,
  onForeshadowingCleanupComplete,
  type ForeshadowingCleanupTask,
} from "@/lib/foreshadowing-cleanup-queue"
import {
  loadForeshadowingTracker,
  type Foreshadowing,
} from "@/lib/novel/foreshadowing-tracker"
import { toast } from "@/lib/toast"
import type { WikiProject } from "@/types/wiki"

type ItemLookup = Record<string, Foreshadowing>

function statusLabelZh(status: string): string {
  if (status === "planted") return "已埋设"
  if (status === "advanced") return "推进中"
  if (status === "resolved") return "已回收"
  if (status === "abandoned") return "已放弃"
  return status
}

function itemTitle(item: Foreshadowing | undefined, id: string): string {
  if (!item) return id
  const text = (item.name || item.description || "").trim()
  return text || id
}

function itemSubtitle(item: Foreshadowing | undefined): string {
  if (!item) return ""
  const parts = [
    `第${item.plantedChapter}章埋设`,
    statusLabelZh(item.status),
  ]
  if (item.advancedChapters?.length) {
    parts.push(`推进${item.advancedChapters.length}次`)
  }
  return parts.join(" · ")
}

function itemDetail(item: Foreshadowing | undefined): string {
  if (!item) return ""
  const desc = (item.description || "").trim()
  const name = (item.name || "").trim()
  if (desc && desc !== name) return desc
  return ""
}

function toItemLookup(items: readonly Foreshadowing[]): ItemLookup {
  const map: ItemLookup = {}
  for (const item of items) map[item.id] = item
  return map
}

interface IssueUiEntry {
  issue: CleanupIssue
  canonicalId: string
  skipped: boolean
}

interface ScanState {
  projectId: string | null
  projectPath: string | null
  scanning: boolean
  scanError: string | null
  issues: IssueUiEntry[]
  scanCompleted: boolean
  scannedItemCount: number | null
  currentChapter: number | null
  overview: ReturnType<typeof buildOverview> | null
}

const emptyScanState: ScanState = {
  projectId: null,
  projectPath: null,
  scanning: false,
  scanError: null,
  issues: [],
  scanCompleted: false,
  scannedItemCount: null,
  currentChapter: null,
  overview: null,
}

function normalizeProjectPath(path: string): string {
  return normalizePath(path).replace(/\/+$/, "")
}

function scanBelongsToProject(
  state: Pick<ScanState, "projectId" | "projectPath">,
  project: WikiProject,
): boolean {
  if (state.projectId && state.projectId === project.id) return true
  if (!state.projectPath) return false
  return normalizeProjectPath(state.projectPath) === normalizeProjectPath(project.path)
}

function confidenceRank(c: CleanupIssue["confidence"]): number {
  if (c === "high") return 0
  if (c === "medium") return 1
  return 2
}

function kindOrder(k: CleanupIssueKind): number {
  if (k === "duplicate") return 0
  if (k === "noise") return 1
  return 2
}

export function ForeshadowingCleanupTool() {
  const { t } = useTranslation()
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const providerConfigs = useWikiStore((s) => s.providerConfigs)
  const novelConfig = useWikiStore((s) => s.novelConfig)
  const defaultLlmModel = novelConfig.defaultLlmModel
  const aiChatModel = useWikiStore((s) => s.aiChatModel)
  const project = useWikiStore((s) => s.project)

  const [detectModelId, setDetectModelId] = useState("")
  const [applyModelId, setApplyModelId] = useState("")
  const [modelsHydrated, setModelsHydrated] = useState(false)
  const [scanState, setScanState] = useState<ScanState>(emptyScanState)
  const [scanProgress, setScanProgress] = useState<ForeshadowingCleanupScanProgress | null>(null)
  const [scanLogs, setScanLogs] = useState<string[]>([])
  const [helpOpen, setHelpOpen] = useState(false)
  const [rebuildBusy, setRebuildBusy] = useState(false)
  const [rebuildLogs, setRebuildLogs] = useState<string[]>([])
  const [invalidSnaps, setInvalidSnaps] = useState<InvalidSnapshotInfo[]>([])
  const [invalidBusy, setInvalidBusy] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkLogs, setBulkLogs] = useState<string[]>([])
  const [overview, setOverview] = useState<ReturnType<typeof buildOverview> | null>(null)
  const [itemById, setItemById] = useState<ItemLookup>({})

  const [tasks, setTasks] = useState<readonly ForeshadowingCleanupTask[]>([])
  const [applyProgress, setApplyProgress] = useState<{
    taskId: string
    stage: string
  } | null>(null)
  const [applyLogs, setApplyLogs] = useState<readonly string[]>([])
  const [enqueueingKey, setEnqueueingKey] = useState<string | null>(null)

  const projectReady = !!project
  const hasAvailableModels = useMemo(() => {
    for (const key of Object.keys(providerConfigs)) {
      const config = providerConfigs[key]
      if (key.startsWith("custom-")) {
        if (config.enabled === false) continue
      } else {
        const hasConfig =
          config.enabled === true ||
          Boolean(
            (config.apiKey || config.savedModels?.length) &&
              (config.model || config.savedModels?.length),
          )
        if (!hasConfig) continue
      }
      if (getEffectiveSavedModels(config).length > 0) return true
    }
    return false
  }, [providerConfigs])

  const detectLlmConfig = useMemo(() => {
    if (!detectModelId.trim()) return resolveDefaultModel(llmConfig)
    return resolveModelConfig(detectModelId, llmConfig, providerConfigs)
  }, [detectModelId, llmConfig, providerConfigs])

  const detectLlmReady = hasUsableLlm(detectLlmConfig, providerConfigs)
  const scanning = scanState.scanning

  useEffect(() => {
    if (!project) {
      setModelsHydrated(false)
      setScanState(emptyScanState)
      setOverview(null)
      setItemById({})
      setInvalidSnaps([])
      return
    }
    let cancelled = false
    setModelsHydrated(false)
    void (async () => {
      const [cached, prefs, store, invalid] = await Promise.all([
        loadForeshadowingCleanupScanCache(project.path),
        loadForeshadowingCleanupModelPrefs(project.path),
        loadForeshadowingTracker(project.path),
        listInvalidSnapshots(project.path),
      ])
      if (cancelled) return
      setOverview(buildOverview(store))
      setItemById(toItemLookup(store.items))
      setInvalidSnaps(invalid)
      if (prefs?.detectModelId) setDetectModelId(prefs.detectModelId)
      if (prefs?.applyModelId) setApplyModelId(prefs.applyModelId)
      if (cached && cached.projectId === project.id) {
        setScanState({
          projectId: project.id,
          projectPath: normalizeProjectPath(project.path),
          scanning: false,
          scanError: null,
          issues: cached.issues,
          scanCompleted: true,
          scannedItemCount: cached.scannedItemCount,
          currentChapter: cached.currentChapter,
          overview: buildOverview(store),
        })
      }
      setModelsHydrated(true)
    })()
    return () => {
      cancelled = true
    }
  }, [project?.id, project?.path])

  useEffect(() => {
    if (!modelsHydrated) return
    const preferred = defaultLlmModel.trim() || aiChatModel.trim()
    const fallback = preferred || getFirstAvailableModelKey(providerConfigs)
    setDetectModelId((c) => c.trim() || fallback)
    setApplyModelId((c) => c.trim() || fallback)
  }, [modelsHydrated, defaultLlmModel, aiChatModel, providerConfigs])

  useEffect(() => {
    if (!project || !modelsHydrated) return
    if (!detectModelId.trim() && !applyModelId.trim()) return
    void saveForeshadowingCleanupModelPrefs(project.path, {
      detectModelId: detectModelId.trim() || undefined,
      applyModelId: applyModelId.trim() || undefined,
    }).catch((err) => {
      console.error("[ForeshadowingCleanup] save model prefs failed:", err)
    })
  }, [project?.id, project?.path, modelsHydrated, detectModelId, applyModelId])

  useEffect(() => {
    if (!project) return
    void ensureForeshadowingCleanupQueueActive(project.id, project.path)
    const tick = () => {
      setTasks([...getForeshadowingCleanupQueue()])
      setApplyProgress(getForeshadowingCleanupProgress())
      setApplyLogs([...getForeshadowingCleanupLogs()])
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [project?.id, project?.path])

  useEffect(() => {
    return onForeshadowingCleanupComplete(() => {
      if (!project) return
      void loadForeshadowingTracker(project.path).then((store) => {
        setOverview(buildOverview(store))
        setItemById(toItemLookup(store.items))
      })
      void loadForeshadowingCleanupScanCache(project.path).then((cached) => {
        if (!cached || cached.projectId !== project.id) return
        setScanState((prev) => {
          if (!scanBelongsToProject(prev, project)) return prev
          return { ...prev, issues: cached.issues }
        })
      })
    })
  }, [project?.id, project?.path])

  const handleScan = useCallback(async () => {
    if (!project) return
    if (!detectLlmReady) {
      toast.error(
        t("settings.sections.maintenance.foreshadowing.selectDetectModel", {
          defaultValue: "请先选择检测模型。",
        }),
      )
      return
    }
    setScanLogs([])
    setScanProgress({ stage: "loading", percent: 0 })
    setScanState({
      projectId: project.id,
      projectPath: normalizeProjectPath(project.path),
      scanning: true,
      scanError: null,
      issues: [],
      scanCompleted: false,
      scannedItemCount: null,
      currentChapter: null,
      overview: null,
    })
    try {
      const result = await runForeshadowingCleanupScan(project.path, detectLlmConfig, {
        onProgress: setScanProgress,
        onLog: (msg) =>
          setScanLogs((prev) => [
            ...prev,
            `${new Date().toLocaleTimeString()}  ${msg}`,
          ]),
      })
      const entries: IssueUiEntry[] = result.issues
        .map((issue) => ({
          issue,
          canonicalId: issue.canonicalId || issue.ids[0],
          skipped: false,
        }))
        .sort(
          (a, b) =>
            kindOrder(a.issue.kind) - kindOrder(b.issue.kind) ||
            confidenceRank(a.issue.confidence) - confidenceRank(b.issue.confidence),
        )
      const next: ScanState = {
        projectId: project.id,
        projectPath: normalizeProjectPath(project.path),
        scanning: false,
        scanError: null,
        issues: entries,
        scanCompleted: true,
        scannedItemCount: result.scannedItemCount,
        currentChapter: result.currentChapter,
        overview: result.overview,
      }
      setScanState(next)
      setOverview(result.overview)
      setItemById(toItemLookup(result.store.items))
      await saveForeshadowingCleanupScanCache(project.path, {
        version: 1,
        projectId: project.id,
        scannedAt: Date.now(),
        scannedItemCount: result.scannedItemCount,
        currentChapter: result.currentChapter,
        modelId: detectModelId.trim() || undefined,
        applyModelId: applyModelId.trim() || undefined,
        issues: entries as ForeshadowingCleanupScanEntry[],
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setScanState((prev) => ({
        ...prev,
        scanning: false,
        scanError: message,
        scanCompleted: true,
      }))
      toast.error(message)
    } finally {
      setScanProgress(null)
    }
  }, [
    project,
    detectLlmReady,
    detectLlmConfig,
    detectModelId,
    applyModelId,
    t,
  ])

  const persistIssues = useCallback(
    async (issues: IssueUiEntry[]) => {
      if (!project) return
      await saveForeshadowingCleanupScanCache(project.path, {
        version: 1,
        projectId: project.id,
        scannedAt: Date.now(),
        scannedItemCount: scanState.scannedItemCount,
        currentChapter: scanState.currentChapter,
        modelId: detectModelId.trim() || undefined,
        applyModelId: applyModelId.trim() || undefined,
        issues: issues as ForeshadowingCleanupScanEntry[],
      })
    },
    [project, scanState.scannedItemCount, scanState.currentChapter, detectModelId, applyModelId],
  )

  const handleEnqueue = useCallback(
    async (entry: IssueUiEntry, action?: CleanupApplyAction) => {
      if (!project) return
      const resolvedAction =
        action ??
        (entry.issue.kind === "duplicate"
          ? "merge"
          : entry.issue.kind === "noise"
            ? "delete"
            : "abandon")
      if (resolvedAction === "delete") {
        const ok = window.confirm(
          t("settings.sections.maintenance.foreshadowing.deleteAllConfirm", {
            defaultValue: `将永久删除这 ${entry.issue.ids.length} 条伏笔（先备份）。是否继续？`,
            count: entry.issue.ids.length,
          }),
        )
        if (!ok) return
      }
      const key = foreshadowingCleanupIssueKey(entry.issue) + ":" + resolvedAction
      setEnqueueingKey(key)
      try {
        await enqueueForeshadowingCleanup(project.id, entry.issue, {
          canonicalId:
            resolvedAction === "merge" ? entry.canonicalId : undefined,
          modelId: applyModelId.trim() || undefined,
          action: resolvedAction,
        })
        toast.success(
          t("settings.sections.maintenance.foreshadowing.enqueued", {
            defaultValue: "已加入清理队列",
          }),
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setEnqueueingKey(null)
      }
    },
    [project, applyModelId, t],
  )

  const handleKeep = useCallback(
    async (idx: number) => {
      if (!project) return
      const entry = scanState.issues[idx]
      if (!entry) return
      await addForeshadowingKeep(project.path, entry.issue.ids)
      const next = scanState.issues.map((e, i) =>
        i === idx ? { ...e, skipped: true } : e,
      )
      setScanState((prev) => ({ ...prev, issues: next }))
      await persistIssues(next)
      toast.success(
        t("settings.sections.maintenance.foreshadowing.kept", {
          defaultValue: "已标记为保留，下次扫描将跳过",
        }),
      )
    },
    [project, scanState.issues, persistIssues, t],
  )

  const handleRebuild = useCallback(async () => {
    if (!project) return
    if (
      !window.confirm(
        t("settings.sections.maintenance.foreshadowing.rebuildConfirm", {
          defaultValue:
            "将从全部章节快照重新生成伏笔追踪器（会先备份）。修完解析问题后重建，可自动纠正错误的「未回收」状态。是否继续？",
        }),
      )
    ) {
      return
    }
    setRebuildBusy(true)
    setRebuildLogs([])
    try {
      await rebuildForeshadowingFromSnapshots(project.path, {
        onLog: (msg) =>
          setRebuildLogs((prev) => [
            ...prev,
            `${new Date().toLocaleTimeString()}  ${msg}`,
          ]),
      })
      const store = await loadForeshadowingTracker(project.path)
      setOverview(buildOverview(store))
      setItemById(toItemLookup(store.items))
      toast.success(
        t("settings.sections.maintenance.foreshadowing.rebuildDone", {
          defaultValue: "重建完成",
        }),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setRebuildBusy(false)
    }
  }, [project, t])

  const handleListInvalid = useCallback(async () => {
    if (!project) return
    setInvalidBusy(true)
    try {
      const list = await listInvalidSnapshots(project.path)
      setInvalidSnaps(list)
      if (list.length === 0) {
        toast.success(
          t("settings.sections.maintenance.foreshadowing.noInvalidSnapshots", {
            defaultValue: "未发现异常快照",
          }),
        )
      }
    } finally {
      setInvalidBusy(false)
    }
  }, [project, t])

  const handleDeleteInvalid = useCallback(async () => {
    if (!project || invalidSnaps.length === 0) return
    if (
      !window.confirm(
        t("settings.sections.maintenance.foreshadowing.deleteInvalidConfirm", {
          defaultValue: `将删除 ${invalidSnaps.length} 个 chapterNumber≤0 的异常快照文件。是否继续？`,
          count: invalidSnaps.length,
        }),
      )
    ) {
      return
    }
    setInvalidBusy(true)
    try {
      const n = await deleteInvalidSnapshots(
        project.path,
        invalidSnaps.map((s) => s.path),
        {
          onLog: (msg) =>
            setRebuildLogs((prev) => [
              ...prev,
              `${new Date().toLocaleTimeString()}  ${msg}`,
            ]),
        },
      )
      setInvalidSnaps([])
      toast.success(
        t("settings.sections.maintenance.foreshadowing.deleteInvalidDone", {
          defaultValue: `已删除 ${n} 个异常快照`,
          count: n,
        }),
      )
    } finally {
      setInvalidBusy(false)
    }
  }, [project, invalidSnaps, t])

  const visibleIssues = useMemo(
    () => scanState.issues.filter((e) => !e.skipped),
    [scanState.issues],
  )

  const noiseIssues = useMemo(
    () => visibleIssues.filter((e) => e.issue.kind === "noise"),
    [visibleIssues],
  )
  const staleIssues = useMemo(
    () => visibleIssues.filter((e) => e.issue.kind === "stale"),
    [visibleIssues],
  )

  const handleBulkCleanNoiseAndStale = useCallback(
    async (mode: "noise" | "stale" | "both") => {
      if (!project) return
      const noise = mode === "stale" ? [] : noiseIssues
      const stale = mode === "noise" ? [] : staleIssues
      if (noise.length === 0 && stale.length === 0) return

      const deleteIds = noise.flatMap((e) => e.issue.ids)
      const abandonIds = stale.flatMap((e) => e.issue.ids)
      const ok = window.confirm(
        t("settings.sections.maintenance.foreshadowing.bulkCleanConfirm", {
          defaultValue:
            "将删除噪声 {{noise}} 条，并把失效 {{stale}} 条标记为已放弃（先备份，一次写入）。是否继续？",
          noise: deleteIds.length,
          stale: abandonIds.length,
        }),
      )
      if (!ok) return

      setBulkBusy(true)
      setBulkLogs([])
      try {
        const result = await executeBulkNoiseAndStaleCleanup(project.path, {
          deleteIds,
          abandonIds,
          currentChapter: scanState.currentChapter ?? undefined,
          onLog: (msg) =>
            setBulkLogs((prev) => [
              ...prev,
              `${new Date().toLocaleTimeString()}  ${msg}`,
            ]),
        })
        const cleared = [...noise, ...stale].map((e) => e.issue)
        await removeIssuesFromForeshadowingScanCache(project.path, cleared)
        setScanState((prev) => ({
          ...prev,
          issues: prev.issues.filter(
            (e) =>
              !(
                (mode !== "stale" && e.issue.kind === "noise" && !e.skipped) ||
                (mode !== "noise" && e.issue.kind === "stale" && !e.skipped)
              ),
          ),
        }))
        const store = await loadForeshadowingTracker(project.path)
        setOverview(buildOverview(store))
        setItemById(toItemLookup(store.items))
        toast.success(
          t("settings.sections.maintenance.foreshadowing.bulkCleanDone", {
            defaultValue: "已删除 {{deleted}} 条噪声，放弃 {{abandoned}} 条失效",
            deleted: result.deleted,
            abandoned: result.abandoned,
          }),
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setBulkBusy(false)
      }
    },
    [project, noiseIssues, staleIssues, scanState.currentChapter, t],
  )

  const pendingPositionByTaskId = useMemo(() => {
    const pending = tasks
      .filter((t) => t.status === "pending")
      .sort((a, b) => a.addedAt - b.addedAt)
    const map = new Map<string, number>()
    pending.forEach((t, i) => map.set(t.id, i + 1))
    return map
  }, [tasks])

  const displayOverview = overview || scanState.overview

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold">
          {t("settings.sections.maintenance.foreshadowing.title", {
            defaultValue: "清理伏笔",
          })}
        </h3>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("settings.sections.maintenance.foreshadowing.description", {
          defaultValue:
            "扫描伏笔追踪器，找出重复线索、噪声条目（状态播报/剧情预告）和长期失效伏笔。每条需你确认后才会合并、删除或标记为已放弃。建议先「从快照重建」再扫描。",
        })}
      </p>

      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setHelpOpen((v) => !v)}
      >
        <HelpCircle className="h-3.5 w-3.5" />
        <span>
          {t("settings.sections.maintenance.foreshadowing.helpTitle", {
            defaultValue: "三类问题分别怎么处理？",
          })}
        </span>
        {helpOpen ? (
          <ChevronUp className="ml-auto h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="ml-auto h-3.5 w-3.5" />
        )}
      </button>
      {helpOpen && (
        <div className="space-y-1.5 rounded border border-border/50 bg-background/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            <strong>重复</strong>：同一线索被反复「新增」→ 合并为一条，保留最早埋设与最长说明。
          </p>
          <p>
            <strong>噪声</strong>：不是伏笔的状态播报／剧情预告 → 直接删除。
          </p>
          <p>
            <strong>失效</strong>：真伏笔但故事方向已变 → 标记为「已放弃」，保留记录但不进写作上下文。
          </p>
          <p>
            若近期修过摄取解析，先点「从快照重建」：可把大量假「未回收」自动纠正为「已回收」。
          </p>
        </div>
      )}

      {!projectReady && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("settings.sections.maintenance.noProject", {
            defaultValue: "请先打开一个项目。",
          })}
        </p>
      )}

      {projectReady && displayOverview && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 rounded border border-border/50 bg-background/50 px-3 py-2 text-[11px] text-muted-foreground">
          <span>
            {t("settings.sections.maintenance.foreshadowing.overviewTotal", {
              defaultValue: "总计 {{n}}",
              n: displayOverview.total,
            })}
          </span>
          <span>
            {t("settings.sections.maintenance.foreshadowing.overviewActive", {
              defaultValue: "活跃 {{n}}",
              n: displayOverview.active,
            })}
          </span>
          <span>
            {t("settings.sections.maintenance.foreshadowing.overviewResolved", {
              defaultValue: "已回收 {{n}}",
              n: displayOverview.resolved,
            })}
          </span>
          <span>
            {t("settings.sections.maintenance.foreshadowing.overviewAbandoned", {
              defaultValue: "已放弃 {{n}}",
              n: displayOverview.abandoned,
            })}
          </span>
          <span>
            {t("settings.sections.maintenance.foreshadowing.overviewAvg", {
              defaultValue: "平均 {{n}} 条/章",
              n: displayOverview.avgPerChapter,
            })}
          </span>
        </div>
      )}

      {projectReady && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={rebuildBusy}
            onClick={() => void handleRebuild()}
          >
            {rebuildBusy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {t("settings.sections.maintenance.foreshadowing.rebuildButton", {
              defaultValue: "从快照重建追踪器",
            })}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={invalidBusy}
            onClick={() => void handleListInvalid()}
          >
            {t("settings.sections.maintenance.foreshadowing.scanInvalidButton", {
              defaultValue: "扫描异常快照",
            })}
          </Button>
          {invalidSnaps.length > 0 && (
            <Button
              size="sm"
              variant="destructive"
              disabled={invalidBusy}
              onClick={() => void handleDeleteInvalid()}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {t("settings.sections.maintenance.foreshadowing.deleteInvalidButton", {
                defaultValue: "删除 {{n}} 个异常快照",
                n: invalidSnaps.length,
              })}
            </Button>
          )}
        </div>
      )}

      {invalidSnaps.length > 0 && (
        <ul className="max-h-28 overflow-auto rounded border border-border/50 bg-background/50 px-2 py-1.5 text-[11px] text-muted-foreground">
          {invalidSnaps.map((s) => (
            <li key={s.path}>
              {s.fileName}（chapterNumber={s.chapterNumber}，伏笔变化 {s.foreshadowingChangeCount}）
            </li>
          ))}
        </ul>
      )}

      {(rebuildLogs.length > 0 || rebuildBusy) && (
        <ProcessLog
          title={t("settings.sections.maintenance.foreshadowing.rebuildLogTitle", {
            defaultValue: "重建 / 清理日志",
          })}
          lines={rebuildLogs}
          live={rebuildBusy}
        />
      )}

      {projectReady && hasAvailableModels && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">
              {t("settings.sections.maintenance.foreshadowing.detectModelLabel", {
                defaultValue: "检测模型",
              })}
            </Label>
            <ChatModelSelector
              value={detectModelId}
              onChange={setDetectModelId}
              disabled={scanning}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              {t("settings.sections.maintenance.foreshadowing.applyModelLabel", {
                defaultValue: "清理模型（可选，执行阶段不用 LLM）",
              })}
            </Label>
            <ChatModelSelector
              value={applyModelId}
              onChange={setApplyModelId}
              disabled={scanning}
            />
          </div>
        </div>
      )}

      {projectReady && (
        <Button
          size="sm"
          disabled={!hasAvailableModels || !detectLlmReady || scanning}
          onClick={() => void handleScan()}
        >
          {scanning ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              {t("settings.sections.maintenance.foreshadowing.scanning", {
                defaultValue: "扫描中...",
              })}
            </>
          ) : (
            t("settings.sections.maintenance.foreshadowing.scanButton", {
              defaultValue: "开始扫描伏笔问题",
            })
          )}
        </Button>
      )}

      {scanning && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {scanProgress?.stage === "loading"
                ? t("settings.sections.maintenance.foreshadowing.scanStageLoading", {
                    defaultValue: "正在读取伏笔追踪器…",
                  })
                : scanProgress?.batch
                  ? t("settings.sections.maintenance.foreshadowing.scanBatchProgress", {
                      defaultValue: "正在分析第 {{current}}/{{total}} 批…",
                      current: scanProgress.batch.current,
                      total: scanProgress.batch.total,
                    })
                  : t("settings.sections.maintenance.foreshadowing.scanStageDetecting", {
                      defaultValue: "正在调用模型分析…",
                    })}
            </span>
            <span className="tabular-nums shrink-0">
              {Math.min(100, Math.max(0, scanProgress?.percent ?? 0))}%
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.max(0, scanProgress?.percent ?? 0))}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{
                width: `${Math.min(100, Math.max(0, scanProgress?.percent ?? 0))}%`,
              }}
            />
          </div>
          {scanProgress?.batch && (
            <p className="text-[11px] text-muted-foreground">
              {t("settings.sections.maintenance.foreshadowing.scanBatchDetail", {
                defaultValue: "本批 {{batchSize}} 条 · 活跃共 {{activeCount}} 条（分批调用模型，较慢属正常）",
                batchSize: scanProgress.batch.batchSize,
                activeCount: scanProgress.batch.activeCount,
              })}
            </p>
          )}
        </div>
      )}

      {scanLogs.length > 0 && (
        <ProcessLog
          title={t("settings.sections.maintenance.foreshadowing.processLogTitle", {
            defaultValue: "扫描过程日志",
          })}
          lines={scanLogs}
          live={scanning}
        />
      )}

      {scanState.scanError && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <XCircle className="h-3.5 w-3.5" />
          {scanState.scanError}
        </p>
      )}

      {scanState.scanCompleted && !scanState.scanError && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {visibleIssues.length > 0
              ? t("settings.sections.maintenance.foreshadowing.issuesFound", {
                  defaultValue: "发现 {{count}} 个问题候选，请确认后处理。",
                  count: visibleIssues.length,
                })
              : t("settings.sections.maintenance.foreshadowing.noneFound", {
                  defaultValue: "未发现明显问题。",
                })}
          </p>
          {(noiseIssues.length > 0 || staleIssues.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {noiseIssues.length > 0 && staleIssues.length > 0 && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={bulkBusy}
                  onClick={() => void handleBulkCleanNoiseAndStale("both")}
                >
                  {bulkBusy ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {t("settings.sections.maintenance.foreshadowing.bulkCleanBoth", {
                    defaultValue: "一键清理噪声与失效（删 {{noise}} / 弃 {{stale}}）",
                    noise: noiseIssues.length,
                    stale: staleIssues.length,
                  })}
                </Button>
              )}
              {noiseIssues.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={bulkBusy}
                  onClick={() => void handleBulkCleanNoiseAndStale("noise")}
                >
                  {t("settings.sections.maintenance.foreshadowing.bulkCleanNoise", {
                    defaultValue: "一键删除全部噪声（{{n}}）",
                    n: noiseIssues.length,
                  })}
                </Button>
              )}
              {staleIssues.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={bulkBusy}
                  onClick={() => void handleBulkCleanNoiseAndStale("stale")}
                >
                  {t("settings.sections.maintenance.foreshadowing.bulkCleanStale", {
                    defaultValue: "一键放弃全部失效（{{n}}）",
                    n: staleIssues.length,
                  })}
                </Button>
              )}
            </div>
          )}
          {(bulkLogs.length > 0 || bulkBusy) && (
            <ProcessLog
              title={t("settings.sections.maintenance.foreshadowing.bulkLogTitle", {
                defaultValue: "一键清理日志",
              })}
              lines={bulkLogs}
              live={bulkBusy}
            />
          )}
        </div>
      )}

      {tasks.length > 0 && (
        <CleanupQueuePanel
          tasks={tasks}
          itemById={itemById}
          applyProgress={applyProgress}
          pendingPositionByTaskId={pendingPositionByTaskId}
          onCancel={(id) => void cancelForeshadowingCleanupTask(id)}
          onRetry={(id) => void retryForeshadowingCleanupTask(id)}
        />
      )}

      {applyLogs.length > 0 && (
        <ProcessLog
          title={t("settings.sections.maintenance.foreshadowing.applyLogTitle", {
            defaultValue: "清理过程日志",
          })}
          lines={applyLogs}
          live={!!applyProgress}
        />
      )}

      {visibleIssues.map((entry) => {
        const key = foreshadowingCleanupIssueKey(entry.issue)
        const idx = scanState.issues.findIndex(
          (e) => foreshadowingCleanupIssueKey(e.issue) === key,
        )
        const task = tasks.find(
          (tk) => foreshadowingCleanupIssueKey(tk.issue) === key,
        )
        return (
          <IssueCard
            key={key}
            entry={entry}
            itemById={itemById}
            task={task}
            enqueueing={
              enqueueingKey === key ||
              enqueueingKey === `${key}:merge` ||
              enqueueingKey === `${key}:delete` ||
              enqueueingKey === `${key}:abandon`
            }
            pendingPosition={
              task && task.status === "pending"
                ? pendingPositionByTaskId.get(task.id) ?? 0
                : 0
            }
            applyProgress={applyProgress}
            onCanonicalChange={(id) => {
              setScanState((prev) => {
                const issues = prev.issues.map((e, i) =>
                  i === idx ? { ...e, canonicalId: id } : e,
                )
                void persistIssues(issues)
                return { ...prev, issues }
              })
            }}
            onEnqueue={() => void handleEnqueue(entry)}
            onDeleteAll={
              entry.issue.kind === "duplicate"
                ? () => void handleEnqueue(entry, "delete")
                : undefined
            }
            onKeep={() => void handleKeep(idx)}
            onCancel={() => task && void cancelForeshadowingCleanupTask(task.id)}
            onRetry={() => task && void retryForeshadowingCleanupTask(task.id)}
          />
        )
      })}
    </div>
  )
}

function ProcessLog({
  title,
  lines,
  live,
}: {
  title: string
  lines: readonly string[]
  live?: boolean
}) {
  return (
    <div className="space-y-1.5 rounded border border-border/60 bg-background/80 px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {live ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        <span>{title}</span>
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground/90">
        {lines.length > 0 ? lines.join("\n") : "…"}
      </pre>
    </div>
  )
}

function CleanupQueuePanel({
  tasks,
  itemById,
  applyProgress,
  pendingPositionByTaskId,
  onCancel,
  onRetry,
}: {
  tasks: readonly ForeshadowingCleanupTask[]
  itemById: ItemLookup
  applyProgress: { taskId: string; stage: string } | null
  pendingPositionByTaskId: Map<string, number>
  onCancel: (id: string) => void
  onRetry: (id: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-3">
      <h4 className="text-xs font-semibold">
        {t("settings.sections.maintenance.foreshadowing.queueTitle", {
          defaultValue: "清理任务队列",
        })}
      </h4>
      <ul className="space-y-1.5">
        {tasks.map((task) => {
          const labelIds =
            task.issue.kind === "duplicate"
              ? task.canonicalId || task.issue.ids[0]
              : task.issue.ids[0]
          const title = itemTitle(itemById[labelIds], labelIds)
          return (
          <li
            key={task.id}
            className="flex items-center gap-2 rounded border border-border/50 bg-background/70 px-2 py-1.5 text-[11px]"
          >
            {task.status === "processing" ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-500" />
            ) : task.status === "failed" ? (
              <XCircle className="h-3 w-3 shrink-0 text-destructive" />
            ) : (
              <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate">
              [{kindLabel(task.issue.kind, t)}
              {task.action === "delete" ? "/删" : ""}] {title}
              {task.issue.kind === "duplicate" && task.issue.ids.length > 1
                ? `（${task.issue.ids.length} 条）`
                : ""}
              {task.status === "processing" && applyProgress?.taskId === task.id
                ? ` · ${applyProgress.stage}`
                : task.status === "pending"
                  ? ` · #${pendingPositionByTaskId.get(task.id) ?? "?"}`
                  : task.status === "failed"
                    ? ` · ${task.error || "failed"}`
                    : ""}
            </span>
            {task.status === "failed" && (
              <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => onRetry(task.id)}>
                <RotateCcw className="h-3 w-3" />
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => onCancel(task.id)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </li>
          )
        })}
      </ul>
    </div>
  )
}

function kindLabel(kind: CleanupIssueKind, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (kind === "duplicate") {
    return t("settings.sections.maintenance.foreshadowing.kindDuplicate", {
      defaultValue: "重复",
    })
  }
  if (kind === "noise") {
    return t("settings.sections.maintenance.foreshadowing.kindNoise", {
      defaultValue: "噪声",
    })
  }
  return t("settings.sections.maintenance.foreshadowing.kindStale", {
    defaultValue: "失效",
  })
}

function actionLabel(kind: CleanupIssueKind, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (kind === "duplicate") {
    return t("settings.sections.maintenance.foreshadowing.actionMerge", {
      defaultValue: "合并",
    })
  }
  if (kind === "noise") {
    return t("settings.sections.maintenance.foreshadowing.actionDelete", {
      defaultValue: "删除",
    })
  }
  return t("settings.sections.maintenance.foreshadowing.actionAbandon", {
    defaultValue: "标记放弃",
  })
}

function IssueCard({
  entry,
  itemById,
  task,
  enqueueing,
  pendingPosition,
  applyProgress,
  onCanonicalChange,
  onEnqueue,
  onDeleteAll,
  onKeep,
  onCancel,
  onRetry,
}: {
  entry: IssueUiEntry
  itemById: ItemLookup
  task?: ForeshadowingCleanupTask
  enqueueing: boolean
  pendingPosition: number
  applyProgress: { taskId: string; stage: string } | null
  onCanonicalChange: (id: string) => void
  onEnqueue: () => void
  onDeleteAll?: () => void
  onKeep: () => void
  onCancel: () => void
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const { issue } = entry
  const busy = task?.status === "processing" || enqueueing
  const canonicalTitle = itemTitle(itemById[entry.canonicalId], entry.canonicalId)

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-background/70 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
              {kindLabel(issue.kind, t)}
            </span>
            <span className="rounded bg-muted/60 px-1.5 py-0.5 text-muted-foreground">
              {issue.confidence}
            </span>
            {issue.confidence === "low" && (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            )}
          </div>
          <p className="text-xs text-muted-foreground">{issue.reason}</p>
          {issue.kind === "duplicate" && (
            <p className="text-[11px] text-muted-foreground">
              {t("settings.sections.maintenance.foreshadowing.canonicalHint", {
                defaultValue: "选中要保留的主条目，其余会合并进它。",
              })}
            </p>
          )}
        </div>
        {task?.status === "processing" && applyProgress?.taskId === task.id ? (
          <span className="flex items-center gap-1 text-[11px] text-blue-600">
            <Loader2 className="h-3 w-3 animate-spin" />
            {applyProgress.stage}
          </span>
        ) : task?.status === "pending" ? (
          <span className="text-[11px] text-muted-foreground">
            #{pendingPosition}
          </span>
        ) : task?.status === "failed" ? (
          <span className="flex items-center gap-1 text-[11px] text-destructive">
            <XCircle className="h-3 w-3" />
            failed
          </span>
        ) : null}
      </div>

      <ul className="space-y-2 text-xs">
        {issue.ids.map((id) => {
          const item = itemById[id]
          const title = itemTitle(item, id)
          const subtitle = itemSubtitle(item)
          const detail = itemDetail(item)
          const selected = entry.canonicalId === id
          const body = (
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <span className="font-medium text-foreground">{title}</span>
                <code className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                  {id}
                </code>
              </div>
              {subtitle && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
              )}
              {detail && (
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/90">
                  {detail}
                </p>
              )}
              {!item && (
                <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                  {t("settings.sections.maintenance.foreshadowing.itemMissing", {
                    defaultValue: "追踪器中已找不到这条（可能已处理）",
                  })}
                </p>
              )}
            </div>
          )

          return (
            <li
              key={id}
              className={`rounded border px-2 py-1.5 ${
                issue.kind === "duplicate" && selected
                  ? "border-primary/40 bg-primary/5"
                  : "border-border/50 bg-muted/20"
              }`}
            >
              {issue.kind === "duplicate" ? (
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="radio"
                    className="mt-1"
                    name={`canon-${foreshadowingCleanupIssueKey(issue)}`}
                    checked={selected}
                    onChange={() => onCanonicalChange(id)}
                    disabled={busy || !!task}
                  />
                  {body}
                </label>
              ) : (
                body
              )}
            </li>
          )
        })}
      </ul>

      <div className="flex flex-wrap gap-2">
        {!task && (
          <>
            <Button size="sm" disabled={busy} onClick={onEnqueue}>
              {enqueueing ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1 h-3 w-3" />
              )}
              {actionLabel(issue.kind, t)}
              {issue.kind === "duplicate" ? ` → ${canonicalTitle}` : ""}
            </Button>
            {onDeleteAll && (
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={onDeleteAll}
              >
                <Trash2 className="mr-1 h-3 w-3" />
                {t("settings.sections.maintenance.foreshadowing.actionDeleteAll", {
                  defaultValue: "全部删除",
                })}
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={onKeep}>
              {t("settings.sections.maintenance.foreshadowing.keepButton", {
                defaultValue: "保留",
              })}
            </Button>
          </>
        )}
        {task?.status === "failed" && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RotateCcw className="mr-1 h-3 w-3" />
            {t("settings.sections.maintenance.foreshadowing.retry", {
              defaultValue: "重试",
            })}
          </Button>
        )}
        {task && task.status !== "done" && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("settings.sections.maintenance.foreshadowing.cancel", {
              defaultValue: "取消",
            })}
          </Button>
        )}
      </div>
      {task?.error && (
        <p className="text-[11px] text-destructive">{task.error}</p>
      )}
    </div>
  )
}
