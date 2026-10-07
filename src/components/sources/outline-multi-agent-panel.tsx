import { useId, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  Loader2,
  Network,
  RotateCw,
  XCircle,
} from "lucide-react"
import type {
  OutlineMultiAgentRunState,
  OutlineMultiAgentStepStatus,
} from "@/stores/outline-chat-store"
import { cn } from "@/lib/utils"

interface OutlineMultiAgentPanelProps {
  run?: OutlineMultiAgentRunState
  onResume?: () => void
  resumeDisabled?: boolean
}

function statusLabel(status: OutlineMultiAgentStepStatus | OutlineMultiAgentRunState["status"]): string {
  switch (status) {
    case "planning":
      return "规划中"
    case "running":
      return "运行中"
    case "retrying":
      return "重试中"
    case "waiting":
    case "pending":
      return "等待中"
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
  if (status === "running" || status === "retrying" || status === "planning" || status === "merging") {
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

const FALLBACK_SUMMARY = "\u591a Agent \u751f\u6210\u5931\u8d25\uff0c\u5df2\u81ea\u52a8\u5207\u6362\u4e3a\u666e\u901a\u751f\u6210\u3002"
const MAX_DIAGNOSTIC_TEXT_LENGTH = 160
const MAX_FAILURE_DETAIL_COUNT = 5

function maskDiagnosticCredentials(value: string): string {
  return value
    .replace(/(["'])(authorization|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|token|password|passwd|secret)\1(\s*:\s*)(["'])[^"']*\4/gi, "$1$2$1$3$4***$4")
    .replace(/\b(authorization)\b(\s*[:=]\s*)(bearer\s+)?([^\s&#,;]+)/gi, (_match, key: string, separator: string, scheme?: string) => (
      `${key}${separator}${scheme ? "Bearer " : ""}***`
    ))
    .replace(/\b(bearer)(\s+)([^\s&#,;]+)/gi, "$1$2***")
    .replace(/\b(api[ _-]?key|access[ _-]?token|refresh[ _-]?token|token|password|passwd|secret)\b(\s*[:=]\s*)([^\s&#,;}]+)/gi, "$1$2***")
}

function summarizeDiagnosticText(value: string | undefined, fallback: string): string {
  const firstLine = value
    ?.split(/[\r\n\u2028\u2029]/)
    .map((line) => line.trim())
    .find(Boolean)
  if (!firstLine) return fallback
  const masked = maskDiagnosticCredentials(firstLine)
  return masked.length > MAX_DIAGNOSTIC_TEXT_LENGTH
    ? `${masked.slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH - 3)}...`
    : masked
}

function summarizeFailureDetails(values: string[] | undefined): string[] {
  const summaries: string[] = []
  const seen = new Set<string>()
  for (const value of values ?? []) {
    const summary = summarizeDiagnosticText(value, "")
    if (!summary || seen.has(summary)) continue
    seen.add(summary)
    summaries.push(summary)
    if (summaries.length >= MAX_FAILURE_DETAIL_COUNT) break
  }
  return summaries
}

export function OutlineMultiAgentPanel({ run, onResume, resumeDisabled }: OutlineMultiAgentPanelProps) {
  const [showFallbackDetails, setShowFallbackDetails] = useState(false)
  const generatedId = useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const fallbackDetailsId = `outline-multi-agent-fallback-details-${generatedId}`
  if (!run) return null

  const finishedCount = run.agents.filter((agent) => agent.status === "done").length
  const failedCount = run.agents.filter((agent) => agent.status === "error").length
  const isFallback = run.status === "fallback" || run.mode === "single-agent-fallback"
  const fallbackReasonSummary = run.fallbackReason
    ? summarizeDiagnosticText(run.fallbackReason, "\u56de\u9000\u539f\u56e0\u672a\u63d0\u4f9b")
    : undefined
  const failureDetailSummaries = summarizeFailureDetails(run.failureDetails)
  const mergeErrorSummary = run.merge?.error
    ? summarizeDiagnosticText(run.merge.error, "\u5408\u5e76\u5931\u8d25")
    : undefined

  if (isFallback) {
    return (
      <div className="mb-2 min-w-0 max-w-full overflow-hidden rounded-md border border-amber-200/80 bg-amber-50/55 px-3 py-2.5 text-xs dark:border-amber-900/45 dark:bg-amber-950/15">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-[0.8125rem] text-amber-950 dark:text-amber-100">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{FALLBACK_SUMMARY}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {run.resumeablePlan && onResume ? (
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-emerald-300 dark:hover:bg-emerald-950/30 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={onResume}
                disabled={resumeDisabled}
              >
                <RotateCw className="h-3.5 w-3.5" />
                {"\u7ee7\u7eed\u672a\u5b8c\u6210\u7684\u4efb\u52a1"}
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-200 dark:hover:bg-amber-950/50"
              aria-expanded={showFallbackDetails}
              aria-controls={showFallbackDetails ? fallbackDetailsId : undefined}
              onClick={() => setShowFallbackDetails((value) => !value)}
            >
              <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", showFallbackDetails && "rotate-90")} />
              {showFallbackDetails ? "\u6536\u8d77\u8be6\u60c5" : "\u67e5\u770b\u8be6\u60c5"}
            </button>
          </div>
        </div>

        {showFallbackDetails ? (
          <div
            id={fallbackDetailsId}
            role="region"
            aria-label={"\u591a Agent \u5931\u8d25\u8bca\u65ad\u8be6\u60c5"}
            className="mt-2 max-h-[min(24rem,55vh)] min-w-0 max-w-full space-y-2 overflow-y-auto overscroll-contain rounded-md border border-amber-200/80 bg-background/80 p-2.5 [overflow-wrap:anywhere] dark:border-amber-900/45"
          >
            <div className="grid gap-1 text-muted-foreground sm:grid-cols-2">
              <div><span className="font-medium text-foreground">{"Agent \u72b6\u6001\uff1a"}</span>{"\u5b8c\u6210 "}{finishedCount}/{run.agents.length}{"\uff0c\u5931\u8d25 "}{failedCount}</div>
              <div><span className="font-medium text-foreground">{"\u5408\u5e76\u72b6\u6001\uff1a"}</span>{statusLabel(run.merge?.status ?? "skipped")}</div>
              {mergeErrorSummary ? (
                <div className="sm:col-span-2"><span className="font-medium text-foreground">{"\u5408\u5e76\u5931\u8d25\u539f\u56e0\uff1a"}</span><span className="break-words text-red-600 dark:text-red-400">{mergeErrorSummary}</span></div>
              ) : null}
            </div>
            {run.agents.map((agent) => (
              <div key={agent.id} className="min-w-0 rounded-md border border-border/70 bg-background px-2.5 py-2">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-1.5">
                  <span className="min-w-0 break-words font-medium text-foreground">{agent.name}</span>
                  <span className={cn("inline-flex shrink-0 items-center gap-1 text-muted-foreground", agent.status === "error" && "text-red-600 dark:text-red-400")}>
                    <StatusIcon status={agent.status} />
                    {statusLabel(agent.status)}
                  </span>
                </div>
                <dl className="mt-1.5 grid min-w-0 gap-1 leading-5 text-muted-foreground">
                  <div className="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] gap-2">
                    <dt>{"\u4efb\u52a1\u6458\u8981"}</dt>
                    <dd className="min-w-0 break-words text-foreground/85">{summarizeDiagnosticText(agent.taskPrompt, "\u672a\u63d0\u4f9b")}</dd>
                  </div>
                  <div className="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] gap-2">
                    <dt>Skill</dt>
                    <dd className="min-w-0 break-words text-foreground/85">{formatSkillNames(agent.skillNames)}</dd>
                  </div>
                  {agent.error ? (
                    <div className="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] gap-2">
                      <dt>{"\u5931\u8d25\u539f\u56e0"}</dt>
                      <dd className="min-w-0 break-words text-red-600 dark:text-red-400">{summarizeDiagnosticText(agent.error, "\u6267\u884c\u5931\u8d25")}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            ))}
            {fallbackReasonSummary ? (
              <div className="min-w-0 rounded-md border border-amber-200 bg-amber-50/70 px-2.5 py-2 leading-5 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
                <span className="font-medium">{"\u5931\u8d25\u539f\u56e0\uff1a"}</span>
                <span className="break-words">{fallbackReasonSummary}</span>
                {failureDetailSummaries.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {failureDetailSummaries.map((detail) => (
                      <li key={detail} className="break-words">{detail}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="mb-2 max-w-full overflow-hidden rounded-md border border-sky-200/70 bg-sky-50/45 p-3 text-xs dark:border-sky-900/45 dark:bg-sky-950/15">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[0.8125rem] font-medium text-foreground">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
            <Network className="h-3.5 w-3.5" />
          </span>
          <span>多 Agent 大纲生成</span>
          <span className="inline-flex items-center gap-1 text-[0.6875rem] font-normal text-muted-foreground">
            <StatusIcon status={run.status} />
            {statusLabel(run.status)}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-[0.6875rem] text-muted-foreground">
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
                "inline-flex shrink-0 items-center gap-1 text-[0.6875rem] text-muted-foreground",
                agent.status === "error" && "text-red-600 dark:text-red-400",
                agent.status === "retrying" && "text-amber-600 dark:text-amber-400",
                agent.status === "done" && "text-emerald-700 dark:text-emerald-300",
              )}>
                <StatusIcon status={agent.status} />
                {statusLabel(agent.status)}
                {agent.status === "retrying" ? "（1/1）" : ""}
              </span>
            </div>
            <div className="mt-1.5 grid gap-1.5 pl-5 leading-5 text-muted-foreground">
              <div className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-2">
                <span>任务</span>
                <span className="min-w-0 break-words text-foreground/85">{summarizeDiagnosticText(agent.taskPrompt, "\u672a\u63d0\u4f9b")}</span>
              </div>
              <div className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-2">
                <span>Skill</span>
                <span className="min-w-0 break-words">{formatSkillNames(agent.skillNames)}</span>
              </div>
              {agent.summary ? (
                <div className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-2">
                  <span>结果</span>
                  <span className="min-w-0 break-words text-emerald-700 dark:text-emerald-300">{summarizeDiagnosticText(agent.summary, "\u672a\u63d0\u4f9b")}</span>
                </div>
              ) : null}
              {agent.error ? (
                <div className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-2">
                  <span>错误</span>
                  <span className="min-w-0 break-words text-red-600 dark:text-red-400">{summarizeDiagnosticText(agent.error, "\u6267\u884c\u5931\u8d25")}</span>
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
            <span className="inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
              <StatusIcon status={run.merge.status} />
              {statusLabel(run.merge.status)}
            </span>
          </div>
          {run.merge.summary ? (
            <div className="mt-1 break-words leading-5 text-muted-foreground">{summarizeDiagnosticText(run.merge.summary, "\u672a\u63d0\u4f9b")}</div>
          ) : null}
          {run.merge.error ? (
            <div className="mt-1 break-words leading-5 text-red-600 dark:text-red-400">{summarizeDiagnosticText(run.merge.error, "\u5408\u5e76\u5931\u8d25")}</div>
          ) : null}
        </div>
      ) : null}

      {fallbackReasonSummary ? (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/70 px-2.5 py-2 leading-5 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
          <span className="font-medium">{"\u56de\u9000\u539f\u56e0\uff1a"}</span>
          {fallbackReasonSummary}
          {failureDetailSummaries.length > 0 ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {failureDetailSummaries.map((detail) => (
                <li key={detail} className="break-words">{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
