import { useMemo, useState } from "react"
import { BookOpen, ChevronDown, ChevronRight, Loader2, CheckCircle2, Pencil, XCircle, Zap, Cpu, Minimize2, Maximize2, AlertTriangle, Search, Filter } from "lucide-react"
import type { AgentRunRecord } from "@/lib/agent/types"
import { cn } from "@/lib/utils"

export type ToolCallRecord = AgentRunRecord["toolCalls"][number]

interface ToolCallTimelineProps {
  toolCalls: ToolCallRecord[] | undefined
  onConfirmSave?: (call: ToolCallRecord & { preview?: string }) => void
  onReject?: (call: ToolCallRecord & { preview?: string }) => void
  defaultExpanded?: boolean
}

const READ_TOOLS = new Set([
  "read_chapter",
  "read_outline",
  "read_memory",
  "read_deduction",
  "read_chat_history",
  "read_outline_history",
  "search_chapters",
  "list_chapters",
  "list_outlines",
  "list_memories",
  "list_deductions",
])

const WRITE_TOOLS = new Set([
  "write_chapter",
  "write_outline_node",
  "write_memory",
])

const ACTION_TOOLS = new Set([
  "apply_skill",
])

const VIRTUAL_TOOLS = new Set([
  "route_task",
  "load_context",
  "trim_context",
])

function getToolCategory(name: string): "read" | "write" | "action" | "virtual" {
  if (READ_TOOLS.has(name)) return "read"
  if (WRITE_TOOLS.has(name)) return "write"
  if (ACTION_TOOLS.has(name)) return "action"
  if (VIRTUAL_TOOLS.has(name)) return "virtual"
  return "read"
}

function formatWordCount(content?: unknown): string {
  if (typeof content !== "string") return ""
  const count = content.length
  return count > 0 ? `(${count}字)` : ""
}

function formatDuration(startedAt: number, finishedAt: number): string {
  const ms = finishedAt - startedAt
  if (ms <= 0) return ""
  if (ms < 1000) return `（${(ms / 1000).toFixed(1)}s）`
  if (ms < 60000) return `（${(ms / 1000).toFixed(1)}s）`
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `（${minutes}m${secs}s）`
}

export function getToolCallDescription(name: string, params: Record<string, unknown>): string {
  switch (name) {
    case "read_chapter": {
      const target = params.name || params.path
      return `读取章节《${target}》`
    }
    case "read_outline": {
      const target = params.name || params.path
      return `读取大纲《${target}》`
    }
    case "read_memory":
      return `读取记忆「${params.name}」`
    case "read_deduction":
      return `读取推演结果「${params.name}」`
    case "read_chat_history": {
      const target = params.conversationId || params.conversationTitle
      return `读取会话历史「${target}」`
    }
    case "read_outline_history":
      return `读取大纲会话「${params.conversationId}」`
    case "search_chapters":
      return `搜索章节关键词「${params.keyword}」`
    case "list_chapters":
      return "列出所有章节"
    case "list_outlines":
      return "列出所有大纲"
    case "list_memories":
      return "列出所有记忆"
    case "list_deductions":
      return "列出所有推演结果"
    case "write_chapter":
      return `写入章节《${params.name}》${formatWordCount(params.content)}`
    case "write_outline_node":
      return `写入大纲节点「${params.nodeTitle}」到「${params.outlineName}」`
    case "write_memory":
      return `写入记忆「${params.name}」${formatWordCount(params.content)}`
    case "apply_skill": {
      const target = params.skillName || params.skillId
      return `应用技能「${target}」`
    }
    case "route_task":
      return `任务意图识别：${params.intent || "识别中"}`
    case "load_context":
      return `加载小说上下文${params.chapterNumber ? `（第${params.chapterNumber}章）` : ""}`
    case "trim_context":
      return `裁剪上下文至 ${params.targetChars || "默认"} 字符`
    default:
      return name
  }
}

