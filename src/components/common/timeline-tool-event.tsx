import { memo, useState } from "react"
import {
  Ban,
  Check,
  CircleAlert,
  CircleEllipsis,
  CircleX,
  LoaderCircle,
  Pencil,
  Search,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { ToolCallEventItem, TimelineToolCategory } from "./timeline-types"

interface ToolCallEventProps {
  event: ToolCallEventItem
  compact?: boolean
}

const CATEGORY_ICON: Record<TimelineToolCategory, LucideIcon> = {
  read: Search,
  write: Pencil,
  action: Wrench,
  virtual: CircleEllipsis,
}

const CATEGORY_BAR: Record<TimelineToolCategory, string> = {
  read: "border-yellow-400/50",
  write: "border-red-400/50",
  action: "border-purple-400/50",
  virtual: "border-gray-400/30",
}

const STATUS_ICON: Record<ToolCallEventItem["status"], LucideIcon> = {
  running: LoaderCircle,
  done: Check,
  error: CircleX,
  approval_required: CircleAlert,
  cancelled: Ban,
}

const STATUS_LABEL: Record<ToolCallEventItem["status"], string> = {
  running: "运行中",
  done: "已完成",
  error: "失败",
  approval_required: "等待确认",
  cancelled: "已取消",
}

const STATUS_COLOR: Record<ToolCallEventItem["status"], string> = {
  running: "text-sky-500 dark:text-sky-400",
  done: "text-emerald-500 dark:text-emerald-400",
  error: "text-red-500 dark:text-red-400",
  approval_required: "text-amber-500 dark:text-amber-400",
  cancelled: "text-muted-foreground",
}

function formatParamValue(value: unknown): string {
  if (typeof value === "string") return value
  if (value === undefined) return "undefined"
  return (JSON.stringify(value) ?? String(value)).slice(0, 80)
}

function ToolCallEventImpl({ event, compact = false }: ToolCallEventProps) {
  const [expanded, setExpanded] = useState(false)
  const isRunning = event.status === "running"
  const isError = event.status === "error"
  const CategoryIcon = CATEGORY_ICON[event.category]
  const StatusIcon = STATUS_ICON[event.status]
  const statusLabel = STATUS_LABEL[event.status]
  const hasParams = !!event.params && Object.keys(event.params).length > 0
  const hasResult = !!event.result?.trim()
  const hasError = !!event.error?.trim()
  const hasDetails = hasParams || hasResult || hasError

  return (
    <div
      className={cn(
        "group relative text-[12px]",
        compact ? "px-1" : "px-2",
        isError
          ? "ml-0 border-l-2 border-red-500/60 bg-red-50/30 dark:bg-red-950/10"
          : `${CATEGORY_BAR[event.category]} ml-0 border-l-2`,
      )}
    >
      <button
        type="button"
        onClick={hasDetails ? () => setExpanded(!expanded) : undefined}
        className="flex min-h-8 w-full items-start gap-1.5 py-1 text-left"
        aria-expanded={hasDetails ? expanded : undefined}
        aria-label={`${event.description}，状态：${statusLabel}`}
      >
        <CategoryIcon
          aria-hidden="true"
          className={cn(
            "mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70",
            isError ? "text-red-500 dark:text-red-400" : "text-muted-foreground",
          )}
        />
        <span className={cn(
          "min-w-0 flex-1 break-words",
          isError ? "font-medium text-red-700 dark:text-red-300" : "text-foreground/80",
        )}>
          {event.description}
        </span>
        <span className={cn(
          "ml-1 mt-0.5 flex shrink-0 items-center gap-1 text-[10px]",
          STATUS_COLOR[event.status],
        )}>
          <StatusIcon
            aria-hidden="true"
            className={cn("h-3.5 w-3.5", isRunning && "animate-spin")}
          />
          <span>{statusLabel}</span>
        </span>
      </button>

      {expanded && hasDetails && (
        <div className={cn(
          "space-y-1 pb-1 text-[11px] text-muted-foreground",
          compact ? "pl-4" : "pl-5",
        )}>
          {hasParams && event.params && (
            <div className="space-y-0.5">
              <div className="text-[10px] font-medium text-muted-foreground/70">参数</div>
              {Object.entries(event.params).map(([key, value]) => (
                <div key={key} className="break-all">
                  <span className="text-muted-foreground/60">{key}:</span>{" "}
                  <span>{formatParamValue(value)}</span>
                </div>
              ))}
            </div>
          )}
          {hasResult && event.result && (
            <div className="space-y-0.5">
              <div className="text-[10px] font-medium text-muted-foreground/70">结果</div>
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/30 p-1.5 text-muted-foreground/80">
                {event.result}
              </div>
            </div>
          )}
          {hasError && event.error && (
            <div className="space-y-0.5">
              <div className="text-[10px] font-medium text-red-600 dark:text-red-400">错误</div>
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-red-50/50 p-1.5 text-red-600 dark:bg-red-950/20 dark:text-red-400">
                {event.error}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const ToolCallEvent = memo(ToolCallEventImpl)
