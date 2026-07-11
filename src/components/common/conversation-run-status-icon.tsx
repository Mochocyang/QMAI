import { CircleAlert, CircleCheck, LoaderCircle, PauseCircle } from "lucide-react"
import type { ConversationRunState } from "@/lib/conversation-run-state"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export function getConversationRunStatusLabel(state: ConversationRunState): string {
  if (state.status === "running") return "正在生成"
  if (state.status === "completed_unread") return "已完成，点击查看"
  if (state.status === "failed") return `生成失败：${state.error ?? "未知错误"}`
  if (state.status === "interrupted") return "任务已中断，可重新发送"
  return ""
}

export function ConversationRunStatusIcon({ state }: { state?: ConversationRunState }) {
  if (!state || state.status === "idle") return null
  const label = getConversationRunStatusLabel(state)
  const Icon = state.status === "running"
    ? LoaderCircle
    : state.status === "completed_unread"
      ? CircleCheck
      : state.status === "failed"
        ? CircleAlert
        : PauseCircle
  const color = state.status === "running"
    ? "text-sky-500"
    : state.status === "completed_unread"
      ? "text-emerald-500"
      : state.status === "failed"
        ? "text-red-500"
        : "text-amber-500"

  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              role="img"
              aria-label={label}
              data-conversation-run-status={state.status}
              className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center"
            />
          }
        >
          <Icon aria-hidden="true" className={`h-3.5 w-3.5 ${color} ${state.status === "running" ? "animate-spin" : ""}`} />
          {state.status === "completed_unread" ? (
            <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full border border-background bg-sky-500" />
          ) : null}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}