import { useMemo, useState } from "react"
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Loader2,
  XCircle,
} from "lucide-react"
import { ToolCallTimeline } from "./tool-call-timeline"
import {
  buildAgentWorkflowSteps,
  type AgentWorkflowDetail,
  type AgentWorkflowStep,
  type AgentWorkflowStepStatus,
} from "@/lib/agent/workflow-trace"
import type { ContextTrace } from "@/lib/agent/context-trace"
import type { AgentRunRecord } from "@/lib/agent/types"
import { cn } from "@/lib/utils"

type ToolCallRecord = AgentRunRecord["toolCalls"][number]

interface AgentWorkflowPanelProps {
  toolCalls: ToolCallRecord[] | undefined
  contextTrace?: ContextTrace | null
  onConfirmSave?: (call: ToolCallRecord & { preview?: string }) => void
  onReject?: (call: ToolCallRecord & { preview?: string }) => void
}

function getDefaultOpenStepId(steps: AgentWorkflowStep[]): string | null {
  return steps.find((step) => step.status === "running")?.id
    ?? steps.find((step) => step.status === "approval_required")?.id
    ?? null
}

function getWorkflowDuration(steps: AgentWorkflowStep[]): string {
  const starts = steps.map((step) => step.startedAt).filter((value): value is number => Number.isFinite(value))
  if (starts.length === 0) return ""
  const finishes = steps.map((step) => step.finishedAt).filter((value): value is number => Number.isFinite(value))
  const start = Math.min(...starts)
  const end = finishes.length > 0 ? Math.max(...finishes) : Date.now()
  const ms = Math.max(0, end - start)
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}m${seconds % 60}s`
}

function getOverallStatus(steps: AgentWorkflowStep[]): AgentWorkflowStepStatus {
  if (steps.some((step) => step.status === "running")) return "running"
  if (steps.some((step) => step.status === "approval_required")) return "approval_required"
  if (steps.some((step) => step.status === "error")) return "error"
  if (steps.some((step) => step.status === "cancelled")) return "cancelled"
  return "done"
}

function WorkflowStatusIcon({ status }: { status: AgentWorkflowStepStatus }) {
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600 dark:text-sky-400" />
  }
  if (status === "approval_required") {
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
  }
  if (status === "error") {
    return <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
  }
  if (status === "cancelled") {
    return <XCircle className="h-3.5 w-3.5 text-muted-foreground/70" />
  }
  if (status === "pending") {
    return <Circle className="h-3.5 w-3.5 text-muted-foreground/60" />
  }
  return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
}

function getStatusLabel(status: AgentWorkflowStepStatus): string {
  switch (status) {
    case "running":
      return "进行中"
    case "approval_required":
      return "待确认"
    case "error":
      return "失败"
    case "cancelled":
      return "已取消"
    case "pending":
      return "待处理"
    default:
      return "完成"
  }
}

function getDetailToneClass(tone: AgentWorkflowDetail["tone"]): string {
  switch (tone) {
    case "success":
      return "text-emerald-700 dark:text-emerald-300"
    case "warning":
      return "text-amber-700 dark:text-amber-300"
    case "error":
      return "text-red-700 dark:text-red-300"
    case "muted":
      return "text-muted-foreground/80"
    default:
      return "text-foreground/85"
  }
}

function WorkflowStepRow({
  step,
  open,
  onToggle,
}: {
  step: AgentWorkflowStep
  open: boolean
  onToggle: () => void
}) {
  return (
    <div
      className={cn(
        "relative pl-7",
        step.status === "running" && "rounded-md bg-sky-50/45 py-1 pr-2 dark:bg-sky-950/10",
        step.status === "approval_required" && "rounded-md bg-amber-50/55 py-1 pr-2 dark:bg-amber-950/10",
      )}
    >
      <span className="absolute left-0 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-background">
        <WorkflowStatusIcon status={step.status} />
      </span>
      <button
        type="button"
        onClick={onToggle}
        className="group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 text-left"
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
              {step.title}
            </span>
          </span>
          <span className="mt-0.5 block break-words pl-5 text-[12px] leading-5 text-muted-foreground">
            {step.summary}
          </span>
        </span>
        <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">
          {getStatusLabel(step.status)}
        </span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 pl-5 text-[12px] leading-5">
          {step.details.map((detail, index) => (
            <div key={`${step.id}-${detail.label}-${index}`} className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
              <span className="text-muted-foreground">{detail.label}</span>
              <span className={cn("min-w-0 break-words", getDetailToneClass(detail.tone))}>{detail.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function AgentWorkflowPanel({
  toolCalls,
  contextTrace,
  onConfirmSave,
  onReject,
}: AgentWorkflowPanelProps) {
  const steps = useMemo(
    () => buildAgentWorkflowSteps({ toolCalls, contextTrace }),
    [toolCalls, contextTrace],
  )
  const defaultOpenStepId = useMemo(() => getDefaultOpenStepId(steps), [steps])
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [allOpen, setAllOpen] = useState(false)

  if (steps.length === 0) return null

  const overallStatus = getOverallStatus(steps)
  const duration = getWorkflowDuration(steps)
  const safeToolCalls = toolCalls ?? []
  const pendingApprovalCalls = safeToolCalls.filter((call) => call.status === "approval_required")

  const isStepOpen = (step: AgentWorkflowStep) => {
    if (allOpen) return true
    if (step.id in openMap) return openMap[step.id]
    return step.id === defaultOpenStepId
  }

  return (
    <div className="mb-2 max-w-full overflow-hidden border-l border-border/80 pl-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-foreground">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Brain className="h-3.5 w-3.5" />
          </span>
          <span>思考过程</span>
          <span className="text-[11px] font-normal text-muted-foreground">({steps.length})</span>
          <span className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
            <WorkflowStatusIcon status={overallStatus} />
            {getStatusLabel(overallStatus)}
          </span>
          {duration && (
            <span className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
              <Clock3 className="h-3 w-3" />
              {duration}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px]">
          <button
            type="button"
            onClick={() => setAllOpen((value) => !value)}
            className="text-muted-foreground hover:text-foreground"
          >
            {allOpen ? "全部折叠" : "展开全部"}
          </button>
          {safeToolCalls.length > 0 && (
            <button
              type="button"
              onClick={() => setDetailsOpen((value) => !value)}
              className="text-muted-foreground hover:text-foreground"
              aria-expanded={detailsOpen}
            >
              工具详情
            </button>
          )}
        </div>
      </div>

      <div className="relative space-y-3 before:absolute before:left-[9px] before:top-2 before:bottom-2 before:w-px before:bg-border/80">
        {steps.map((step) => (
          <WorkflowStepRow
            key={step.id}
            step={step}
            open={isStepOpen(step)}
            onToggle={() => {
              setOpenMap((prev) => ({
                ...prev,
                [step.id]: !isStepOpen(step),
              }))
            }}
          />
        ))}
      </div>

      {pendingApprovalCalls.length > 0 && onConfirmSave && onReject ? (
        <div className="mt-3 space-y-2 rounded-md border border-amber-200 bg-amber-50/70 p-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
          {pendingApprovalCalls.map((call) => (
            <div key={call.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate">
                {call.name === "write_outline_node" ? "大纲写入需要确认" : "写入操作需要确认"}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onConfirmSave(call)}
                  className="rounded bg-green-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-green-700"
                >
                  确认保存
                </button>
                <button
                  type="button"
                  onClick={() => onReject(call)}
                  className="rounded border border-amber-300/70 bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent"
                >
                  放弃
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {detailsOpen && safeToolCalls.length > 0 && (
        <div className="mt-3 border-t border-border/70 pt-2">
          <ToolCallTimeline
            toolCalls={safeToolCalls}
            onConfirmSave={onConfirmSave}
            onReject={onReject}
            defaultExpanded={false}
          />
        </div>
      )}
    </div>
  )
}