function getCategoryStyles(category: "read" | "write" | "action" | "virtual") {
  switch (category) {
    case "read":
      return {
        dot: "bg-blue-500",
        line: "bg-blue-200/60 dark:bg-blue-900/30",
        card: "border-blue-200 bg-blue-50/50 dark:border-blue-900/40 dark:bg-blue-950/20",
        cardBorderStyle: "border-solid",
        icon: "text-blue-500",
        text: "text-blue-900 dark:text-blue-300",
        muted: "text-blue-700/70 dark:text-blue-400/70",
      }
    case "write":
      return {
        dot: "bg-amber-500",
        line: "bg-amber-200/60 dark:bg-amber-900/30",
        card: "border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20",
        cardBorderStyle: "border-solid",
        icon: "text-amber-500",
        text: "text-amber-900 dark:text-amber-300",
        muted: "text-amber-700/70 dark:text-amber-400/70",
      }
    case "action":
      return {
        dot: "bg-purple-500",
        line: "bg-purple-200/60 dark:bg-purple-900/30",
        card: "border-purple-200 bg-purple-50/50 dark:border-purple-900/40 dark:bg-purple-950/20",
        cardBorderStyle: "border-solid",
        icon: "text-purple-500",
        text: "text-purple-900 dark:text-purple-300",
        muted: "text-purple-700/70 dark:text-purple-400/70",
      }
    case "virtual":
      return {
        dot: "bg-cyan-500",
        line: "bg-cyan-200/40 dark:bg-cyan-900/20",
        card: "border-cyan-300/60 bg-cyan-50/30 dark:border-cyan-800/40 dark:bg-cyan-950/10",
        cardBorderStyle: "border-dashed",
        icon: "text-cyan-500",
        text: "text-cyan-900 dark:text-cyan-300",
        muted: "text-cyan-700/70 dark:text-cyan-400/70",
      }
  }
}

function ToolCallIcon({ category, status }: { category: "read" | "write" | "action" | "virtual"; status: string }) {
  if (status === "error") {
    return <XCircle className="h-4 w-4 shrink-0 text-red-500" />
  }
  if (status === "cancelled") {
    return <XCircle className="h-4 w-4 shrink-0 text-muted-foreground/60" />
  }
  if (status === "running") {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
  }
  if (status === "done") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
  }
  if (status === "approval_required") {
    return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
  }
  switch (category) {
    case "read":
      return <BookOpen className="h-4 w-4 shrink-0 text-blue-500" />
    case "write":
      return <Pencil className="h-4 w-4 shrink-0 text-amber-500" />
    case "action":
      return <Zap className="h-4 w-4 shrink-0 text-purple-500" />
    case "virtual":
      return <Cpu className="h-4 w-4 shrink-0 text-cyan-500" />
  }
}

function StatusBadge({ status }: { status: string }) {
  if (status === "running") {
    return (
      <span className="rounded border border-blue-300/70 bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800 dark:border-blue-800/60 dark:bg-blue-950/50 dark:text-blue-300">
        运行中
      </span>
    )
  }
  if (status === "done") {
    return (
      <span className="rounded border border-green-300/70 bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800 dark:border-green-800/60 dark:bg-green-950/50 dark:text-green-300">
        完成
      </span>
    )
  }
  if (status === "error") {
    return (
      <span className="rounded border border-red-300/70 bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:border-red-800/60 dark:bg-red-950/50 dark:text-red-300">
        错误
      </span>
    )
  }
  if (status === "cancelled") {
    return (
      <span className="rounded border border-muted-foreground/30 bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        已取消
      </span>
    )
  }
  if (status === "approval_required") {
    return (
      <span className="rounded border border-amber-300/70 bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-300">
        待确认
      </span>
    )
  }
  return null
}

