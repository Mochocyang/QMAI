import { useMemo, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  FileText,
  Loader2,
  Search,
  Sparkles,
  Wrench,
  XCircle,
} from "lucide-react"
import { getDefaultOpenAgentStageId, summarizeAgentStage } from "@/lib/agent/activity-trace"
import type { AgentActivityEvent, AgentActivityKind, AgentStageStatus, AgentStageTrace } from "@/lib/agent/types"
import { cn } from "@/lib/utils"

interface AgentStageStreamProps {
  stages: AgentStageTrace[] | undefined
}

export function AgentStageStream({ stages }: AgentStageStreamProps) {
  const visibleStages = stages ?? []
  const defaultOpenStageId = useMemo(() => getDefaultOpenAgentStageId(visibleStages), [visibleStages])
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const [allOpen, setAllOpen] = useState(false)

  if (visibleStages.length === 0) return null

  const isOpen = (stage: AgentStageTrace) => {
    if (allOpen) return true
    if (stage.id in openMap) return openMap[stage.id]
    return stage.id === defaultOpenStageId
  }

  return (
    <div className="mb-2 max-w-full overflow-hidden border-l border-border/80 pl-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-foreground">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <span>生成过程</span>
          <span className="text-[11px] font-normal text-muted-foreground">({visibleStages.length})</span>
        </div>
        <button
          type="button"
          onClick={() => setAllOpen((value) => !value)}
          className="shrink-0 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {allOpen ? "全部折叠" : "展开全部"}
        </button>
      </div>

      <div className="relative space-y-3 before:absolute before:left-[9px] before:top-2 before:bottom-2 before:w-px before:bg-border/80">
        {visibleStages.map((stage) => (
          <AgentStageRow
            key={stage.id}
            stage={stage}
            open={isOpen(stage)}
            onToggle={() => setOpenMap((prev) => ({ ...prev, [stage.id]: !isOpen(stage) }))}
          />
        ))}
      </div>
    </div>
  )
}

function AgentStageRow({
  stage,
  open,
  onToggle,
}: {
  stage: AgentStageTrace
  open: boolean
  onToggle: () => void
}) {
  return (
    <div
      className={cn(
        "relative pl-7",
        stage.status === "running" && "rounded-md bg-sky-50/45 py-1 pr-2 dark:bg-sky-950/10",
        stage.status === "approval_required" && "rounded-md bg-amber-50/55 py-1 pr-2 dark:bg-amber-950/10",
      )}
    >
      <span className="absolute left-0 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-background">
        <StageStatusIcon status={stage.status} />
      </span>
      <button
        type="button"
        onClick={onToggle}
        className="group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground",
                open && "rotate-90",
              )}
            />
            <span className="min-w-0 break-words text-[13px] font-medium text-foreground">
              {stage.title}
            </span>
          </span>
          <span className="mt-0.5 block break-words pl-5 text-[12px] leading-5 text-muted-foreground">
            {stage.summary || summarizeAgentStage(stage)}
          </span>
        </span>
        <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">
          {statusLabel(stage.status)}
        </span>
      </button>
      {open && (
        <div className="mt-1.5 max-h-80 space-y-1.5 overflow-y-auto pr-1 pl-5 text-[12px] leading-5">
          {stage.events.map((event) => (
            <AgentActivityRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  )
}

function AgentActivityRow({ event }: { event: AgentActivityEvent }) {
  const Icon = activityIcon(event.kind)
  return (
    <div className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-2 rounded border border-border/50 bg-background/45 px-2 py-1.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
      <div className="min-w-0">
        <div className="break-words text-[12px] font-medium text-foreground">{event.title}</div>
        <div className="mt-0.5 whitespace-pre-wrap break-words text-[12px] text-muted-foreground">{event.content}</div>
        {event.sourceRefs && event.sourceRefs.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {event.sourceRefs.map((source, index) => (
              <span
                key={`${event.id}-${source.type}-${source.path ?? source.title}-${index}`}
                className="rounded border border-border/60 px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                {source.title}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StageStatusIcon({ status }: { status: AgentStageStatus }) {
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600 dark:text-sky-400" />
  if (status === "approval_required") return <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
  if (status === "error") return <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
  if (status === "cancelled") return <XCircle className="h-3.5 w-3.5 text-muted-foreground/70" />
  if (status === "pending") return <Circle className="h-3.5 w-3.5 text-muted-foreground/60" />
  return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
}

function statusLabel(status: AgentStageStatus): string {
  if (status === "running") return "进行中"
  if (status === "approval_required") return "待确认"
  if (status === "error") return "失败"
  if (status === "cancelled") return "已取消"
  if (status === "pending") return "待处理"
  return "完成"
}

function activityIcon(kind: AgentActivityKind) {
  if (kind === "read_source" || kind === "extract_goal" || kind === "extract_result") return FileText
  if (kind === "web_search" || kind === "mcp_call") return Search
  if (kind === "tool_call" || kind === "skill_used") return Wrench
  if (kind === "error") return AlertTriangle
  return Sparkles
}
