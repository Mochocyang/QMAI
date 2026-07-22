import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Wrench,
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
  BookOpen,
  Users,
  Lightbulb,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { ChatModelSelector } from "@/components/chat/chat-model-selector"
import { useWikiStore } from "@/stores/wiki-store"
import { getFirstAvailableModelKey, getEffectiveSavedModels } from "@/lib/llm-model-keys"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { normalizePath } from "@/lib/path-utils"
import { resolveDefaultModel, resolveModelConfig } from "@/lib/novel/model-resolver"
import { runDuplicateDetection, type DedupScanStage } from "@/lib/dedup-runner"
import { addNotDuplicate } from "@/lib/dedup-storage"
import {
  loadDedupScanCache,
  saveDedupScanCache,
  type DedupScanCacheEntry,
} from "@/lib/dedup-scan-cache"
import {
  loadDedupModelPrefs,
  saveDedupModelPrefs,
} from "@/lib/dedup-model-prefs"
import { registerDedupScanSessionApi } from "@/lib/dedup-scan-session"
import { toast } from "@/lib/toast"
import { fileExists } from "@/commands/fs"
import {
  enqueueMerge,
  cancelTask,
  retryTask,
  getQueue,
  getMergeProgress,
  getMergeLogs,
  groupKey,
  ensureQueueActive,
  onDedupMergeComplete,
  type DedupTask,
} from "@/lib/dedup-queue"
import type { DedupMergeStage } from "@/lib/dedup-runner"
import type { WikiProject } from "@/types/wiki"
import type { DuplicateGroup } from "@/lib/dedup"

function confidenceRank(confidence: DuplicateGroup["confidence"]): number {
  switch (confidence) {
    case "high":
      return 0
    case "medium":
      return 1
    case "low":
      return 2
  }
}

function sortGroupEntriesByConfidence(entries: GroupUiEntry[]): GroupUiEntry[] {
  return [...entries].sort(
    (a, b) =>
      confidenceRank(a.group.confidence) - confidenceRank(b.group.confidence),
  )
}

interface GroupUiEntry {
  group: DuplicateGroup
  canonicalSlug: string
  /** Becomes true when the user marks the group as "not duplicates"
   *  in this session — the card transitions to skipped state. */
  skipped: boolean
}

interface MaintenanceScanState {
  projectId: string | null
  projectPath: string | null
  scanning: boolean
  scanError: string | null
  groups: GroupUiEntry[]
  scanCompleted: boolean
  scannedPageCount: number | null
}

const emptyScanState: MaintenanceScanState = {
  projectId: null,
  projectPath: null,
  scanning: false,
  scanError: null,
  groups: [],
  scanCompleted: false,
  scannedPageCount: null,
}

function normalizeProjectPath(path: string): string {
  return normalizePath(path).replace(/\/+$/, "")
}

function scanStateBelongsToProject(
  state: Pick<MaintenanceScanState, "projectId" | "projectPath">,
  project: WikiProject,
): boolean {
  if (state.projectId && state.projectId === project.id) return true
  if (!state.projectPath) return false
  return normalizeProjectPath(state.projectPath) === normalizeProjectPath(project.path)
}

function setSharedScanState(patch: Partial<MaintenanceScanState>): void {
  const normalizedPatch = patch.projectPath
    ? { ...patch, projectPath: normalizeProjectPath(patch.projectPath) }
    : patch
  sharedScanState = { ...sharedScanState, ...normalizedPatch }
  for (const listener of scanListeners) listener(sharedScanState)
}

function replaceSharedScanState(state: MaintenanceScanState): void {
  sharedScanState = {
    ...state,
    projectPath: state.projectPath ? normalizeProjectPath(state.projectPath) : state.projectPath,
  }
  for (const listener of scanListeners) listener(sharedScanState)
}

function toScanCache(
  state: MaintenanceScanState,
  projectId: string,
  detectModelId: string,
  mergeModelId: string,
): Parameters<typeof saveDedupScanCache>[1] {
  return {
    version: 1,
    projectId,
    scannedAt: Date.now(),
    scannedPageCount: state.scannedPageCount,
    modelId: detectModelId.trim() || undefined,
    mergeModelId: mergeModelId.trim() || undefined,
    groups: state.groups as DedupScanCacheEntry[],
  }
}

let sharedScanState: MaintenanceScanState = emptyScanState
const scanListeners = new Set<(state: MaintenanceScanState) => void>()

function subscribeScanState(listener: (state: MaintenanceScanState) => void): () => void {
  scanListeners.add(listener)
  listener(sharedScanState)
  return () => scanListeners.delete(listener)
}

/** Match a card to its task in the queue (if any) by slug-set. */
function findTaskForGroup(
  tasks: readonly DedupTask[],
  slugs: readonly string[],
): DedupTask | undefined {
  const key = groupKey(slugs)
  return tasks.find((t) => groupKey(t.group.slugs) === key)
}

