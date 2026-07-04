import { useState, useRef, useEffect } from "react"
import {
  X,
  Clock,
  Zap,
  Database,
  ShieldAlert,
  Target,
  Route,
  Layers,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  BookOpen,
  FileText,
  Users,
  Sparkles,
  Clock as ClockIcon,
  Settings,
  Heart,
  Brain,
  Network,
  Wand2,
  Edit3,
  RefreshCw,
} from "lucide-react"
import type { ContextTrace, TraceContextInfo } from "@/lib/agent/context-trace"
import type { NovelTaskIntent } from "@/lib/novel/task-router"
import type { DataSourceCategory, RouteSource } from "@/lib/novel/classification"
import {
  DATA_SOURCE_CATEGORY_LABELS,
  loadProjectClassification,
  upgradeClassificationConfig,
  writeProjectClassification,
} from "@/lib/novel/classification"
import { cn } from "@/lib/utils"
import { ToolCallTimeline } from "./tool-call-timeline"

interface RebuildRetrievalResult {
  success: boolean
  chapterCount?: number
  error?: string
}

interface ContextTracePanelProps {
  trace: ContextTrace | null
  projectPath?: string | null
  onClose?: () => void
  className?: string
  onRebuildRetrievalIndex?: () => Promise<RebuildRetrievalResult>
  retrievalIndexHasIndex?: boolean
  isRebuildingRetrievalIndex?: boolean
  lastRebuildResult?: RebuildRetrievalResult | null
}

const INTENT_LABELS: Record<NovelTaskIntent, string> = {
  write_chapter: "写新章节",
  continue_chapter: "续写章节",
  rewrite_chapter: "改写章节",
  polish_chapter: "润色章节",
  review_chapter: "AI 审稿",
  lint_chapter: "连贯性检查",
  generate_outline: "生成大纲",
  search_plot: "剧情搜索",
  extract_memory: "章节摄取",
  character_query: "人物查询",
  foreshadowing_query: "伏笔查询",
  timeline_query: "时间线查询",
  setting_query: "设定查询",
  general_chat: "随便聊聊",
  story_framework_generate: "故事框架生成",
  multi_agent_simulate: "多智能体推演",
  character_interview: "角色采访",
}

const ROUTE_SOURCE_LABELS: Record<RouteSource, string> = {
  default: "默认路由",
  project: "项目配置",
  project_with_feature: "项目特性配置",
}

type TabType = "overview" | "timeline"

