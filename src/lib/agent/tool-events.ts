import type { AgentRunRecord, AgentStageTrace, AgentToolEvent } from "./types"
import { activityEventFromToolEvent, applyAgentActivityEvent } from "./activity-trace"
import { getWorkflowToolDescription, isWebResearchToolName } from "./workflow-trace"

type ToolCallRecord = AgentRunRecord["toolCalls"][number]
type SettledToolCallStatus = "done" | "error" | "cancelled"

export function applyAgentToolEvent(
  records: ToolCallRecord[] | undefined,
  event: AgentToolEvent,
): ToolCallRecord[] {
  const current = records ?? []
  const existingIndex = current.findIndex((record) => record.id === event.callId)
  const status =
    event.type === "result"
      ? "done"
      : event.type === "error"
        ? "error"
        : event.type === "approval_required"
          ? "approval_required"
          : "running"

  const nextRecord: ToolCallRecord = {
    id: event.callId,
    parentCallId: event.parentCallId,
    name: event.name,
    params: event.params,
    result: event.result ?? "",
    preview: event.preview,
    status,
    startedAt: event.timestamp,
    finishedAt: event.type === "call_started" ? 0 : event.timestamp,
  }

  if (existingIndex < 0) {
    return [...current, nextRecord]
  }

  return current.map((record, index) => {
    if (index !== existingIndex) return record
    return {
      ...record,
      parentCallId: event.parentCallId ?? record.parentCallId,
      preview: event.preview ?? record.preview,
      name: event.name,
      params: event.params,
      result: event.result ?? record.result,
      status,
      finishedAt: event.type === "call_started" ? record.finishedAt : event.timestamp,
    }
  })
}

export function settleRunningAgentToolCalls(
  records: ToolCallRecord[] | undefined,
  status: SettledToolCallStatus = "done",
  timestamp: number = Date.now(),
  result?: string,
): ToolCallRecord[] | undefined {
  if (!records) return records
  return records.map((record) => {
    if (record.status !== "running") return record
    return {
      ...record,
      status,
      result: result ?? record.result,
      finishedAt: timestamp,
    }
  })
}

/** chapter_* 子步骤已在工具时间线展示，且细粒度阶段由 onActivityEvent 写入，避免双轨重复。 */
function shouldSkipToolActivityForStages(event: AgentToolEvent): boolean {
  return Boolean(event.parentCallId) && event.name.startsWith("chapter_")
}

export function activityEventFromAgentToolEvent(event: AgentToolEvent) {
  if (shouldSkipToolActivityForStages(event)) return null

  const activity = activityEventFromToolEvent(event)
  const titleFromParams = typeof event.params.title === "string" ? event.params.title : ""

  if (isWebResearchToolName(event.name)) {
    const status = event.type === "error" ? "error" as const : event.type === "call_started" ? "running" as const : "done" as const
    return {
      ...activity,
      stageId: "external_search",
      kind: event.type === "error" ? "error" as const : "web_search" as const,
      title: getWorkflowToolDescription({
        id: event.callId,
        name: event.name,
        params: event.params,
        result: event.result,
        status,
        startedAt: event.timestamp,
      }),
    }
  }

  if (event.name.startsWith("chapter_")) {
    return {
      ...activity,
      stageId: "chapter_workflow",
      kind: event.type === "result" ? "stage_output" as const : event.type === "error" ? "error" as const : activity.kind,
      title: titleFromParams || activity.title,
    }
  }

  return activity
}

export function applyAgentToolActivityEvent(
  stages: AgentStageTrace[] | undefined,
  event: AgentToolEvent,
): AgentStageTrace[] {
  const activity = activityEventFromAgentToolEvent(event)
  if (!activity) return stages ?? []
  return applyAgentActivityEvent(stages, activity)
}
