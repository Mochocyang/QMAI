import { AgentWorkflowPanel } from "./agent-workflow-panel"
import { getToolCallDescription } from "./tool-call-timeline"
import type { ContextTrace } from "@/lib/agent/context-trace"
import type { AgentRunRecord } from "@/lib/agent/types"

export type ToolCallRecord = AgentRunRecord["toolCalls"][number]

interface AgentToolCallMessageProps {
  toolCalls: ToolCallRecord[] | undefined
  contextTrace?: ContextTrace | null
  thinkingContent?: string
  thinkingStreaming?: boolean
  onConfirmSave?: (call: ToolCallRecord & { preview?: string }) => void
  onReject?: (call: ToolCallRecord & { preview?: string }) => void
}

export function AgentToolCallMessage({
  toolCalls,
  contextTrace,
  thinkingContent,
  thinkingStreaming,
  onConfirmSave,
  onReject,
}: AgentToolCallMessageProps) {
  return (
    <AgentWorkflowPanel
      toolCalls={toolCalls}
      contextTrace={contextTrace}
      thinkingContent={thinkingContent}
      thinkingStreaming={thinkingStreaming}
      onConfirmSave={onConfirmSave}
      onReject={onReject}
    />
  )
}

export { getToolCallDescription }
