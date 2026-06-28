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
import { useWikiStore } from "@/stores/wiki-store"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { resolveDefaultModel } from "@/lib/novel/model-resolver"
import { runDuplicateDetection } from "@/lib/dedup-runner"
import { addNotDuplicate } from "@/lib/dedup-storage"
import {
  enqueueMerge,
  cancelTask,
  retryTask,
  getQueue,
  groupKey,
  type DedupTask,
} from "@/lib/dedup-queue"
import type { DuplicateGroup } from "@/lib/dedup"

interface GroupUiEntry {
  group: DuplicateGroup
  canonicalSlug: string
  /** Becomes true when the user marks the group as "not duplicates"
   *  in this session — the card transitions to skipped state. */
  skipped: boolean
}

interface MaintenanceScanState {
  projectPath: string | null
  scanning: boolean
  scanError: string | null
  groups: GroupUiEntry[]
  scanCompleted: boolean
}

const emptyScanState: MaintenanceScanState = {
  projectPath: null,
  scanning: false,
  scanError: null,
  groups: [],
  scanCompleted: false,
}

let sharedScanState: MaintenanceScanState = emptyScanState
const scanListeners = new Set<(state: MaintenanceScanState) => void>()

function setSharedScanState(patch: Partial<MaintenanceScanState>): void {
  sharedScanState = { ...sharedScanState, ...patch }
  for (const listener of scanListeners) listener(sharedScanState)
}

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
  const project = useWikiStore((s) => s.project)

  const [scanState, setScanState] = useState<MaintenanceScanState>(sharedScanState)

  useEffect(() => subscribeScanState(setScanState), [])

  // Poll the queue at 1Hz so the UI reflects pending → processing →
  // failed transitions and cross-window queue activity (e.g. a merge
  // that completed while the user was on a different settings tab).
  // Same pattern activity-panel uses for ingest-queue.
  const [tasks, setTasks] = useState<readonly DedupTask[]>([])
  useEffect(() => {
    setTasks([...getQueue()])
    const id = setInterval(() => setTasks([...getQueue()]), 1000)
    return () => clearInterval(id)
  }, [])

  const resolvedLlmConfig = useMemo(() => resolveDefaultModel(llmConfig), [llmConfig])
  const llmReady = hasUsableLlm(resolvedLlmConfig, providerConfigs)
  const projectReady = !!project
  const projectScanState = project && scanState.projectPath === project.path ? scanState : emptyScanState
  const { scanning, scanError, groups, scanCompleted } = projectScanState

  const handleScan = useCallback(async () => {
    if (!project) return
    setSharedScanState({
      projectPath: project.path,
      scanning: true,
      scanError: null,
      groups: [],
      scanCompleted: false,
    })
    try {
      const detected = await runDuplicateDetection(project.path, llmConfig)
      setSharedScanState({
        projectPath: project.path,
        groups: detected.map((g) => ({
          group: g,
          canonicalSlug: g.slugs[0],
          skipped: false,
        })),
        scanCompleted: true,
      })
    } catch (err) {
      setSharedScanState({
        projectPath: project.path,
        scanError: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSharedScanState({ projectPath: project.path, scanning: false })
    }
  }, [project, llmConfig])

  const handleCanonicalChange = useCallback(
    (idx: number, slug: string) => {
      setSharedScanState({
        groups: sharedScanState.groups.map((g, i) => (i === idx ? { ...g, canonicalSlug: slug } : g)),
      })
    },
    [],
  )

  const handleEnqueue = useCallback(
    async (entry: GroupUiEntry) => {
      if (!project) return
      try {
        await enqueueMerge(project.id, entry.group, entry.canonicalSlug)
        // Refresh immediately so the card flips to "queued" without
        // waiting for the next 1s poll tick.
        setTasks([...getQueue()])
      } catch (err) {
        console.error("[Maintenance] enqueue failed:", err)
      }
    },
    [project],
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
        setSharedScanState({
          groups: sharedScanState.groups.map((g, i) => (i === idx ? { ...g, skipped: true } : g)),
        })
      } catch (err) {
        console.error("[Maintenance] addNotDuplicate failed:", err)
      }
    },
    [project, groups],
  )

  // Drive each card's status from the queue.
  // - Card not in queue + not skipped → idle, can merge / dismiss
  // - Task pending → "Queued (N ahead)"
  // - Task processing → "Merging…"
  // - Task gone (after success) → "Merged" (queue removes done tasks
  //     immediately, so we only know it succeeded if we observed it
  //     in-flight before. Track that with a session-local set.)
  // - Task failed → show error + retry / delete.
  const [recentlyMergedKeys, setRecentlyMergedKeys] = useState<Set<string>>(
    () => new Set(),
  )

  useEffect(() => {
    // Detect transitions out of the queue: a slug-set we saw last
    // tick is now gone → it completed (cancelled paths also remove,
    // but only with explicit user action that re-renders separately).
    setRecentlyMergedKeys((prev) => {
      const currentKeys = new Set(tasks.map((t) => groupKey(t.group.slugs)))
      let changed = false
      const next = new Set(prev)
      for (const g of groups) {
        const k = groupKey(g.group.slugs)
        const wasInFlight = lastSeenTaskKeysRef.current.has(k)
        if (wasInFlight && !currentKeys.has(k) && !next.has(k)) {
          next.add(k)
          changed = true
        }
      }
      lastSeenTaskKeysRef.current = currentKeys
      return changed ? next : prev
    })
    // We intentionally only re-run when tasks change — the closure
    // over `groups` is fine because newly-scanned groups can't be
    // "recently merged" until they've been observed in-flight first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks])
  const lastSeenTaskKeysRef = useRefInit<Set<string>>(() => new Set())

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
        {projectReady && !llmReady && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t("settings.sections.maintenance.noLlm", {
              defaultValue: "请先配置大模型提供方。",
            })}
          </p>
        )}

        <Button
          onClick={() => void handleScan()}
          disabled={scanning || !projectReady || !llmReady}
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

        {scanError && (
          <div className="flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>{scanError}</div>
          </div>
        )}

        {scanCompleted && groups.length === 0 && !scanError && (
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
        onCancel={(id) => void handleCancel(id)}
        onRetry={(id) => void handleRetry(id)}
        pendingPositionByTaskId={pendingPositionByTaskId}
      />

      {groups.map((entry, idx) => {
        const task = findTaskForGroup(tasks, entry.group.slugs)
        const merged = recentlyMergedKeys.has(groupKey(entry.group.slugs))
        return (
          <DuplicateGroupCard
            key={entry.group.slugs.join(",")}
            entry={entry}
            task={task}
            merged={merged}
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

/** A useRef variant that initializes lazily — avoids constructing a new
 *  Set on every render. Kept inline since it's only used here. */
function useRefInit<T>(init: () => T): { current: T } {
  // `useState` returning a ref-shaped object lets us mutate `.current`
  // without triggering re-renders, which is exactly the ref semantics
  // we want for the "last seen task keys" tracking above.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [ref] = useState<{ current: T }>(() => ({ current: init() }))
  return ref
}

interface QueueOrphanListProps {
  tasks: readonly DedupTask[]
  groups: GroupUiEntry[]
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
}

function TaskStatusChip({ task, pendingPosition }: ChipProps) {
  const { t } = useTranslation()
  if (task.status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("settings.sections.maintenance.dedup.merging", {
          defaultValue: "合并中...",
        })}
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
  merged: boolean
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
  merged,
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
  const finished = merged || skipped

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
        {merged && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("settings.sections.maintenance.dedup.merged", { defaultValue: "已合并" })}
          </span>
        )}
        {skipped && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
            {t("settings.sections.maintenance.dedup.skipped", { defaultValue: "已标记为不重复" })}
          </span>
        )}
        {task && !finished && (
          <span className="ml-auto">
            <TaskStatusChip task={task} pendingPosition={pendingPosition} />
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
                <Button size="sm" onClick={onEnqueue}>
                  {t("settings.sections.maintenance.dedup.mergeButton", {
                    defaultValue: "合并到 {{slug}}",
                    slug: canonicalSlug,
                  })}
                </Button>
                <Button size="sm" variant="ghost" onClick={onNotDuplicate}>
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
