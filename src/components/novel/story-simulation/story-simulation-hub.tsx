import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowRight, ChevronDown, Drama, Link2, Trash2, Users } from "lucide-react"

import { useWikiStore } from "@/stores/wiki-store"
import { useStorySimulationStore } from "@/stores/story-simulation-store"
import {
  deleteFramework,
  loadFrameworks,
  loadLatestSimulationResult,
  type SimulationResultRecord,
} from "@/lib/novel/story-simulation/framework-store"
import {
  clearBinding,
  loadBinding,
} from "@/lib/novel/story-simulation/framework-binding"
import { loadScenarios } from "@/lib/novel/story-simulation/scenario-store"
import {
  buildRecentActivity,
  type RecentActivityItem,
  type RecentActivityKind,
  type RecentResultInput,
} from "@/lib/novel/story-simulation/recent-activity"
import type { ScenarioSession } from "@/lib/novel/story-simulation/scenario-types"
import type { StoryFramework } from "@/lib/novel/story-simulation/types"
import { cn } from "@/lib/utils"

import { FrameworkBindingDialog } from "./framework-binding-dialog"

/**
 * 「剧情推演室」落地页 —— 两个**彼此独立**功能的同级入口 + 「最近」+ 框架管理。
 *
 * 改造前两者的关系是父子：「人物对话辅助 / 舞台情景」是「剧情推演」配置页
 * 最底部的一小节（SimulationConfigPanel 里的 `onOpenScenario`），
 * 要滚到配置页底部才看得到，层级上也被压在「剧情推演」下面。
 *
 * 入口用**纵向入口列表**（设计稿「方案 B」）而不是并排双卡：
 * - 两个功能信息量不对称（舞台情景的说明明显更长），卡片会一行高一行矮；
 *   列表的行高由统一的 padding + 图标撑住，文案长短不影响观感。
 * - 每行底部的「流程标签」让用户**在点击之前**就知道进去会经历哪几步。
 * - 将来要加第三个入口，只是再加一行。
 *
 * 下半部分的两块是删掉左侧「故事框架」栏之后补回来的 —— 那一栏原本独家承载了
 * 四件事，删栏时一并失去，必须在这里有去处，否则就是静默掉功能：
 * 1. 「回到上次工作」（框架列表）→ 「最近」区块（设计稿「方案 E」）。
 *    归并规则住在 `recent-activity.ts`（纯函数，有单测）。
 * 2. 「回到上次那份报告」（结果列表）→ 「最近」里的「报告」条目。
 * 3. **删除框架**（`deleteFramework`）。
 * 4. **把框架绑定到 AI 会话**（`FrameworkBindingDialog`）—— 写正文时让 AI
 *    知道剧情走向。这也是那个 dialog 组件唯一的入口。
 *
 * 这个页面本身不承载流程，只做分流；两条流程仍共用同一个
 * `story-simulation-store` 的 phase 状态机（见 story-simulation-view.tsx）。
 */
export interface StorySimulationHubProps {
  /** 进入「剧情推演式」（新建）。 */
  onEnterSimulation: () => void
  /** 进入「舞台情景」（新建）。 */
  onEnterScenario: () => void
  /** 回到某条历史故事框架，继续上次的推演。 */
  onResumeFramework?: (framework: StoryFramework) => void
  /** 回到某场历史舞台情景，继续上次的对话。 */
  onResumeScenario?: (session: ScenarioSession) => void
  /** 直接打开某份历史推演报告（可能属于别的框架）。 */
  onResumeResult?: (framework: StoryFramework, record: SimulationResultRecord) => void
}

/**
 * 只给**最新的这么多个**框架各读一条最新结果。
 *
 * 为什么要有上限：读结果比读框架/情景贵得多 —— 结果文件里带着完整时间线与
 * agent 快照。无上限地扫全部框架，会让一个入口页变成一次批量磁盘读。
 * 8 是「覆盖「最近」列表（5 条）还要有余量」的经验值。
 */
export const FRAMEWORK_RESULT_SCAN_LIMIT = 8

interface HubEntry {
  key: "simulation" | "scenario"
  icon: typeof Drama
  /** 图标底色：两个功能给不同色调，便于扫视时区分（与情景页灵魂标签的琥珀色一致）。 */
  iconClass: string
  name: string
  desc: string
  /** 该功能会经历的主要步骤，渲染成标签条。 */
  steps: string[]
  onClick: () => void
}

