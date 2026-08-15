import {
  CheckCircle2,
  ChevronRight,
  Loader2,
  Workflow,
  XCircle,
} from "lucide-react"
import {
  AgentToolCallMessage,
  type ToolCallRecord,
} from "@/components/chat/agent-tool-call-message"
import { cn } from "@/lib/utils"

type OutlineWorkflowIntentPhase = "intent_analysis" | "generation" | "waiting_user_input"

export function shouldUseOutlineStandardWorkflowCard(input: {
  fastMode: boolean
  intentPhase?: OutlineWorkflowIntentPhase
  hasMultiAgentRun: boolean
}): boolean {
  if (input.fastMode) return false
  if (input.hasMultiAgentRun) return false
  return input.intentPhase === "intent_analysis" || input.intentPhase === "generation"
}

function workflowTitle(intentPhase?: OutlineWorkflowIntentPhase): string {
  if (intentPhase === "intent_analysis") return "意图分析工作流"
  return "大纲生成工作流"
}

function statusLabel(status: "running" | "done" | "error"): string {
  switch (status) {
    case "running":
      return "运行中"
    case "done":
      return "完成"
    case "error":
      return "失败"
  }
}

function StatusIcon({ status }: { status: "running" | "done" | "error" }) {
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600 dark:text-sky-400" />
  }
  if (status === "done") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
  }
  return <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
}

interface OutlineStandardWorkflowPanelProps {
  intentPhase?: OutlineWorkflowIntentPhase
  isRunning?: boolean
  toolCalls: ToolCallRecord[] | undefined
  thinkingContent?: string
  thinkingStreaming?: boolean
  onConfirmSave?: (call: ToolCallRecord & { preview?: string }) => void
  onReject?: (call: ToolCallRecord & { preview?: string }) => void
}

export function OutlineStandardWorkflowPanel({
  intentPhase,
  isRunning = false,
  toolCalls,
  thinkingContent,
  thinkingStreaming,
  onConfirmSave,
  onReject,
}: OutlineStandardWorkflowPanelProps) {
  const safeToolCalls = toolCalls ?? []
  const toolsRunning = safeToolCalls.some((call) => call.status === "running")
  const running = isRunning || Boolean(thinkingStreaming) || toolsRunning
  const failedCount = safeToolCalls.filter((call) => call.status === "error").length
  const doneCount = safeToolCalls.filter((call) => call.status === "done").length
  const hasContent = safeToolCalls.length > 0 || Boolean(thinkingContent) || running
  if (!hasContent) return null

  const status: "running" | "done" | "error" = running
    ? "running"
    : failedCount > 0 && doneCount === 0
      ? "error"
      : "done"

  return (
    <div className="mb-2 w-full min-w-0 max-w-full overflow-hidden rounded-md border border-sky-200/70 bg-sky-50/45 p-3 text-xs dark:border-sky-900/45 dark:bg-sky-950/15">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-foreground">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
            <Workflow className="h-3.5 w-3.5" />
          </span>
          <span>{workflowTitle(intentPhase)}</span>
          <span className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
            <StatusIcon status={status} />
            {statusLabel(status)}
          </span>
        </div>
        {safeToolCalls.length > 0 ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>完成：{doneCount}/{safeToolCalls.length}</span>
            {failedCount > 0 ? (
              <span className="text-red-600 dark:text-red-400">失败：{failedCount}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-md border border-border/70 bg-background/75 px-2.5 py-2">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 break-words font-medium text-foreground">工具执行</span>
          </div>
          <span className={cn(
            "inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground",
            status === "error" && "text-red-600 dark:text-red-400",
            status === "done" && "text-emerald-700 dark:text-emerald-300",
          )}>
            <StatusIcon status={status} />
            {statusLabel(status)}
          </span>
        </div>
        <AgentToolCallMessage
          toolCalls={safeToolCalls}
          thinkingContent={thinkingContent}
          thinkingStreaming={thinkingStreaming || (running && safeToolCalls.length === 0)}
          chrome="none"
          showEventSummary={false}
          onConfirmSave={onConfirmSave}
          onReject={onReject}
        />
      </div>
    </div>
  )
}
