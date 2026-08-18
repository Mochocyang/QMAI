import React, { useMemo, useRef, useEffect } from "react"
import type { ToolCallRecord } from "@/lib/agent/tool-events"
import type { ToolCallEventItem } from "@/components/common/timeline-types"
import { compareToolCallsByStartedAt, createStreamingEventBuilder, filterToolCallsForDisplay, getTimelineToolCategory } from "@/components/common/timeline-types"
import { EventStream } from "@/components/common/event-stream"
import { extractThinkingContent } from "@/lib/novel/outline-stage-trace"
import { getWorkflowToolDescription, getWorkflowToolResultDisplay } from "@/lib/agent/workflow-trace"

interface OutlineWorkflowStagesProps {
  toolCalls: ToolCallRecord[]
  content: string
  isStreaming: boolean
}

function adaptToolCall(call: ToolCallRecord): ToolCallEventItem {
  const isError = call.status === "error"
  const callAny = call as any
  const displayResult = getWorkflowToolResultDisplay(call.result)
  return {
    id: call.id,
    name: call.name,
    description: getWorkflowToolDescription({
      name: call.name,
      params: call.params as Record<string, unknown>,
      result: call.result,
      status: call.status,
    } as Parameters<typeof getWorkflowToolDescription>[0]),
    category: getTimelineToolCategory(call.name),
    status: call.status,
    params: call.params as Record<string, unknown>,
    result: isError ? undefined : displayResult,
    error: isError ? displayResult : undefined,
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
    return filterToolCallsForDisplay([...toolCalls]).sort(compareToolCallsByStartedAt)
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