/** 一个框架 + 它最新的一条推演结果（可能没有）。 */
interface LatestResultEntry {
  framework: StoryFramework
  record: SimulationResultRecord | null
}

/** 文案里的步骤以逗号分隔（仓库里没有用过 i18next 的 returnObjects，保持一致）。 */
function splitSteps(raw: string): string[] {
  return raw
    .split(",")
    .map((step) => step.trim())
    .filter(Boolean)
}

async function loadLatestResultsFor(
  projectPath: string,
  frameworks: readonly StoryFramework[],
): Promise<LatestResultEntry[]> {
  return Promise.all(
    frameworks.slice(0, FRAMEWORK_RESULT_SCAN_LIMIT).map(async (framework) => ({
      framework,
      record: await loadLatestSimulationResult(projectPath, framework.id),
    })),
  )
}

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** 三类记录的标签配色：框架=主题绿，情景=琥珀（与情景页灵魂标签一致），报告=天蓝。 */
function badgeClassFor(kind: RecentActivityKind): string {
  if (kind === "framework") return "bg-primary/10 text-primary"
  if (kind === "scenario") return "bg-amber-100 text-amber-700"
  return "bg-sky-100 text-sky-700"
}

interface ListRowProps {
  badge: string
  badgeClass: string
  title: string
  meta?: string
  /** 行内「打开」按钮的 data-ui，供 UI 测试定位。 */
  testId: string
  onOpen: () => void
  /** 有这些回调才会渲染右侧操作区（情景行、报告行没有）。 */
  onBind?: () => void
  onDelete?: () => void
  bound?: boolean
  deleting?: boolean
  bindTitle?: string
  deleteTitle?: string
}

/**
 * 一行记录。左侧是「打开」按钮（badge + 标题 + 元信息），右侧是独立的操作按钮 ——
 * **不能**把操作按钮套进「打开」按钮里，button 不能嵌套 button。
 */