export function MaintenanceSection() {
  const { t } = useTranslation()
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const providerConfigs = useWikiStore((s) => s.providerConfigs)
  const novelConfig = useWikiStore((s) => s.novelConfig)
  const defaultLlmModel = novelConfig.defaultLlmModel
  const aiChatModel = useWikiStore((s) => s.aiChatModel)
  const project = useWikiStore((s) => s.project)

  const [detectModelId, setDetectModelId] = useState("")
  const [mergeModelId, setMergeModelId] = useState("")
  const [modelsHydrated, setModelsHydrated] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [scanStage, setScanStage] = useState<DedupScanStage | null>(null)
  const [scanLogs, setScanLogs] = useState<string[]>([])
  const [scanState, setScanState] = useState<MaintenanceScanState>(sharedScanState)
  const [localScanState, setLocalScanState] = useState<MaintenanceScanState | null>(null)

  useEffect(() => subscribeScanState(setScanState), [])

  useEffect(() => {
    if (!project) {
      setLocalScanState(null)
      setModelsHydrated(false)
      return
    }
    let cancelled = false
    setModelsHydrated(false)
    void (async () => {
      const [cached, prefs] = await Promise.all([
        loadDedupScanCache(project.path),
        loadDedupModelPrefs(project.path),
      ])
      if (cancelled) return

      const detectFromDisk =
        prefs?.detectModelId?.trim() ||
        cached?.modelId?.trim() ||
        ""
      const mergeFromDisk =
        prefs?.mergeModelId?.trim() ||
        cached?.mergeModelId?.trim() ||
        ""
      // Prefer disk prefs on project open (overwrite empty / stale session).
      if (detectFromDisk) setDetectModelId(detectFromDisk)
      if (mergeFromDisk) setMergeModelId(mergeFromDisk)

      // Only keep the in-memory session while a scan is actively running.
      // Otherwise prefer disk cache — it is updated by the merge queue even
      // when this section was unmounted, so remount must not revive stale groups.
      if (
        scanStateBelongsToProject(sharedScanState, project) &&
        sharedScanState.scanning
      ) {
        setLocalScanState({ ...sharedScanState })
        setModelsHydrated(true)
        return
      }
      if (!cached || cached.projectId !== project.id) {
        if (
          scanStateBelongsToProject(sharedScanState, project) &&
          sharedScanState.scanCompleted
        ) {
          setLocalScanState({ ...sharedScanState })
        } else {
          setLocalScanState(null)
        }
        setModelsHydrated(true)
        return
      }
      const hydrated: MaintenanceScanState = {
        projectId: project.id,
        projectPath: normalizeProjectPath(project.path),
        scanning: false,
        scanError: null,
        groups: cached.groups,
        scanCompleted: true,
        scannedPageCount: cached.scannedPageCount,
      }
      replaceSharedScanState(hydrated)
      setLocalScanState(hydrated)
      setModelsHydrated(true)
    })()
    return () => {
      cancelled = true
    }
  }, [project?.id, project?.path])

  useEffect(() => {
    if (!project) {
      setIsScanning(false)
      return
    }
    const activeState =
      localScanState && scanStateBelongsToProject(localScanState, project)
        ? localScanState
        : scanStateBelongsToProject(scanState, project)
          ? scanState
          : null
    setIsScanning(!!activeState?.scanning)
  }, [project, localScanState, scanState])

  useEffect(() => {
    if (!modelsHydrated) return
    const preferred = defaultLlmModel.trim() || aiChatModel.trim()
    const fallback = preferred || getFirstAvailableModelKey(providerConfigs)
    setDetectModelId((current) => current.trim() || fallback)
    setMergeModelId((current) => current.trim() || fallback)
  }, [modelsHydrated, defaultLlmModel, aiChatModel, providerConfigs])

  // Persist model choices per project after initial hydrate.
  useEffect(() => {
    if (!project || !modelsHydrated) return
    if (!detectModelId.trim() && !mergeModelId.trim()) return
    void saveDedupModelPrefs(project.path, {
      detectModelId: detectModelId.trim() || undefined,
      mergeModelId: mergeModelId.trim() || undefined,
    }).catch((err) => {
      console.error("[Maintenance] save model prefs failed:", err)
    })
  }, [project?.id, project?.path, modelsHydrated, detectModelId, mergeModelId])

  const hasAvailableModels = useMemo(() => {
    for (const key of Object.keys(providerConfigs)) {
      const config = providerConfigs[key]
      if (key.startsWith("custom-")) {
        if (config.enabled === false) continue
      } else {
        // 内置预设：已启用，或有有效配置（apiKey + model/savedModels）
        const hasConfig = config.enabled === true
          || Boolean((config.apiKey || config.savedModels?.length) && (config.model || config.savedModels?.length))
        if (!hasConfig) continue
      }
      if (getEffectiveSavedModels(config).length > 0) {
        return true
      }
    }
    return false
  }, [providerConfigs])

  // Poll the queue at 1Hz so the UI reflects pending → processing →
  // failed transitions and cross-window queue activity (e.g. a merge
  // that completed while the user was on a different settings tab).
  // Same pattern activity-panel uses for ingest-queue.
  const [tasks, setTasks] = useState<readonly DedupTask[]>([])
  const [mergeProgress, setMergeProgress] = useState<{
    taskId: string
    stage: DedupMergeStage
  } | null>(null)
  const [mergeLogs, setMergeLogs] = useState<readonly string[]>([])
  const [enqueueingKey, setEnqueueingKey] = useState<string | null>(null)
  const [mergeErrors, setMergeErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!project) {
      setTasks([])
      setMergeProgress(null)
      setMergeLogs([])
      return
    }
    let cancelled = false
    void ensureQueueActive(project.id, project.path)
      .then(() => {
        if (!cancelled) {
          setTasks([...getQueue()])
          setMergeProgress(getMergeProgress())
          setMergeLogs([...getMergeLogs()])
        }
      })
      .catch((err) => {
        console.error("[Maintenance] ensureQueueActive failed:", err)
      })
    const id = setInterval(() => {
      setTasks([...getQueue()])
      setMergeProgress(getMergeProgress())
      setMergeLogs([...getMergeLogs()])
    }, 500)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [project?.id, project?.path])

  const effectiveDetectConfig = useMemo(
    () =>
      detectModelId.trim()
        ? resolveModelConfig(detectModelId, llmConfig, providerConfigs)
        : resolveDefaultModel(llmConfig),
    [detectModelId, llmConfig, providerConfigs],
  )
  const effectiveMergeConfig = useMemo(
    () =>
      mergeModelId.trim()
        ? resolveModelConfig(mergeModelId, llmConfig, providerConfigs)
        : detectModelId.trim()
          ? resolveModelConfig(detectModelId, llmConfig, providerConfigs)
          : resolveDefaultModel(llmConfig),
    [mergeModelId, detectModelId, llmConfig, providerConfigs],
  )
  const detectLlmReady = hasUsableLlm(effectiveDetectConfig, providerConfigs)
  const mergeLlmReady = hasUsableLlm(effectiveMergeConfig, providerConfigs)
  const llmReady = detectLlmReady
  const projectReady = !!project
  const activeScanState = useMemo(() => {
    if (!project) return emptyScanState
    if (localScanState && scanStateBelongsToProject(localScanState, project)) {
      return localScanState
    }
    if (scanStateBelongsToProject(scanState, project)) {
      return scanState
    }
    return emptyScanState
  }, [project, localScanState, scanState])
  const scanning = isScanning || activeScanState.scanning
  const { scanError, groups, scanCompleted, scannedPageCount } = activeScanState

  const applyScanState = useCallback(
    (patch: Partial<MaintenanceScanState>, options?: { persist?: boolean }) => {
      setSharedScanState(patch)
      const next = { ...sharedScanState }
      setLocalScanState({ ...next })
      if (
        options?.persist !== false &&
        project &&
        next.projectId === project.id &&
        next.scanCompleted &&
        !next.scanning
      ) {
        void saveDedupScanCache(
          project.path,
          toScanCache(next, project.id, detectModelId, mergeModelId),
        ).catch((err) => {
          console.error("[Maintenance] save scan cache failed:", err)
        })
      }
    },
    [project, detectModelId, mergeModelId],
  )

  const removeMergedGroup = useCallback(
    (slugs: readonly string[]) => {
      const key = groupKey(slugs)
      const active = useWikiStore.getState().project
      // Drop by slug-set whenever present. Do not gate on belongs-check —
      // that early-return left stale cards after merge (second merge 404s).
      const remaining = sharedScanState.groups.filter((g) => groupKey(g.group.slugs) !== key)
      if (remaining.length === sharedScanState.groups.length) return
      applyScanState({
        groups: remaining,
        ...(active && !sharedScanState.projectId
          ? {
              projectId: active.id,
              projectPath: normalizeProjectPath(active.path),
            }
          : {}),
      })
    },
    [applyScanState],
  )

  // Keep a live bridge so the merge queue can drop cards while this
  // section is mounted (and disk cache is always updated by the queue).
  useEffect(() => {
    registerDedupScanSessionApi({ removeGroup: removeMergedGroup })
    return () => registerDedupScanSessionApi(null)
  }, [removeMergedGroup])

  useEffect(() => {
    if (!project) return
    return onDedupMergeComplete((task) => {
      if (task.projectId !== project.id) return
      // Session API already removes the group; refresh queue chips.
      setTasks([...getQueue()])
    })
  }, [project?.id])

  const handleScan = useCallback(async () => {
    if (!project) return
    const projectPath = normalizeProjectPath(project.path)
    const projectId = project.id

    if (!hasUsableLlm(effectiveDetectConfig, providerConfigs)) {
      applyScanState({
        projectId,
        projectPath,
        scanning: false,
        scanError: t("settings.sections.maintenance.dedup.selectDetectModel", {
          defaultValue: "请先选择检测模型。",
        }),
        groups: [],
        scanCompleted: false,
        scannedPageCount: null,
      })
      return
    }

    const appendScanLog = (message: string) => {
      const stamp = new Date().toLocaleTimeString()
      const line = `${stamp}  ${message}`
      setScanLogs((prev) => [...prev, line])
      console.log(`[Maintenance Dedup] ${message}`)
    }

    setIsScanning(true)
    setScanStage("loading")
    setScanLogs([])
    appendScanLog(
      detectModelId.trim()
        ? `检测模型 id：${detectModelId.trim()}`
        : "未选择检测模型 id，使用默认模型",
    )
    appendScanLog(
      mergeModelId.trim()
        ? `合并模型 id：${mergeModelId.trim()}（入队时使用）`
        : "未单独设置合并模型，入队时回退检测模型",
    )
    applyScanState({
      projectId,
      projectPath,
      scanning: true,
      scanError: null,
      groups: [],
      scanCompleted: false,
      scannedPageCount: null,
    })
    try {
      const { groups: detected, scannedPageCount } = await runDuplicateDetection(
        projectPath,
        effectiveDetectConfig,
        {
          onProgress: setScanStage,
          onLog: appendScanLog,
        },
      )
      applyScanState({
        projectId,
        projectPath,
        scanning: false,
        groups: detected.map((g) => ({
          group: g,
          canonicalSlug: g.slugs[0],
          skipped: false,
        })),
        scanCompleted: true,
        scannedPageCount,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      appendScanLog(`失败：${message}`)
      applyScanState({
        projectId,
        projectPath,
        scanning: false,
        scanError: message,
        scanCompleted: false,
        scannedPageCount: null,
      })
    } finally {
      setIsScanning(false)
      setScanStage(null)
    }
  }, [
    project,
    effectiveDetectConfig,
    providerConfigs,
    t,
    applyScanState,
    detectModelId,
    mergeModelId,
  ])

  const handleCanonicalChange = useCallback(
    (idx: number, slug: string) => {
      const source =
        localScanState && project && scanStateBelongsToProject(localScanState, project)
          ? localScanState
          : sharedScanState
      const groups = source.groups.map((g, i) => (i === idx ? { ...g, canonicalSlug: slug } : g))
      applyScanState({ groups })
    },
    [applyScanState, localScanState, project],
  )

  const handleEnqueue = useCallback(
    async (entry: GroupUiEntry) => {
      if (!project) return
      const key = groupKey(entry.group.slugs)
      setEnqueueingKey(key)
      setMergeErrors((prev) => {
        if (!prev[key]) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
      try {
        const pp = normalizeProjectPath(project.path)
        const missing: string[] = []
        for (const slug of entry.group.slugs) {
          const entityPath = `${pp}/wiki/entities/${slug}.md`
          const conceptPath = `${pp}/wiki/concepts/${slug}.md`
          const exists =
            (await fileExists(entityPath)) || (await fileExists(conceptPath))
          if (!exists) missing.push(slug)
        }
        if (missing.length > 0) {
          removeMergedGroup(entry.group.slugs)
          const message = t("settings.sections.maintenance.dedup.pagesMissing", {
            defaultValue: "部分页面已不存在（可能已合并）：{{slugs}}。已从列表移除。",
            slugs: missing.join(", "),
          })
          toast.error(message)
          return
        }

        if (!mergeLlmReady) {
          const message = t("settings.sections.maintenance.dedup.selectMergeModel", {
            defaultValue: "请先选择合并模型。",
          })
          setMergeErrors((prev) => ({ ...prev, [key]: message }))
          toast.error(message)
          return
        }

        const mergeIdForTask = mergeModelId.trim() || detectModelId.trim() || undefined
        await enqueueMerge(
          project.id,
          entry.group,
          entry.canonicalSlug,
          mergeIdForTask,
        )
        setTasks([...getQueue()])
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error("[Maintenance] enqueue failed:", err)
        setMergeErrors((prev) => ({ ...prev, [key]: message }))
        toast.error(message)
      } finally {
        setEnqueueingKey(null)
      }
    },
    [project, mergeModelId, detectModelId, mergeLlmReady, removeMergedGroup, t],
  )

  const handleCancel = useCallback(async (taskId: string) => {
    await cancelTask(taskId)
    setTasks([...getQueue()])
  }, [])

  const handleRetry = useCallback(async (taskId: string) => {
    await retryTask(taskId)
    setTasks([...getQueue()])
  }, [])

  const handleNotDuplicate = useCallback(
    async (idx: number) => {
      if (!project) return
      const entry = groups[idx]
      if (!entry) return
      try {
        await addNotDuplicate(project.path, entry.group.slugs)
        const source =
          localScanState && scanStateBelongsToProject(localScanState, project)
            ? localScanState
            : sharedScanState
        applyScanState({
          groups: source.groups.map((g, i) => (i === idx ? { ...g, skipped: true } : g)),
        })
      } catch (err) {
        console.error("[Maintenance] addNotDuplicate failed:", err)
      }
    },
    [project, groups, applyScanState, localScanState],
  )

  const visibleGroups = useMemo(
    () => sortGroupEntriesByConfidence(groups.filter((entry) => !entry.skipped)),
    [groups],
  )

  // Pending position helper: "queued (N ahead)" — count pending tasks
  // before this one in arrival order.
  const pendingPositionByTaskId = useMemo(() => {
    const positions = new Map<string, number>()
    let position = 0
    for (const t of tasks) {
      if (t.status === "pending") {
        positions.set(t.id, position)
        position++
      }
    }
    return positions
  }, [tasks])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.maintenance.title", { defaultValue: "维护工具" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.maintenance.description", {
            defaultValue:
              "用于清理资料库的工具：检测并合并那些在多次重新摄取后被大模型以不同名称创建出来的重复实体或概念。",
          })}
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">
            {t("settings.sections.maintenance.dedup.title", {
              defaultValue: "检测重复实体 / 概念",
            })}
          </h3>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("settings.sections.maintenance.dedup.description", {
            defaultValue:
              "让大模型扫描全部实体 / 概念页面，并把那些很可能只是名称不同、实则指向同一主题的条目分组出来（例如中英文名称、单复数、简称与全称）。每组都需要你确认后才会合并。合并任务会进入队列并逐个执行，以保持交叉引用一致。",
          })}
        </p>

        {/* 小说写作场景详细说明 */}
        <NovelScenarioHelp />

        {!projectReady && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t("settings.sections.maintenance.noProject", {
              defaultValue: "请先打开一个项目。",
            })}
          </p>
        )}
        {projectReady && !hasAvailableModels && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t("settings.sections.maintenance.dedup.noModel", {
              defaultValue: "请先在「设置 → 大语言模型」中添加并启用一个模型。",
            })}
          </p>
        )}
        {projectReady && hasAvailableModels && !detectLlmReady && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {detectModelId.trim()
              ? t("settings.sections.maintenance.noLlm", {
                  defaultValue: "请先配置大模型提供方。",
                })
              : t("settings.sections.maintenance.dedup.selectDetectModel", {
                  defaultValue: "请先选择检测模型。",
                })}
          </p>
        )}
        {projectReady && hasAvailableModels && detectLlmReady && !mergeLlmReady && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t("settings.sections.maintenance.dedup.selectMergeModel", {
              defaultValue: "请先选择合并模型。",
            })}
          </p>
        )}

        {projectReady && hasAvailableModels && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">
                {t("settings.sections.maintenance.dedup.detectModelLabel", {
                  defaultValue: "检测模型",
                })}
              </Label>
              <ChatModelSelector
                value={detectModelId}
                onChange={setDetectModelId}
                disabled={scanning}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t("settings.sections.maintenance.dedup.detectModelHint", {
                  defaultValue: "扫描分组用。实体多时上下文更大，建议用更强、上下文更长的模型。",
                })}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                {t("settings.sections.maintenance.dedup.mergeModelLabel", {
                  defaultValue: "合并模型",
                })}
              </Label>
              <ChatModelSelector
                value={mergeModelId}
                onChange={setMergeModelId}
                disabled={scanning}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t("settings.sections.maintenance.dedup.mergeModelHint", {
                  defaultValue: "写合并正文用。输入通常更短，可用相对便宜的模型。",
                })}
              </p>
            </div>
          </div>
        )}

        <Button
          onClick={() => void handleScan()}
          disabled={scanning || !projectReady || !hasAvailableModels || !llmReady}
        >
          {scanning ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("settings.sections.maintenance.dedup.scanning", {
                defaultValue: "扫描中...",
              })}
            </>
          ) : (
            t("settings.sections.maintenance.dedup.scanButton", {
              defaultValue: "开始扫描重复项",
            })
          )}
        </Button>

        {scanning && (
          <div className="flex items-start gap-1.5 rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs text-muted-foreground">
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
            <div>
              {scanStage === "loading"
                ? t("settings.sections.maintenance.dedup.scanStageLoading", {
                    defaultValue: "正在读取实体 / 概念页面…",
                  })
                : scanStage === "detecting"
                  ? t("settings.sections.maintenance.dedup.scanStageDetecting", {
                      defaultValue: "正在调用模型分析…",
                    })
                  : t("settings.sections.maintenance.dedup.scanningHint", {
                      defaultValue:
                        "正在扫描实体 / 概念页面并调用模型分析，可能需要一会儿…",
                    })}
            </div>
          </div>
        )}

        {(scanning || scanLogs.length > 0) && (
          <ProcessLogPanel
            title={t("settings.sections.maintenance.dedup.processLogTitle", {
              defaultValue: "分析过程日志",
            })}
            lines={scanLogs}
            live={scanning}
          />
        )}

        {scanError && (
          <div className="flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>{scanError}</div>
          </div>
        )}

        {scanCompleted && visibleGroups.length > 0 && !scanError && (
          <div className="flex items-start gap-1.5 rounded border border-sky-500/40 bg-sky-500/5 px-2 py-1.5 text-xs text-sky-800 dark:text-sky-300">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              {t("settings.sections.maintenance.dedup.groupsFound", {
                count: visibleGroups.length,
                defaultValue: "发现 {{count}} 组重复候选，请在下方确认是否合并。",
              })}
            </div>
          </div>
        )}

        {scanCompleted && scannedPageCount !== null && scannedPageCount < 2 && !scanError && (
          <div className="flex items-start gap-1.5 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              {t("settings.sections.maintenance.dedup.insufficientPages", {
                count: scannedPageCount,
                defaultValue: "至少需要 2 个实体 / 概念页面才能检测重复，当前只有 {{count}} 个。",
              })}
            </div>
          </div>
        )}

        {scanCompleted && visibleGroups.length === 0 && groups.length === 0 && !scanError && scannedPageCount !== null && scannedPageCount >= 2 && (
          <div className="flex items-start gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/5 px-2 py-1.5 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              {t("settings.sections.maintenance.dedup.noneFound", {
                defaultValue: "未发现重复分组，当前资料库很干净。",
              })}
            </div>
          </div>
        )}
      </div>

      <QueueOrphanList
        tasks={tasks}
        groups={groups}
        mergeProgress={mergeProgress}
        onCancel={(id) => void handleCancel(id)}
        onRetry={(id) => void handleRetry(id)}
        pendingPositionByTaskId={pendingPositionByTaskId}
      />

      {mergeLogs.length > 0 && (
        <ProcessLogPanel
          title={t("settings.sections.maintenance.dedup.mergeLogTitle", {
            defaultValue: "合并过程日志",
          })}
          lines={mergeLogs}
          live={!!mergeProgress}
        />
      )}

      {visibleGroups.map((entry) => {
        const entryKey = groupKey(entry.group.slugs)
        const idx = groups.findIndex((g) => groupKey(g.group.slugs) === entryKey)
        const task = findTaskForGroup(tasks, entry.group.slugs)
        return (
          <DuplicateGroupCard
            key={entry.group.slugs.join(",")}
            entry={entry}
            task={task}
            mergeProgress={mergeProgress}
            enqueueing={enqueueingKey === entryKey}
            mergeReady={mergeLlmReady}
            mergeError={mergeErrors[entryKey] ?? null}
            pendingPosition={
              task && task.status === "pending"
                ? pendingPositionByTaskId.get(task.id) ?? 0
                : 0
            }
            onCanonicalChange={(slug) => handleCanonicalChange(idx, slug)}
            onEnqueue={() => void handleEnqueue(entry)}
            onCancel={() => task && void handleCancel(task.id)}
            onRetry={() => task && void handleRetry(task.id)}
            onNotDuplicate={() => void handleNotDuplicate(idx)}
          />
        )
      })}
    </div>
  )
}

