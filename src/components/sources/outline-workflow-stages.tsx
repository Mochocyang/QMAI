import React, { useMemo, useRef, useEffect } from "react"
import type { ToolCallRecord } from "@/lib/agent/tool-events"
import type { ToolCallEventItem, TimelineToolCategory } from "@/components/common/timeline-types"
import { createStreamingEventBuilder } from "@/components/common/timeline-types"
import { EventStream } from "@/components/common/event-stream"
import { extractThinkingContent } from "@/lib/novel/outline-stage-trace"
import { getWorkflowToolDescription } from "@/lib/agent/workflow-trace"

interface OutlineWorkflowStagesProps {
  toolCalls: ToolCallRecord[]
  content: string
  isStreaming: boolean
}

const WRITE_TOOLS = new Set(["write_chapter", "write_outline_node", "write_memory", "write_chapter_outline"])
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
  const callAny = call as any
  return {
    id: call.id,
    name: call.name,
    description: getWorkflowToolDescription({
      name: call.name,
      params: call.params as Record<string, unknown>,
      result: call.result,
      status: call.status,
    } as Parameters<typeof getWorkflowToolDescription>[0]),
    category: getToolCallCategory(call.name),
    status: call.status,
    params: call.params as Record<string, unknown>,
    result: isError ? undefined : call.result,
    error: isError ? call.result : undefined,
    startedAt: callAny.startedAt,
    finishedAt: callAny.finishedAt,
  }
}

export const OutlineWorkflowStages = React.memo(function OutlineWorkflowStages(
  props: OutlineWorkflowStagesProps,
) {
  const { toolCalls, content, isStreaming } = props
  const builderRef = useRef(createStreamingEventBuilder("outline-thinking"))
  const wasStreamingRef = useRef(false)

  const thinkingExtract = useMemo(() => extractThinkingContent(content), [content])
  const thinkingText = thinkingExtract.text || ""
  const thinkingStreaming = thinkingExtract.streaming || isStreaming

  const sortedCalls = useMemo(() => {
    return [...toolCalls].sort((a, b) => {
      const aStart = (a as { startedAt?: number }).startedAt ?? 0
      const bStart = (b as { startedAt?: number }).startedAt ?? 0
      return aStart - bStart
    })
  }, [toolCalls])

  const adaptedCalls = useMemo(
    () => sortedCalls.map(adaptToolCall),
    [sortedCalls],
  )

  const hasRunningTool = toolCalls.some((c) => c.status === "running")
  const actuallyStreaming = isStreaming || hasRunningTool

  useEffect(() => {
    if (!wasStreamingRef.current && actuallyStreaming) {
      builderRef.current.reset()
    }
    wasStreamingRef.current = actuallyStreaming
  }, [actuallyStreaming])

  const events = useMemo(
    () => builderRef.current.update(thinkingText, adaptedCalls, thinkingStreaming),
    [thinkingText, adaptedCalls, thinkingStreaming],
  )

  const totalDurationMs = useMemo(() => {
    if (toolCalls.length > 0) {
      const startedAts = toolCalls.map((c) => (c as { startedAt?: number }).startedAt).filter(Boolean) as number[]
      const finishedAts = toolCalls.map((c) => (c as { finishedAt?: number }).finishedAt).filter(Boolean) as number[]
      if (startedAts.length > 0 && finishedAts.length > 0) {
        return Math.max(...finishedAts) - Math.min(...startedAts)
      }
    }
    return undefined
  }, [toolCalls])

  if (events.length === 0 && !actuallyStreaming) return null

  return <EventStream events={events} isStreaming={actuallyStreaming} totalDurationMs={totalDurationMs} />
})