function ListRow({
  badge,
  badgeClass,
  title,
  meta,
  testId,
  onOpen,
  onBind,
  onDelete,
  bound,
  deleting,
  bindTitle,
  deleteTitle,
}: ListRowProps) {
  return (
    <div
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5",
        "transition-colors hover:bg-accent/45 focus-within:bg-accent/45",
      )}
    >
      <button
        type="button"
        data-ui={testId}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none"
      >
        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-1 text-[0.625rem] font-semibold leading-none",
            badgeClass,
          )}
        >
          {badge}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{title}</span>
        {meta && (
          <span className="shrink-0 text-[0.6875rem] text-muted-foreground">{meta}</span>
        )}
      </button>

      {(onBind || onDelete) && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {onBind && (
            <button
              type="button"
              title={bindTitle}
              onClick={onBind}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none"
            >
              <Link2 className={cn("h-3.5 w-3.5", bound && "text-primary")} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              title={deleteTitle}
              onClick={onDelete}
              disabled={deleting}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:outline-none disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function StorySimulationHub({
  onEnterSimulation,
  onEnterScenario,
  onResumeFramework,
  onResumeScenario,
  onResumeResult,
}: StorySimulationHubProps) {
  const { t } = useTranslation()
  const projectPath = useWikiStore((s) => s.project?.path)
  const binding = useStorySimulationStore((s) => s.binding)
  const setBinding = useStorySimulationStore((s) => s.setBinding)

  /*
   * 原始记录留在这里，点击时按 id 找回完整对象交给上层 —— 「最近」列表本身
   * 只带展示所需的字段（见 RecentActivityItem），不把整份会话/结果塞进去。
   */
  const [frameworks, setFrameworks] = useState<StoryFramework[]>([])
  const [scenarios, setScenarios] = useState<ScenarioSession[]>([])
  const [latestResults, setLatestResults] = useState<LatestResultEntry[]>([])
  const [showAllFrameworks, setShowAllFrameworks] = useState(false)
  const [dialogFramework, setDialogFramework] = useState<StoryFramework | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!projectPath) {
      setFrameworks([])
      setScenarios([])
      setLatestResults([])
      setBinding(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const [loadedFrameworks, loadedScenarios, loadedBinding] = await Promise.all([
          loadFrameworks(projectPath),
          loadScenarios(projectPath),
          loadBinding(projectPath),
        ])
        const latest = await loadLatestResultsFor(projectPath, loadedFrameworks)
        if (cancelled) return
        setFrameworks(loadedFrameworks)
        setScenarios(loadedScenarios)
        setBinding(loadedBinding)
        setLatestResults(latest)
      } catch {
        // 读不出来时整块隐藏，不打扰用户
        if (cancelled) return
        setFrameworks([])
        setScenarios([])
        setLatestResults([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectPath, setBinding])

  const reloadFrameworks = useCallback(async () => {
    if (!projectPath) return
    try {
      const loaded = await loadFrameworks(projectPath)
      setFrameworks(loaded)
      setLatestResults(await loadLatestResultsFor(projectPath, loaded))
    } catch {
      setFrameworks([])
      setLatestResults([])
    }
  }, [projectPath])

  /** 供「最近」归并用的结果输入（只带展示字段，完整对象留在 latestResults 里）。 */
  const recentResults = useMemo<RecentResultInput[]>(
    () =>
      latestResults
        .filter(
          (entry): entry is LatestResultEntry & { record: SimulationResultRecord } =>
            Boolean(entry.record),
        )
        .map((entry) => ({
          frameworkId: entry.framework.id,
          resultId: entry.record.id,
          title: entry.record.report.recommendation,
          createdAt: entry.record.report.createdAt,
        })),
    [latestResults],
  )

  const recent = useMemo(
    () => buildRecentActivity({ frameworks, scenarios, results: recentResults }),
    [frameworks, scenarios, recentResults],
  )

  const formatTime = (iso: string): string => {
    const parsed = Date.parse(iso)
    if (Number.isNaN(parsed)) return ""
    const date = new Date(parsed)
    const hm = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    const now = new Date()
    if (isSameDay(date, now)) return t("storySimulation.hubToday", { time: hm })
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    if (isSameDay(date, yesterday)) return t("storySimulation.hubYesterday", { time: hm })
    return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  }

  const frameworkTitle = (framework: StoryFramework): string =>
    framework.title || t("storySimulation.hubRecentUntitled")

  const isBound = (framework: StoryFramework): boolean =>
    binding?.frameworkId === framework.id

  const frameworkMeta = (framework: StoryFramework): string => {
    const parts = [
      t("storySimulation.hubFrameworkMeta", {
        nodes: framework.nodes?.length ?? 0,
        words: framework.targetWords,
      }),
    ]
    if (isBound(framework)) parts.push(t("storySimulation.hubBound"))
    return parts.join(" · ")
  }

  const bindTitle = (framework: StoryFramework): string =>
    isBound(framework)
      ? t("storySimulation.hubBindManage")
      : t("storySimulation.hubBind")

  const badgeLabel = (kind: RecentActivityKind): string => {
    if (kind === "framework") return t("storySimulation.hubRecentFramework")
    if (kind === "scenario") return t("storySimulation.hubRecentScenario")
    return t("storySimulation.hubRecentResult")
  }

  const handleOpenRecent = (item: RecentActivityItem) => {
    if (item.kind === "framework") {
      const framework = frameworks.find((f) => f.id === item.id)
      if (framework) onResumeFramework?.(framework)
      return
    }
    if (item.kind === "result") {
      const entry = latestResults.find(
        (candidate) =>
          candidate.framework.id === item.frameworkId && candidate.record?.id === item.id,
      )
      if (entry?.record) onResumeResult?.(entry.framework, entry.record)
      return
    }
    const session = scenarios.find((s) => s.id === item.id)
    if (session) onResumeScenario?.(session)
  }

  const handleDeleteFramework = async (framework: StoryFramework) => {
    if (!projectPath) return
    const confirmed = window.confirm(
      t("storySimulation.hubDeleteFrameworkConfirm", { title: frameworkTitle(framework) }),
    )
    if (!confirmed) return
    setDeletingId(framework.id)
    try {
      await deleteFramework(projectPath, framework.id)
      /*
       * `deleteFramework` 只删框架文件与它的结果，**不会**动绑定文件。
       * 删掉正在绑定的框架会留下一条指向已删框架的悬空绑定（对话上下文
       * 会照读），所以这里显式清掉。
       */
      if (isBound(framework)) {
        await clearBinding(projectPath)
        setBinding(null)
      }
      await reloadFrameworks()
    } catch {
      // 删除失败不做额外提示
    } finally {
      setDeletingId(null)
    }
  }

  const entries: HubEntry[] = [
    {
      key: "simulation",
      icon: Drama,
      iconClass: "bg-primary/10 text-primary",
      name: t("storySimulation.hubSimulationName"),
      desc: t("storySimulation.hubSimulationDesc"),
      steps: splitSteps(t("storySimulation.hubSimulationSteps")),
      onClick: onEnterSimulation,
    },
    {
      key: "scenario",
      icon: Users,
      iconClass: "bg-amber-100 text-amber-700",
      name: t("storySimulation.hubScenarioName"),
      desc: t("storySimulation.hubScenarioDesc"),
      steps: splitSteps(t("storySimulation.hubScenarioSteps")),
      onClick: onEnterScenario,
    },
  ]

  return (
    <div data-ui="simulation-hub" className="mx-auto w-full max-w-2xl p-8">
      <div className="flex flex-col overflow-hidden rounded-xl border border-border">
        {entries.map((entry) => {
          const Icon = entry.icon
          return (
            <button
              key={entry.key}
              type="button"
              data-ui={`simulation-hub-entry-${entry.key}`}
              onClick={entry.onClick}
              className={cn(
                "group flex w-full items-center gap-4 border-t border-border bg-background px-5 py-4 text-left transition-colors",
                "first:border-t-0",
                "hover:bg-accent/45 focus-visible:bg-accent/45 focus-visible:outline-none",
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]",
                  entry.iconClass,
                )}
              >
                <Icon className="h-5 w-5" />
              </span>

              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-sm font-medium">{entry.name}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {entry.desc}
                </span>
                <span className="mt-0.5 flex flex-wrap gap-1.5">
                  {entry.steps.map((step) => (
                    <span
                      key={step}
                      className="rounded-full bg-muted px-2.5 py-1 text-[0.6875rem] font-medium leading-none text-muted-foreground"
                    >
                      {step}
                    </span>
                  ))}
                </span>
              </span>

              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
            </button>
          )
        })}
      </div>

      {recent.length > 0 && (
        <section data-ui="simulation-hub-recent" className="mt-6 border-t border-border pt-5">
          <h2 className="text-sm font-medium">{t("storySimulation.hubRecent")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("storySimulation.hubRecentHint")}
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {recent.map((item) => {
              const framework =
                item.kind === "framework"
                  ? frameworks.find((f) => f.id === item.id)
                  : undefined
              return (
                <ListRow
                  key={`${item.kind}-${item.id}`}
                  testId={`simulation-hub-recent-${item.kind}`}
                  badge={badgeLabel(item.kind)}
                  badgeClass={badgeClassFor(item.kind)}
                  title={item.title || t("storySimulation.hubRecentUntitled")}
                  meta={formatTime(item.time)}
                  onOpen={() => handleOpenRecent(item)}
                  onBind={framework ? () => setDialogFramework(framework) : undefined}
                  onDelete={
                    framework ? () => void handleDeleteFramework(framework) : undefined
                  }
                  bound={framework ? isBound(framework) : false}
                  deleting={deletingId === item.id}
                  bindTitle={framework ? bindTitle(framework) : undefined}
                  deleteTitle={t("storySimulation.hubDeleteFramework")}
                />
              )
            })}
          </div>

          {/*
            前 5 条之外的框架在「最近」里看不到，也就没法删/绑定，
            所以给一个「查看全部框架」的展开兜底。
          */}
          {frameworks.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                data-ui="simulation-hub-all-frameworks"
                aria-expanded={showAllFrameworks}
                onClick={() => setShowAllFrameworks((previous) => !previous)}
                className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/45 hover:text-foreground focus-visible:outline-none"
              >
                {showAllFrameworks
                  ? t("storySimulation.hubAllFrameworksCollapse")
                  : t("storySimulation.hubAllFrameworks", { count: frameworks.length })}
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    showAllFrameworks && "rotate-180",
                  )}
                />
              </button>

              {showAllFrameworks && (
                <div className="mt-2 flex flex-col gap-2">
                  {frameworks.map((framework) => (
                    <ListRow
                      key={framework.id}
                      testId="simulation-hub-framework"
                      badge={t("storySimulation.hubFrameworkBadge")}
                      badgeClass="bg-primary/10 text-primary"
                      title={frameworkTitle(framework)}
                      meta={frameworkMeta(framework)}
                      onOpen={() => onResumeFramework?.(framework)}
                      onBind={() => setDialogFramework(framework)}
                      onDelete={() => void handleDeleteFramework(framework)}
                      bound={isBound(framework)}
                      deleting={deletingId === framework.id}
                      bindTitle={bindTitle(framework)}
                      deleteTitle={t("storySimulation.hubDeleteFramework")}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {dialogFramework && (
        <FrameworkBindingDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setDialogFramework(null)
          }}
          framework={dialogFramework}
          onBound={() => setDialogFramework(null)}
        />
      )}
    </div>
  )
}
