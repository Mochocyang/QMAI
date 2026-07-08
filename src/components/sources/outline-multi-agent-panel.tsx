import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  Loader2,
  Network,
  XCircle,
} from "lucide-react"
import type {
  OutlineMultiAgentRunState,
  OutlineMultiAgentStepStatus,
} from "@/stores/outline-chat-store"
import { cn } from "@/lib/utils"

interface OutlineMultiAgentPanelProps {
  run?: OutlineMultiAgentRunState
}

function statusLabel(status: OutlineMultiAgentStepStatus | OutlineMultiAgentRunState["status"]): string {
  switch (status) {
    case "planning":
      return "规划中"
    case "running":
      return "运行中"
    case "merging":
      return "合并中"
    case "fallback":
      return "已回退"
    case "done":
      return "完成"
    case "error":
      return "失败"
    case "skipped":
      return "已跳过"
    default:
      return "等待中"
  }
}

function StatusIcon({ status }: { status: OutlineMultiAgentStepStatus | OutlineMultiAgentRunState["status"] }) {
  if (status === "running" || status === "planning" || status === "merging") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600 dark:text-sky-400" />
  }
  if (status === "done") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
  }
  if (status === "error") {
    return <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
  }
  if (status === "fallback" || status === "skipped") {
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
  }
  return <Circle className="h-3.5 w-3.5 text-muted-foreground/60" />
}

function formatSkillNames(skillNames: string[]): string {
  return skillNames.length > 0 ? skillNames.join("、") : "未指定"
}

export function OutlineMultiAgentPanel({ run }: OutlineMultiAgentPanelProps) {
  if (!run) return null

  const finishedCount = run.agents.filter((agent) => agent.status === "done").length
  const failedCount = run.agents.filter((agent) => agent.status === "error").length

  return (
    <div className="mb-2 max-w-full overflow-hidden rounded-md border border-sky-200/70 bg-sky-50/45 p-3 text-xs dark:border-sky-900/45 dark:bg-sky-950/15">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-foreground">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
            <Network className="h-3.5 w-3.5" />
          </span>
          <span>多 Agent 大纲生成</span>
          <span className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
            <StatusIcon status={run.status} />
            {statusLabel(run.status)}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>最大并发：{run.maxConcurrency}</span>
          <span>完成：{finishedCount}/{run.agents.length}</span>
          {failedCount > 0 ? <span className="text-red-600 dark:text-red-400">失败：{failedCount}</span> : null}
        </div>
      </div>

      <div className="space-y-2">
        {run.agents.map((agent) => (
          <div key={agent.id} className="rounded-md border border-border/70 bg-background/75 px-2.5 py-2">
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 break-words font-medium text-foreground">{agent.name}</span>
              </div>
              <span className={cn(
                "inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground",
                agent.status === "error" && "text-red-600 dark:text-red-400",
                agent.status === "done" && "text-emerald-700 dark:text-emerald-300",
              )}>
                <StatusIcon status={agent.status} />
                {statusLabel(agent.status)}
              </span>
            </div>
            <div className="mt-1.5 grid gap-1.5 pl-5 leading-5 text-muted-foreground">
              <div className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-2">
                <span>任务</span>
                <span className="min-w-0 break-words text-foreground/85">{agent.taskPrompt}</span>
              </div>
              <div className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-2">
                <span>Skill</span>
                <span className="min-w-0 break-words">{formatSkillNames(agent.skillNames)}</span>
              </div>
              {agent.summary ? (
                <div className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-2">
                  <span>结果</span>
                  <span className="min-w-0 break-words text-emerald-700 dark:text-emerald-300">{agent.summary}</span>
                </div>
              ) : null}
              {agent.error ? (
                <div className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-2">
                  <span>错误</span>
                  <span className="min-w-0 break-words text-red-600 dark:text-red-400">{agent.error}</span>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {run.merge ? (
        <div className="mt-2 rounded-md border border-border/70 bg-background/75 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">合并 Agent</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <StatusIcon status={run.merge.status} />
              {statusLabel(run.merge.status)}
            </span>
          </div>
          {run.merge.summary ? (
            <div className="mt-1 break-words leading-5 text-muted-foreground">{run.merge.summary}</div>
          ) : null}
          {run.merge.error ? (
            <div className="mt-1 break-words leading-5 text-red-600 dark:text-red-400">{run.merge.error}</div>
          ) : null}
        </div>
      ) : null}

      {run.fallbackReason ? (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/70 px-2.5 py-2 leading-5 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
          <span className="font-medium">回退原因：</span>
          {run.fallbackReason}
          {run.failureDetails?.length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {run.failureDetails.map((detail, index) => (
                <li key={`${detail}-${index}`} className="break-words">{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