// --- helpers ---------------------------------------------------------------

function ProcessLogPanel({
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
        {lines.length > 0
          ? lines.join("\n")
          : "…"}
      </pre>
    </div>
  )
}

interface QueueOrphanListProps {
  tasks: readonly DedupTask[]
  groups: GroupUiEntry[]
  mergeProgress: { taskId: string; stage: DedupMergeStage } | null
  onCancel: (taskId: string) => void
  onRetry: (taskId: string) => void
  pendingPositionByTaskId: Map<string, number>
}

/**
 * Render queued tasks that don't have a matching card on screen. This
 * happens after the user closes the Maintenance pane and re-opens it,
 * or after an app restart with pending tasks: those tasks are real
 * but the user hasn't re-scanned, so without this list they'd be
 * invisible.
 */
function QueueOrphanList({
  tasks,
  groups,
  mergeProgress,
  onCancel,
  onRetry,
  pendingPositionByTaskId,
}: QueueOrphanListProps) {
  const { t } = useTranslation()
  const groupKeys = new Set(groups.map((g) => groupKey(g.group.slugs)))
  const orphans = tasks.filter((t) => !groupKeys.has(groupKey(t.group.slugs)))

  if (orphans.length === 0) return null

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-4">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          {t("settings.sections.maintenance.dedup.queueTitle", {
            defaultValue: "进行中的合并任务",
          })}
        </h3>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("settings.sections.maintenance.dedup.queueDescription", {
          defaultValue:
            "这里显示上一次扫描后仍未完成的任务。合并会逐个排队执行。",
        })}
      </p>
      {orphans.map((task) => (
        <div
          key={task.id}
          className="flex flex-wrap items-center gap-2 rounded border border-border/40 bg-background px-3 py-2 text-xs"
        >
          <code className="font-mono">{task.group.slugs.join(" + ")}</code>
          <span className="text-muted-foreground">
            →{" "}
            <code className="font-mono">{task.canonicalSlug}</code>
          </span>
          <span className="ml-auto inline-flex items-center gap-1">
            <TaskStatusChip
              task={task}
              pendingPosition={pendingPositionByTaskId.get(task.id) ?? 0}
              mergeStage={
                mergeProgress?.taskId === task.id ? mergeProgress.stage : null
              }
            />
            {task.status === "failed" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onRetry(task.id)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("settings.sections.maintenance.dedup.retry", {
                  defaultValue: "重试",
                })}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => onCancel(task.id)}>
              <Trash2 className="h-3.5 w-3.5" />
              {t("settings.sections.maintenance.dedup.delete", {
                defaultValue: "删除",
              })}
            </Button>
          </span>
          {task.error && task.status === "failed" && (
            <div className="basis-full rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1 text-rose-700 dark:text-rose-400">
              {task.error}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

interface ChipProps {
  task: DedupTask
  pendingPosition: number
  mergeStage?: DedupMergeStage | null
}

function mergeStageLabel(
  stage: DedupMergeStage,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (stage) {
    case "loading":
      return t("settings.sections.maintenance.dedup.mergeStageLoading", {
        defaultValue: "正在读取 wiki…",
      })
    case "merging":
      return t("settings.sections.maintenance.dedup.mergeStageMerging", {
        defaultValue: "正在合并内容（LLM）…",
      })
    case "writing":
      return t("settings.sections.maintenance.dedup.mergeStageWriting", {
        defaultValue: "正在写入文件…",
      })
  }
}

function TaskStatusChip({ task, pendingPosition, mergeStage }: ChipProps) {
  const { t } = useTranslation()
  if (task.status === "processing") {
    const label =
      mergeStage != null
        ? mergeStageLabel(mergeStage, t)
        : t("settings.sections.maintenance.dedup.merging", {
            defaultValue: "合并中...",
          })
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        {label}
      </span>
    )
  }
  if (task.status === "pending") {
    if (pendingPosition === 0) {
      return (
        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
          {t("settings.sections.maintenance.dedup.queued", {
            defaultValue: "已排队",
          })}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
        {t("settings.sections.maintenance.dedup.queuedAhead", {
          defaultValue: "已排队（前方还有 {{n}} 项）",
          n: pendingPosition,
        })}
      </span>
    )
  }
  if (task.status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-700 dark:text-rose-400">
        <AlertTriangle className="h-3 w-3" />
        {t("settings.sections.maintenance.dedup.failed", {
          defaultValue: "失败（{{retries}}/3）",
          retries: task.retryCount,
        })}
      </span>
    )
  }
  return null
}

interface CardProps {
  entry: GroupUiEntry
  task: DedupTask | undefined
  mergeProgress: { taskId: string; stage: DedupMergeStage } | null
  enqueueing: boolean
  mergeReady: boolean
  mergeError: string | null
  pendingPosition: number
  onCanonicalChange: (slug: string) => void
  onEnqueue: () => void
  onCancel: () => void
  onRetry: () => void
  onNotDuplicate: () => void
}

function DuplicateGroupCard({
  entry,
  task,
  mergeProgress,
  enqueueing,
  mergeReady,
  mergeError,
  pendingPosition,
  onCanonicalChange,
  onEnqueue,
  onCancel,
  onRetry,
  onNotDuplicate,
}: CardProps) {
  const { t } = useTranslation()
  const { group, canonicalSlug, skipped } = entry

  const inFlight = !!task && (task.status === "pending" || task.status === "processing")
  const failed = !!task && task.status === "failed"
  const finished = skipped

  const confidenceClass =
    group.confidence === "high"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : group.confidence === "medium"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : "bg-muted text-muted-foreground"

  return (
    <div
      className={`space-y-3 rounded-lg border px-4 py-3 ${
        finished ? "border-border/40 bg-muted/10 opacity-60" : "border-border bg-background"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${confidenceClass}`}>
          {group.confidence}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("settings.sections.maintenance.dedup.candidates", {
            defaultValue: "{{n}} 个候选",
            n: group.slugs.length,
          })}
        </span>
        {skipped && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
            {t("settings.sections.maintenance.dedup.skipped", { defaultValue: "已标记为不重复" })}
          </span>
        )}
        {task && !finished && (
          <span className="ml-auto">
            <TaskStatusChip
              task={task}
              pendingPosition={pendingPosition}
              mergeStage={
                mergeProgress?.taskId === task.id ? mergeProgress.stage : null
              }
            />
          </span>
        )}
      </div>

      {group.reason && (
        <div className="text-xs italic leading-relaxed text-muted-foreground">{group.reason}</div>
      )}

      {!finished && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">
              {t("settings.sections.maintenance.dedup.canonicalLabel", {
                defaultValue: "保留以下 slug 作为主条目：",
              })}
            </Label>
            {group.slugs.map((slug) => (
              <label
                key={slug}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"
              >
                <input
                  type="radio"
                  name={`canonical-${group.slugs.join(",")}`}
                  checked={canonicalSlug === slug}
                  onChange={() => onCanonicalChange(slug)}
                  disabled={inFlight}
                />
                <code className="font-mono text-xs">{slug}</code>
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {!task && (
              <>
                <Button size="sm" onClick={onEnqueue} disabled={enqueueing || !mergeReady}>
                  {enqueueing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t("settings.sections.maintenance.dedup.enqueueing", {
                        defaultValue: "加入队列...",
                      })}
                    </>
                  ) : (
                    t("settings.sections.maintenance.dedup.mergeButton", {
                      defaultValue: "合并到 {{slug}}",
                      slug: canonicalSlug,
                    })
                  )}
                </Button>
                <Button size="sm" variant="ghost" onClick={onNotDuplicate} disabled={enqueueing}>
                  {t("settings.sections.maintenance.dedup.notDuplicates", {
                    defaultValue: "不是重复",
                  })}
                </Button>
              </>
            )}
            {inFlight && (
              <Button size="sm" variant="ghost" onClick={onCancel}>
                <Trash2 className="h-3.5 w-3.5" />
                {t("settings.sections.maintenance.dedup.cancel", {
                  defaultValue: "取消",
                })}
              </Button>
            )}
            {failed && (
              <>
                <Button size="sm" onClick={onRetry}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t("settings.sections.maintenance.dedup.retry", {
                    defaultValue: "重试",
                  })}
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancel}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("settings.sections.maintenance.dedup.delete", {
                    defaultValue: "删除",
                  })}
                </Button>
              </>
            )}
          </div>
        </>
      )}

      {mergeError && !task && (
        <div className="flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>{mergeError}</div>
        </div>
      )}

      {failed && task?.error && (
        <div className="flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>{task.error}</div>
        </div>
      )}
    </div>
  )
}