function TimelineItem({
  call,
  expanded,
  onToggle,
  isLast,
  onConfirmSave,
  onReject,
}: {
  call: ToolCallRecord & { preview?: string }
  expanded: boolean
  onToggle: () => void
  isLast: boolean
  onConfirmSave?: (call: ToolCallRecord & { preview?: string }) => void
  onReject?: (call: ToolCallRecord & { preview?: string }) => void
}) {
  const category = useMemo(() => getToolCategory(call.name), [call.name])
  const styles = getCategoryStyles(category)
  const hasError = call.status === "error"
  const isCancelled = call.status === "cancelled"
  const isRunning = call.status === "running"
  const needsApproval = call.status === "approval_required"
  const isWriteTool = category === "write"
  const description = useMemo(
    () => getToolCallDescription(call.name, call.params),
    [call.name, call.params],
  )
  const duration = formatDuration(call.startedAt, call.finishedAt)

  const cardClass = hasError
    ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300 border-solid"
    : isCancelled
      ? "border-border/40 bg-muted/30 text-muted-foreground border-solid"
      : needsApproval
        ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300 border-solid"
        : `${styles.card} ${styles.cardBorderStyle}`

  return (
    <div className="relative flex w-full max-w-full min-w-0 gap-2">
      <div className="relative flex w-5 flex-col items-center">
        <div
          className={cn(
            "relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-background",
            isRunning ? "bg-transparent" : styles.dot,
          )}
        >
          {isRunning && <div className={cn("h-1.5 w-1.5 rounded-full animate-pulse", styles.dot)} />}
        </div>
        {!isLast && (
          <div className={cn("w-px flex-1", isRunning ? "bg-transparent" : styles.line)} />
        )}
      </div>

      <div className="min-w-0 flex-1 pb-3">
        <div className={cn("w-full max-w-full min-w-0 overflow-hidden rounded-lg border", cardClass)}>
          <button
            type="button"
            onClick={onToggle}
            className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-x-2 gap-y-1 px-3 py-2 text-left text-xs"
            aria-expanded={expanded}
          >
            <ToolCallIcon category={category} status={call.status} />
            <span className="min-w-0 truncate font-medium">{call.name}</span>
            <StatusBadge status={call.status} />
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="col-start-2 col-span-3 min-w-0 break-words text-muted-foreground">
              <span className="line-clamp-2">
                {description}
                {duration && <span className="ml-1 text-[10px] opacity-70">{duration}</span>}
              </span>
            </span>
          </button>
          {expanded && (
            <div
              className={cn(
                "max-h-40 overflow-y-auto overflow-x-hidden border-t px-3 py-2 text-[11px] whitespace-pre-wrap break-words leading-relaxed",
                hasError
                  ? "border-red-200/60 text-red-700 dark:border-red-900/30 dark:text-red-300/80"
                  : isCancelled
                    ? "border-muted/50 text-muted-foreground/80"
                    : needsApproval
                      ? "border-amber-200/60 text-amber-800 dark:border-amber-900/30 dark:text-amber-300/80"
                      : "border-border/50 text-muted-foreground",
              )}
            >
              {needsApproval && call.preview && (
                <div className="mb-1.5 rounded border border-amber-300/50 bg-amber-100/60 p-2 dark:border-amber-800/40 dark:bg-amber-900/20">
                  <div className="mb-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                    拟写入内容预览
                  </div>
                  <div className="whitespace-pre-wrap break-words font-mono text-[10px] text-amber-900 dark:text-amber-200">
                    {call.preview}
                  </div>
                </div>
              )}
              {call.result}
              {needsApproval && isWriteTool && onConfirmSave && onReject && (
                <div className="mt-2 flex gap-2 border-t border-amber-200/60 pt-2 dark:border-amber-900/30">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onConfirmSave(call)
                    }}
                    className="rounded bg-green-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-green-700"
                  >
                    确认保存
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onReject(call)
                    }}
                    className="rounded border border-muted-foreground/30 bg-background px-3 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent"
                  >
                    放弃
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function ToolCallTimeline({
  toolCalls,
  onConfirmSave,
  onReject,
  defaultExpanded = false,
}: ToolCallTimelineProps) {
  const [allExpanded, setAllExpanded] = useState(defaultExpanded)
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({})
  const [searchQuery, setSearchQuery] = useState("")
  const [activeFilter, setActiveFilter] = useState<"all" | "read" | "write" | "action" | "virtual">("all")
  const [errorOnly, setErrorOnly] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const safeToolCalls = toolCalls ?? []

  const filteredToolCalls = useMemo(() => {
    return safeToolCalls.filter((call) => {
      if (errorOnly && call.status !== "error") return false
      const category = getToolCategory(call.name)
      if (activeFilter !== "all" && category !== activeFilter) return false
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        return call.name.toLowerCase().includes(query) ||
          (typeof call.result === "string" && call.result.toLowerCase().includes(query))
      }
      return true
    })
  }, [safeToolCalls, searchQuery, activeFilter, errorOnly])

  const errorCount = useMemo(() => {
    return safeToolCalls.filter((call) => call.status === "error").length
  }, [safeToolCalls])

  if (safeToolCalls.length === 0) return null

  const filterOptions: Array<{ key: "all" | "read" | "write" | "action" | "virtual"; label: string }> = [
    { key: "all", label: "全部" },
    { key: "virtual", label: "虚拟" },
    { key: "read", label: "读取" },
    { key: "write", label: "写入" },
    { key: "action", label: "动作" },
  ]

  const getExpanded = (id: string) => {
    if (id in expandedMap) return expandedMap[id]
    return allExpanded
  }

  const toggleExpand = (id: string) => {
    setExpandedMap((prev) => ({
      ...prev,
      [id]: !getExpanded(id),
    }))
  }

  const toggleAll = () => {
    const newAllExpanded = !allExpanded
    setAllExpanded(newAllExpanded)
    setExpandedMap({})
  }

  const allExpandedCount = filteredToolCalls.filter((call) => getExpanded(call.id)).length
  const isAllExpanded = filteredToolCalls.length > 0 && allExpandedCount === filteredToolCalls.length

  return (
    <div className="mb-2 max-w-full overflow-hidden rounded-md border-l-4 border-blue-500 bg-blue-50/50 px-3 py-2.5 dark:bg-blue-950/20">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-400">
          <Zap className="h-3.5 w-3.5" />
          <span>AI 工具调用</span>
          <span className="text-[10px] font-normal text-blue-600/70 dark:text-blue-400/70">
            ({filteredToolCalls.length}/{safeToolCalls.length})
          </span>
          {errorCount > 0 && (
            <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {errorCount} 错误
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] hover:bg-blue-100/60 dark:hover:bg-blue-900/30",
              showFilters || activeFilter !== "all" || errorOnly
                ? "text-blue-700 dark:text-blue-300"
                : "text-blue-600/70 dark:text-blue-400/70"
            )}
          >
            <Filter className="h-3 w-3" />
            <span>过滤</span>
          </button>
          <button
            type="button"
            onClick={toggleAll}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-blue-600 hover:bg-blue-100/60 dark:text-blue-400 dark:hover:bg-blue-900/30"
          >
            {isAllExpanded ? (
              <>
                <Minimize2 className="h-3 w-3" />
                <span>全部折叠</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3 w-3" />
                <span>全部展开</span>
              </>
            )}
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="mb-2 space-y-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-blue-500/50" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索工具名称或结果..."
              className="w-full rounded-md border border-blue-200/60 bg-white/70 py-1 pl-7 pr-2 text-[11px] text-blue-900 placeholder-blue-500/50 outline-none focus:border-blue-400 dark:border-blue-800/40 dark:bg-blue-950/30 dark:text-blue-100 dark:placeholder-blue-400/40"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {filterOptions.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setActiveFilter(opt.key)}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[10px] transition-colors",
                  activeFilter === opt.key
                    ? "bg-blue-500 text-white"
                    : "bg-blue-100/60 text-blue-700 hover:bg-blue-200/60 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                )}
              >
                {opt.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setErrorOnly(!errorOnly)}
              className={cn(
                "rounded-md px-2 py-0.5 text-[10px] transition-colors",
                errorOnly
                  ? "bg-red-500 text-white"
                  : "bg-red-100/60 text-red-700 hover:bg-red-200/60 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50"
              )}
            >
              <XCircle className="inline h-3 w-3 mr-0.5 align-[-2px]" />
              只看错误
            </button>
          </div>
        </div>
      )}

      <div className="relative">
        {filteredToolCalls.length === 0 ? (
          <div className="py-6 text-center text-[11px] text-blue-500/60 dark:text-blue-400/50">
            没有匹配的工具调用
          </div>
        ) : (
          filteredToolCalls.map((call, index) => (
            <TimelineItem
              key={call.id}
              call={call}
              expanded={getExpanded(call.id)}
              onToggle={() => toggleExpand(call.id)}
              isLast={index === filteredToolCalls.length - 1}
              onConfirmSave={onConfirmSave}
              onReject={onReject}
            />
          ))
        )}
      </div>
    </div>
  )
}