function formatDuration(startedAt: number, finishedAt?: number): string {
  const end = finishedAt || Date.now()
  const ms = end - startedAt
  if (ms <= 0) return "0ms"
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}m${secs}s`
}

function StatusBadge({ status }: { status: ContextTrace["status"] }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-blue-300/70 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:border-blue-800/60 dark:bg-blue-950/40 dark:text-blue-300">
        <Loader2 className="h-3 w-3 animate-spin" />
        运行中
      </span>
    )
  }
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-green-300/70 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:border-green-800/60 dark:bg-green-950/40 dark:text-green-300">
        <CheckCircle2 className="h-3 w-3" />
        已完成
      </span>
    )
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-300/70 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-300">
        <XCircle className="h-3 w-3" />
        出错
      </span>
    )
  }
  return null
}

function InfoRow({
  icon: Icon,
  label,
  value,
  valueClassName,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: React.ReactNode
  valueClassName?: string
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className={cn("text-sm font-medium", valueClassName)}>{value}</div>
      </div>
    </div>
  )
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100)
  let colorClass = "bg-green-500"
  let textColorClass = "text-green-600 dark:text-green-400"
  if (confidence < 0.6) {
    colorClass = "bg-red-500"
    textColorClass = "text-red-600 dark:text-red-400"
  } else if (confidence < 0.8) {
    colorClass = "bg-amber-500"
    textColorClass = "text-amber-600 dark:text-amber-400"
  }

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all duration-500", colorClass)}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className={cn("text-xs font-medium tabular-nums", textColorClass)}>{percent}%</span>
    </div>
  )
}

function getDataSourceIcon(category: DataSourceCategory) {
  switch (category) {
    case "outline":
      return BookOpen
    case "recent_summaries":
      return FileText
    case "chapter_content":
      return FileText
    case "character_states":
      return Users
    case "foreshadowing":
      return Sparkles
    case "timeline":
      return ClockIcon
    case "settings":
      return Settings
    case "soul":
      return Heart
    case "memory":
      return Brain
    case "graph":
      return Network
    case "plot_tools":
      return Wand2
    case "revision":
      return Edit3
    default:
      return Database
  }
}

function SourceCategoryTag({ category }: { category: DataSourceCategory }) {
  const Icon = getDataSourceIcon(category)
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
      <Icon className="h-3 w-3" />
      {DATA_SOURCE_CATEGORY_LABELS[category] || category}
    </span>
  )
}

function BudgetBar({ used, limit }: { used: number; limit: number }) {
  const percent = Math.min(100, Math.round((used / limit) * 100))
  let colorClass = "bg-green-500"
  if (percent > 80) colorClass = "bg-red-500"
  else if (percent > 60) colorClass = "bg-amber-500"

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">字符使用</span>
        <span className="font-medium tabular-nums">
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", colorClass)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

function RetrievalIndexSection({
  projectPath,
  hasIndex,
  isRebuilding,
  lastResult,
  onRebuild,
}: {
  projectPath?: string | null
  hasIndex?: boolean
  isRebuilding?: boolean
  lastResult?: RebuildRetrievalResult | null
  onRebuild?: () => Promise<RebuildRetrievalResult>
}) {
  const [localIsRebuilding, setLocalIsRebuilding] = useState(false)
  const [localResult, setLocalResult] = useState<RebuildRetrievalResult | null>(null)

  const effectiveIsRebuilding = isRebuilding ?? localIsRebuilding
  const effectiveResult = lastResult ?? localResult

  const handleRebuild = async () => {
    if (!onRebuild || !projectPath || effectiveIsRebuilding) return
    setLocalIsRebuilding(true)
    setLocalResult(null)
    try {
      const result = await onRebuild()
      setLocalResult(result)
    } catch (e) {
      setLocalResult({
        success: false,
        error: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setLocalIsRebuilding(false)
    }
  }

  const disabled = !projectPath || effectiveIsRebuilding

  return (
    <div className="py-2">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
          <Database className="h-3.5 w-3.5" />
        </div>
        <div className="text-[11px] font-medium text-foreground">
          检索索引
        </div>
        {hasIndex !== undefined && (
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
            hasIndex
              ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
          }`}>
            {hasIndex ? "已存在" : "未创建"}
          </span>
        )}
      </div>
      <div className="ml-9 space-y-2">
        <button
          type="button"
          onClick={handleRebuild}
          disabled={disabled}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
            disabled
              ? "cursor-not-allowed bg-muted text-muted-foreground/50"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          {effectiveIsRebuilding ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              重建中...
            </>
          ) : (
            <>
              <RefreshCw className="h-3 w-3" />
              重建索引
            </>
          )}
        </button>

        {!projectPath && (
          <div className="text-[11px] text-amber-600 dark:text-amber-400">
            请先打开项目后再使用此功能
          </div>
        )}

        {effectiveResult && (
          <div className={cn(
            "rounded-md border p-2 text-[11px]",
            effectiveResult.success
              ? "border-green-200 bg-green-50/60 text-green-800 dark:border-green-900/40 dark:bg-green-950/20 dark:text-green-300"
              : "border-red-200 bg-red-50/60 text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300"
          )}>
            {effectiveResult.success ? (
              <div className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                <span>重建成功，共 {effectiveResult.chapterCount ?? 0} 章</span>
              </div>
            ) : (
              <div className="flex items-start gap-1">
                <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>重建失败：{effectiveResult.error ?? "未知错误"}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function OverviewTab({
  contextInfo,
  projectPath,
  onUpgraded,
  onRebuildRetrievalIndex,
  retrievalIndexHasIndex,
  isRebuildingRetrievalIndex,
  lastRebuildResult,
}: {
  contextInfo: TraceContextInfo | undefined
  projectPath?: string | null
  onUpgraded?: () => void
  onRebuildRetrievalIndex?: () => Promise<RebuildRetrievalResult>
  retrievalIndexHasIndex?: boolean
  isRebuildingRetrievalIndex?: boolean
  lastRebuildResult?: RebuildRetrievalResult | null
}) {
  const [upgradeStatus, setUpgradeStatus] = useState<"idle" | "confirming" | "loading" | "success" | "error">("idle")
  const [upgradeError, setUpgradeError] = useState<string | null>(null)

  const handleUpgradeClassification = async () => {
    if (!projectPath) return
    setUpgradeStatus("loading")
    setUpgradeError(null)
    try {
      const currentConfig = await loadProjectClassification(projectPath)
      if (!currentConfig) {
        throw new Error("未找到 classification.md")
      }
      const upgradedConfig = upgradeClassificationConfig(currentConfig)
      await writeProjectClassification(projectPath, upgradedConfig)
      setUpgradeStatus("success")
      onUpgraded?.()
    } catch (e) {
      setUpgradeStatus("error")
      setUpgradeError(e instanceof Error ? e.message : String(e))
    }
  }
  if (!contextInfo) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Layers className="mb-3 h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">上下文信息尚未生成</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <InfoRow
        icon={Target}
        label="意图识别结果"
        value={
          <div className="space-y-1">
            <div>{INTENT_LABELS[contextInfo.intent] || contextInfo.intent}</div>
            <ConfidenceBar confidence={contextInfo.confidence} />
          </div>
        }
      />

      <div className="my-1 h-px bg-border/60" />

      <InfoRow
        icon={Route}
        label="路由来源"
        value={ROUTE_SOURCE_LABELS[contextInfo.routeSource] || contextInfo.routeSource}
      />

      {contextInfo.selectedCapabilities && contextInfo.selectedCapabilities.length > 0 && (
        <>
          <div className="my-1 h-px bg-border/60" />
          <div className="py-2">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400">
                <Zap className="h-3.5 w-3.5" />
              </div>
              <div className="text-[11px] font-medium text-foreground">
                启用能力
              </div>
              <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                {contextInfo.selectedCapabilities.length}
              </span>
            </div>
            <div className="ml-9 space-y-1.5">
              {contextInfo.selectedCapabilities.map((capability) => (
                <div key={capability.id} className="rounded-md border bg-background px-2 py-1.5">
                  <div className="mb-1 text-xs font-medium text-foreground">{capability.name}</div>
                  <div className="flex flex-wrap gap-1">
                    {[capability.kind, capability.permission, capability.source].filter(Boolean).map((tag, index) => (
                      <span
                        key={`${capability.id}-${tag}-${index}`}
                        className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  {capability.reason && (
                    <div className="mt-1 text-[11px] text-muted-foreground">{capability.reason}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {contextInfo.selectedSkills && contextInfo.selectedSkills.length > 0 && (
        <>
          <div className="my-1 h-px bg-border/60" />
          <div className="py-2">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <div className="text-[11px] font-medium text-foreground">
                使用 Skill
              </div>
              <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                {contextInfo.selectedSkills.length}
              </span>
            </div>
            <div className="ml-9 space-y-1.5">
              {contextInfo.selectedSkills.map((skill) => (
                <div key={skill.id} className="rounded-md border bg-background px-2 py-1.5">
                  <div className="mb-1 text-xs font-medium text-foreground">{skill.name}</div>
                  <div className="flex flex-wrap gap-1">
                    {[...skill.kind, ...skill.stages, skill.source].map((tag, index) => (
                      <span
                        key={`${skill.id}-${tag}-${index}`}
                        className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {contextInfo.webSearches && contextInfo.webSearches.length > 0 && (
        <>
          <div className="my-1 h-px bg-border/60" />
          <div className="py-2">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400">
                <Network className="h-3.5 w-3.5" />
              </div>
              <div className="text-[11px] font-medium text-foreground">
                外部搜索
              </div>
              <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                {contextInfo.webSearches.length}
              </span>
            </div>
            <div className="ml-9 space-y-1.5">
              {contextInfo.webSearches.map((search, index) => (
                <div key={`${search.query}-${search.searchedAt}-${index}`} className="rounded-md border bg-background px-2 py-1.5">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs font-medium text-foreground">
                    <span>{search.query}</span>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {search.provider}
                    </span>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {search.resultCount} 条结果
                    </span>
                  </div>
                  {search.sources.length > 0 && (
                    <div className="text-[11px] text-muted-foreground">
                      来源：{search.sources.join("、")}
                    </div>
                  )}
                  {search.message && (
                    <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                      {search.message}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {contextInfo.mcpCalls && contextInfo.mcpCalls.length > 0 && (
        <>
          <div className="my-1 h-px bg-border/60" />
          <div className="py-2">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cyan-100 text-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-400">
                <Network className="h-3.5 w-3.5" />
              </div>
              <div className="text-[11px] font-medium text-foreground">
                MCP 调用
              </div>
              <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-medium text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300">
                {contextInfo.mcpCalls.length}
              </span>
            </div>
            <div className="ml-9 space-y-1.5">
              {contextInfo.mcpCalls.map((call, index) => (
                <div key={`${call.serverId}-${call.toolName}-${call.calledAt}-${index}`} className="rounded-md border bg-background px-2 py-1.5">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs font-medium text-foreground">
                    <span>{call.serverName}</span>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {call.toolName}
                    </span>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {call.status}
                    </span>
                  </div>
                  {call.summary && (
                    <div className="text-[11px] text-muted-foreground">{call.summary}</div>
                  )}
                  {call.message && (
                    <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{call.message}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="my-1 h-px bg-border/60" />

      <div className="py-2">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-green-100 text-green-600 dark:bg-green-950/40 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
          </div>
          <div className="text-[11px] font-medium text-foreground">
            已加载数据源
          </div>
          <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
            {contextInfo.loadedSources.length}
          </span>
        </div>
        <div className="ml-9 flex flex-wrap gap-1.5">
          {contextInfo.loadedSources.length > 0 ? (
            contextInfo.loadedSources.map((cat) => (
              <SourceCategoryTag key={cat} category={cat} />
            ))
          ) : (
            <span className="text-[11px] text-muted-foreground/70">无</span>
          )}
        </div>
      </div>

      {contextInfo.blockedSources.length > 0 && (
        <>
          <div className="my-1 h-px bg-border/60" />
          <div className="py-2">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400">
                <ShieldAlert className="h-3.5 w-3.5" />
              </div>
              <div className="text-[11px] font-medium text-foreground">
                已禁载数据源
              </div>
              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
                {contextInfo.blockedSources.length}
              </span>
            </div>
            <div className="ml-9 flex flex-wrap gap-1.5">
              {contextInfo.blockedSources.map((cat) => {
                const Icon = getDataSourceIcon(cat)
                return (
                  <span
                    key={cat}
                    className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-600 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400"
                  >
                    <Icon className="h-3 w-3" />
                    {DATA_SOURCE_CATEGORY_LABELS[cat] || cat}
                  </span>
                )
              })}
            </div>
          </div>
        </>
      )}

      {contextInfo.retrievalHits.length > 0 && (
        <>
          <div className="my-1 h-px bg-border/60" />
          <InfoRow
            icon={TrendingUp}
            label="检索命中数"
            value={`${contextInfo.retrievalHits.length} 条结果`}
          />
        </>
      )}

      {contextInfo.contextBudget && (
        <>
          <div className="my-1 h-px bg-border/60" />
          <div className="py-2">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Layers className="h-3.5 w-3.5" />
              </div>
              <div className="text-[11px] text-muted-foreground">字符预算使用</div>
            </div>
            <div className="ml-9">
              <BudgetBar
                used={contextInfo.contextBudget.used}
                limit={contextInfo.contextBudget.limit}
              />
            </div>
          </div>
        </>
      )}

      {contextInfo.resultProtocol && (
        <>
          <div className="my-1 h-px bg-border/60" />
          <div className="py-2">
            <div className="mb-2 flex items-center gap-2">
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                contextInfo.resultProtocol.valid
                  ? "bg-green-100 text-green-600 dark:bg-green-950/40 dark:text-green-400"
                  : "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400"
              }`}>
                {contextInfo.resultProtocol.valid
                  ? <CheckCircle2 className="h-3.5 w-3.5" />
                  : <XCircle className="h-3.5 w-3.5" />}
              </div>
              <div className="text-[11px] text-muted-foreground">
                输出协议校验
                <span className={`ml-1.5 font-medium ${
                  contextInfo.resultProtocol.valid
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }`}>
                  {contextInfo.resultProtocol.valid ? "通过" : "未通过"}
                </span>
              </div>
            </div>
            <div className="ml-9 space-y-2">
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                {contextInfo.resultProtocol.wordCount != null && (
                  <span>字数：{contextInfo.resultProtocol.wordCount.toLocaleString()}</span>
                )}
                {contextInfo.resultProtocol.nodeCount != null && (
                  <span>节点数：{contextInfo.resultProtocol.nodeCount}</span>
                )}
                {contextInfo.resultProtocol.hasFrontmatter != null && (
                  <span>
                    Frontmatter：{contextInfo.resultProtocol.hasFrontmatter ? "有" : "无"}
                  </span>
                )}
                {contextInfo.resultProtocol.hasTitle != null && (
                  <span>
                    标题：{contextInfo.resultProtocol.hasTitle ? "有" : "无"}
                  </span>
                )}
              </div>
              {contextInfo.resultProtocol.warnings.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2 dark:border-amber-900/40 dark:bg-amber-950/20">
                  <div className="mb-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    警告（{contextInfo.resultProtocol.warnings.length}）
                  </div>
                  <ul className="space-y-0.5">
                    {contextInfo.resultProtocol.warnings.map((w, i) => (
                      <li key={i} className="text-[11px] text-amber-800 dark:text-amber-300">
                        · {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {contextInfo.resultProtocol.errors.length > 0 && (
                <div className="rounded-md border border-red-200 bg-red-50/60 p-2 dark:border-red-900/40 dark:bg-red-950/20">
                  <div className="mb-1 text-[11px] font-medium text-red-700 dark:text-red-400">
                    错误（{contextInfo.resultProtocol.errors.length}）
                  </div>
                  <ul className="space-y-0.5">
                    {contextInfo.resultProtocol.errors.map((e, i) => (
                      <li key={i} className="text-[11px] text-red-800 dark:text-red-300">
                        · {e}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      
      {contextInfo.postWriteCheck && (
        <>
          <div className="my-1 h-px bg-border/60" />
          <div className="py-2">
            <div className="text-xs font-medium text-foreground">
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                写后自检
              </span>
              {contextInfo.postWriteCheckMeta?.source === "ai" && (
                <span className="ml-2 inline-flex items-center rounded-full border border-blue-300/70 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:border-blue-800/60 dark:bg-blue-950/40 dark:text-blue-300">
                  AI 推理
                </span>
              )}
              {contextInfo.postWriteCheckMeta?.source === "rule" && (
                <span className="ml-2 inline-flex items-center rounded-full border border-gray-300/70 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-700 dark:border-gray-800/60 dark:bg-gray-950/40 dark:text-gray-300">
                  规则检查
                </span>
              )}
              <span className="ml-2 text-muted-foreground">
                {contextInfo.postWriteCheck.passedCount}/{contextInfo.postWriteCheck.totalCount} 通过
                {contextInfo.postWriteCheck.allPassed
                  ? <span className="ml-1 text-emerald-600 dark:text-emerald-400">全部通过</span>
                  : <span className="ml-1 text-amber-600 dark:text-amber-400">有未通过项</span>}
              </span>
            </div>
            {contextInfo.postWriteCheckMeta?.fallbackReason && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                降级原因：{contextInfo.postWriteCheckMeta.fallbackReason}
              </div>
            )}
            <div className="mt-1.5 space-y-1.5">
              {contextInfo.postWriteCheck.items.map((item) => (
                <div key={item.name}>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {item.passed
                      ? <span className="text-emerald-500 dark:text-emerald-400">✓</span>
                      : <span className="text-red-500 dark:text-red-400">✗</span>}
                    <span>{item.name}</span>
                    {!item.passed && <span className="text-muted-foreground/70">: {item.detail}</span>}
                  </div>
                  {item.evidence && (
                    <div className="ml-5 mt-1 text-[11px] text-muted-foreground">
                      <span className="font-medium">依据：</span>{item.evidence}
                    </div>
                  )}
                  {item.suggestion && (
                    <div className="ml-5 mt-0.5 text-[11px] text-muted-foreground">
                      <span className="font-medium">建议：</span>{item.suggestion}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

{contextInfo.classificationVersion && contextInfo.classificationVersion.needsUpgrade && (
        <>
          <div className="my-1 h-px bg-border/60" />
          <div className="py-2">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
              </div>
              <div className="text-[11px] text-muted-foreground">分类路由版本</div>
            </div>
            <div className="ml-9 rounded-md border border-amber-200 bg-amber-50/60 p-2 text-[12px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
              <div className="mb-2">
                classification.md 版本过旧（当前 v{contextInfo.classificationVersion.currentVersion}，最新 v{contextInfo.classificationVersion.latestVersion}），可能缺少新增的意图路由配置。
              </div>
              {upgradeStatus === "idle" && projectPath && (
                <button
                  type="button"
                  onClick={() => setUpgradeStatus("confirming")}
                  className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500"
                >
                  <RefreshCw className="h-3 w-3" />
                  一键升级到最新版本
                </button>
              )}
              {upgradeStatus === "confirming" && (
                <div className="space-y-2">
                  <div className="text-[11px]">
                    确定要升级 classification.md 吗？升级会在现有配置基础上补充新增的意图路由，不会修改你已有的自定义配置。
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleUpgradeClassification}
                      className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      确认升级
                    </button>
                    <button
                      type="button"
                      onClick={() => setUpgradeStatus("idle")}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                      取消
                    </button>
                  </div>
                </div>
              )}
              {upgradeStatus === "loading" && (
                <div className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  正在升级...
                </div>
              )}
              {upgradeStatus === "success" && (
                <div className="inline-flex items-center gap-1 text-[11px] text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-3 w-3" />
                  升级成功！下次 AI 会话将使用最新路由配置
                </div>
              )}
              {upgradeStatus === "error" && upgradeError && (
                <div className="text-[11px] text-red-700 dark:text-red-400">
                  升级失败：{upgradeError}
                </div>
              )}
              {!projectPath && upgradeStatus === "idle" && (
                <div className="text-[11px] text-amber-700 dark:text-amber-300">
                  请在项目中使用此功能
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {contextInfo.fallbackReason && !contextInfo.classificationVersion?.needsUpgrade && (
        <>
          <div className="my-1 h-px bg-border/60" />
          <div className="py-2">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
              </div>
              <div className="text-[11px] text-muted-foreground">兜底/降级原因</div>
            </div>
            <div className="ml-9 rounded-md border border-amber-200 bg-amber-50/60 p-2 text-[12px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
              {contextInfo.fallbackReason}
            </div>
          </div>
        </>
      )}

      {contextInfo.fallbackReason && contextInfo.classificationVersion?.needsUpgrade && (
        <div className="ml-9 mt-1 rounded-md border border-amber-200 bg-amber-50/60 p-2 text-[12px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
          {contextInfo.fallbackReason}
        </div>
      )}

      <div className="my-1 h-px bg-border/60" />
      <RetrievalIndexSection
        projectPath={projectPath}
        hasIndex={retrievalIndexHasIndex}
        isRebuilding={isRebuildingRetrievalIndex}
        lastResult={lastRebuildResult}
        onRebuild={onRebuildRetrievalIndex}
      />
    </div>
  )
}

function TimelineTab({ trace }: { trace: ContextTrace }) {
  if (trace.toolCalls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Zap className="mb-3 h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">暂无工具调用记录</p>
      </div>
    )
  }

  const adaptedCalls = trace.toolCalls.map((call) => ({
    ...call,
    result: call.result ?? "",
    finishedAt: call.finishedAt ?? call.startedAt,
  }))

  return (
    <div className="py-1">
      <ToolCallTimeline toolCalls={adaptedCalls as any} defaultExpanded={false} />
    </div>
  )
}

function CollapsiblePanel({
  title,
  icon: Icon,
  children,
  defaultCollapsed = false,
  rightContent,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  defaultCollapsed?: boolean
  rightContent?: React.ReactNode
}) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState<number | "auto">("auto")

  useEffect(() => {
    if (contentRef.current && !isCollapsed) {
      setContentHeight(contentRef.current.scrollHeight)
    }
  }, [children, isCollapsed])

  return (
    <div className="overflow-hidden rounded-lg border bg-background shadow-lg">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex flex-1 items-center gap-2.5 text-left"
        >
          <Icon className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{title}</span>
          {rightContent}
          <div className="ml-auto flex items-center gap-2">
            {isCollapsed ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-300" />
            ) : (
              <ChevronUp className="h-4 w-4 text-muted-foreground transition-transform duration-300" />
            )}
          </div>
        </button>
      </div>
      <div
        className="transition-all duration-300 ease-in-out overflow-hidden"
        style={{
          maxHeight: isCollapsed ? 0 : contentHeight === "auto" ? "1000px" : `${contentHeight}px`,
          opacity: isCollapsed ? 0 : 1,
        }}
      >
        <div ref={contentRef}>{children}</div>
      </div>
    </div>
  )
}

function CopyTraceButton({ trace }: { trace: ContextTrace }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      const json = JSON.stringify(trace, null, 2)
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("复制失败:", err)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      title="复制调试信息"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-green-500" />
          <span className="text-green-600 dark:text-green-400">已复制</span>
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          <span>复制调试信息</span>
        </>
      )}
    </button>
  )
}

export function ContextTracePanel({
  trace,
  projectPath,
  onClose,
  className,
  onRebuildRetrievalIndex,
  retrievalIndexHasIndex,
  isRebuildingRetrievalIndex,
  lastRebuildResult,
}: ContextTracePanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>("overview")

  if (!trace) return null

  const duration = formatDuration(trace.startedAt, trace.finishedAt)

  return (
    <div className={cn("", className)}>
      <CollapsiblePanel
        title="上下文追踪"
        icon={Layers}
        defaultCollapsed={false}
        rightContent={
          <div className="flex items-center gap-2">
            <StatusBadge status={trace.status} />
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span className="tabular-nums">{duration}</span>
            </div>
            <CopyTraceButton trace={trace} />
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="关闭"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        }
      >
        <div className="flex border-b bg-muted/30">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px",
              activeTab === "overview"
                ? "text-primary border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground hover:bg-accent/30",
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            概览
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("timeline")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px",
              activeTab === "timeline"
                ? "text-primary border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground hover:bg-accent/30",
            )}
          >
            <Zap className="h-3.5 w-3.5" />
            工具调用时间线
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
              {trace.toolCalls.length}
            </span>
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto px-4 py-2">
          {activeTab === "overview" ? (
            <OverviewTab
              contextInfo={trace.contextInfo}
              projectPath={projectPath}
              onRebuildRetrievalIndex={onRebuildRetrievalIndex}
              retrievalIndexHasIndex={retrievalIndexHasIndex}
              isRebuildingRetrievalIndex={isRebuildingRetrievalIndex}
              lastRebuildResult={lastRebuildResult}
            />
          ) : (
            <TimelineTab trace={trace} />
          )}
        </div>
      </CollapsiblePanel>
    </div>
  )
}
