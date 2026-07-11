import { useMemo, useRef, useEffect } from "react"
import { getWorkflowToolDescription } from "@/lib/agent/workflow-trace"
import type { AgentRunRecord } from "@/lib/agent/types"
import type { ContextTrace } from "@/lib/agent/context-trace"
import { createStreamingEventBuilder } from "@/components/common/timeline-types"
import type { ToolCallEventItem, TimelineToolCategory } from "@/components/common/timeline-types"
import { EventStream } from "@/components/common/event-stream"

type ToolCallRecord = AgentRunRecord["toolCalls"][number]

interface AgentWorkflowPanelProps {
  toolCalls: ToolCallRecord[] | undefined
  contextTrace?: ContextTrace | null
  thinkingContent?: string
  thinkingStreaming?: boolean
  onConfirmSave?: (call: ToolCallRecord & { preview?: string }) => void
  onReject?: (call: ToolCallRecord & { preview?: string }) => void
}

const WRITE_TOOLS = new Set(["write_chapter", "write_outline_node", "write_memory"])
const READ_TOOLS = new Set([
  "list_chapters", "list_outlines", "list_memories", "list_deductions",
  "read_chapter", "read_outline", "read_memory", "read_deduction",
  "read_chat_history", "read_outline_history", "search_chapters",
  "chapter_context", "chapter_previous_analysis", "load_context", "trim_context",
])
const ACTION_TOOLS = new Set(["route_task", "apply_skill"])

function getToolCallCategory(name: string): TimelineToolCategory {
  if (WRITE_TOOLS.has(name)) return "write"
  if (READ_TOOLS.has(name)) return "read"
  if (ACTION_TOOLS.has(name)) return "action"
  return "virtual"
}

function adaptToolCall(call: ToolCallRecord): ToolCallEventItem {
  const isError = call.status === "error"
  return {
    id: call.id,
    name: call.name,
    description: getWorkflowToolDescription(call),
    category: getToolCallCategory(call.name),
    status: call.status,
    params: call.params,
    result: isError ? undefined : call.result,
    error: isError ? call.result : undefined,
    startedAt: call.startedAt,
    finishedAt: call.finishedAt,
  }
}

export function AgentWorkflowPanel({
  toolCalls,
  contextTrace,
  thinkingContent,
  thinkingStreaming,
  onConfirmSave,
  onReject,
}: AgentWorkflowPanelProps) {
  const safeToolCalls = toolCalls ?? []
  const builderRef = useRef(createStreamingEventBuilder("agent-thinking"))
  const wasStreamingRef = useRef(false)

  const sortedCalls = useMemo(
    () => [...safeToolCalls].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0)),
    [safeToolCalls],
  )

  const adaptedCalls = useMemo(
    () => sortedCalls.map(adaptToolCall),
    [sortedCalls],
  )

  const isStreaming =
    thinkingStreaming || safeToolCalls.some((c) => c.status === "running")

  useEffect(() => {
    if (!wasStreamingRef.current && isStreaming) {
      builderRef.current.reset()
    }
    wasStreamingRef.current = isStreaming
  }, [isStreaming])

  const events = useMemo(
    () => builderRef.current.update(
      thinkingContent || "",
      adaptedCalls,
      !!thinkingStreaming,
    ),
    [thinkingContent, adaptedCalls, thinkingStreaming],
  )

  const totalDurationMs = useMemo(() => {
    if (contextTrace?.startedAt && contextTrace?.finishedAt) {
      return contextTrace.finishedAt - contextTrace.startedAt
    }
    if (safeToolCalls.length > 0) {
      const startedAts = safeToolCalls.map((c) => c.startedAt).filter(Boolean)
      const finishedAts = safeToolCalls.map((c) => c.finishedAt).filter(Boolean)
      if (startedAts.length > 0 && finishedAts.length > 0) {
        return Math.max(...finishedAts) - Math.min(...startedAts)
      }
    }
    return undefined
  }, [contextTrace, safeToolCalls])

  const pendingApprovalCalls = safeToolCalls.filter(
    (call) => call.status === "approval_required",
  )

  if (events.length === 0 && !isStreaming) return null

  const duplicateOutlineCalls = (() => {
    if (pendingApprovalCalls.length < 2) return []
    const groupedByFile = new Map<string, typeof pendingApprovalCalls>()
    for (const call of pendingApprovalCalls) {
      if (call.name !== "write_outline_node") continue
      const outlineName = (call.params as Record<string, unknown>)?.outlineName as
        | string
        | undefined
      if (!outlineName) continue
      const existing = groupedByFile.get(outlineName) ?? []
      existing.push(call)
      groupedByFile.set(outlineName, existing)
    }
    const duplicates: Array<{ outlineName: string; callCount: number }> = []
    for (const [outlineName, calls] of groupedByFile) {
      if (calls.length > 1) {
        duplicates.push({ outlineName, callCount: calls.length })
      }
    }
    return duplicates
  })()

  return (
    <div className="mb-2 w-full min-w-0 max-w-full overflow-hidden border-l border-border/80 pl-3">
      <EventStream events={events} isStreaming={isStreaming} totalDurationMs={totalDurationMs} />

      {pendingApprovalCalls.length > 0 && onConfirmSave && onReject ? (
        <div className="mt-3 space-y-2 rounded-md border border-amber-200 bg-amber-50/70 p-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
          {duplicateOutlineCalls.length > 0 ? (
            <div className="mb-2 rounded-md border border-red-200 bg-red-50/70 p-2 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
              <span className="font-semibold">
                ⚠ 警告：以下文件有多个写入项指向同一文件名：
              </span>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {duplicateOutlineCalls.map(({ outlineName, callCount }) => (
                  <li key={outlineName}>
                    共 {callCount} 项写入「{outlineName}」，确认前建议先在中部编辑区合并内容
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {pendingApprovalCalls.map((call) => (
            <div
              key={call.id}
              className="flex min-w-0 flex-wrap items-center justify-between gap-2"
            >
              <span className="min-w-0 flex-1 truncate">
                {call.name === "write_outline_node"
                  ? "大纲写入需要确认"
                  : "写入操作需要确认"}
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
    </div>
  )
}