// ─── 小说写作场景详细说明 ───────────────────────────────────────────────────────

function NovelScenarioHelp() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-md border border-border/40 bg-background/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <HelpCircle className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">
          {t("settings.sections.maintenance.dedup.novelHelpTitle", {
            defaultValue: "写小说的话，这个功能有什么用？",
          })}
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        )}
      </button>
      {open && (
        <div className="space-y-3 border-t border-border/40 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
          <p>
            {t("settings.sections.maintenance.dedup.novelHelpIntro", {
              defaultValue:
                "简单说：当你的角色库、设定库里出现了「同一个人/同一个东西有好几个页面」的情况，这个工具能帮你找出来并合并成一个。",
            })}
          </p>

          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/70" />
              <div>
                <div className="font-medium text-foreground/80">
                  {t("settings.sections.maintenance.dedup.novelHelpExample1Title", {
                    defaultValue: "角色重复（最常见）",
                  })}
                </div>
                <p>
                  {t("settings.sections.maintenance.dedup.novelHelpExample1", {
                    defaultValue:
                      "比如 AI 一会儿叫「张三」、一会儿叫「张小三」、一会儿又叫「男主」，其实是同一个人。每出现一个新名字，就会多出一个角色页面。",
                  })}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/70" />
              <div>
                <div className="font-medium text-foreground/80">
                  {t("settings.sections.maintenance.dedup.novelHelpExample2Title", {
                    defaultValue: "设定/功法/地名重复",
                  })}
                </div>
                <p>
                  {t("settings.sections.maintenance.dedup.novelHelpExample2", {
                    defaultValue:
                      "比如「九阳神功」和「九阳真经」、「青云宗」和「青云派」，名字略有不同但说的是一回事，资料库会越攒越乱。",
                  })}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/70" />
              <div>
                <div className="font-medium text-foreground/80">
                  {t("settings.sections.maintenance.dedup.novelHelpHowTitle", {
                    defaultValue: "合并之后会怎样？",
                  })}
                </div>
                <ul className="list-disc space-y-0.5 pl-4">
                  <li>
                    {t("settings.sections.maintenance.dedup.novelHelpHow1", {
                      defaultValue: "两个页面的内容会合二为一，不会丢信息",
                    })}
                  </li>
                  <li>
                    {t("settings.sections.maintenance.dedup.novelHelpHow2", {
                      defaultValue: "所有章节里引用了旧名字的地方，会自动改成新名字，不会有死链",
                    })}
                  </li>
                  <li>
                    {t("settings.sections.maintenance.dedup.novelHelpHow3", {
                      defaultValue: "合并前会自动备份，合并错了也能恢复",
                    })}
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <p className="pt-1 text-[11px] text-muted-foreground/70">
            {t("settings.sections.maintenance.dedup.novelHelpTip", {
              defaultValue:
                "💡 小提示：扫描结果只是 AI 的猜测，需要你确认后才会真正合并。觉得不是重复的可以点「不是重复」，下次扫描就不会再出现了。",
            })}
          </p>
        </div>
      )}
    </div>
  )
}
