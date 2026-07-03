import type {
  AgentActivityEvent,
  AgentActivityKind,
  AgentStageStatus,
  AgentStageTrace,
  AgentToolEvent,
} from "./types"

const EMPTY_CONTENT = "本阶段未返回可展示内容。"

export interface CreateAgentActivityEventInput {
  id: string
  stageId: string
  kind: AgentActivityKind
  title: string
  content: string
  sourceRefs?: AgentActivityEvent["sourceRefs"]
  toolCallId?: string
  timestamp?: number
}

export interface CreateStageStartedEventInput {
  stageId: string
  title: string
  summary: string
  timestamp?: number
}

export function createAgentActivityEvent(input: CreateAgentActivityEventInput): AgentActivityEvent {
  return {
    id: input.id,
    stageId: input.stageId,
    kind: input.kind,
    title: input.title.trim() || "阶段事件",
    content: normalizeActivityContent(input.content),
    sourceRefs: input.sourceRefs,
    toolCallId: input.toolCallId,
    timestamp: input.timestamp ?? Date.now(),
  }
}

export function createStageStartedEvent(input: CreateStageStartedEventInput): AgentActivityEvent {
  return createAgentActivityEvent({
    id: `${input.stageId}:started:${input.timestamp ?? Date.now()}`,
    stageId: input.stageId,
    kind: "stage_started",
    title: "进入阶段",
    content: input.summary || input.title,
    timestamp: input.timestamp,
  })
}

export function appendAgentActivityEvent(
  stages: AgentStageTrace[] | undefined,
  event: AgentActivityEvent,
): AgentStageTrace[] {
  return applyAgentActivityEvent(stages, event)
}

export function applyAgentActivityEvent(
  stages: AgentStageTrace[] | undefined,
  event: AgentActivityEvent,
): AgentStageTrace[] {
  const current = stages ?? []
  const existingIndex = current.findIndex((stage) => stage.id === event.stageId)
  const existingStage = existingIndex >= 0 ? current[existingIndex] : createStageFromEvent(event)
  const nextStage = applyEventToStage(existingStage, event)

  if (existingIndex < 0) return [...current, nextStage]

  return current.map((stage, index) => (index === existingIndex ? nextStage : stage))
}

export function summarizeAgentStage(stage: AgentStageTrace): string {
  const output = [...stage.events].reverse().find((event) => event.kind === "stage_output" || event.kind === "final_output")
  if (output?.content) return trimForSummary(output.content, 90)

  const last = [...stage.events].reverse().find((event) => event.content)
  if (last?.content) return trimForSummary(last.content, 90)

  return stage.summary || "本阶段暂无摘要。"
}

export function getDefaultOpenAgentStageId(stages: AgentStageTrace[]): string | null {
  return stages.find((stage) => stage.status === "running")?.id
    ?? stages.find((stage) => stage.status === "approval_required")?.id
    ?? stages.find((stage) => stage.status === "error")?.id
    ?? null
}

export function settleRunningAgentStages(
  stages: AgentStageTrace[] | undefined,
  status: Extract<AgentStageStatus, "done" | "error" | "cancelled"> = "done",
  timestamp: number = Date.now(),
): AgentStageTrace[] | undefined {
  if (!stages) return stages
  return stages.map((stage) => {
    if (stage.status !== "running" && stage.status !== "pending") return stage
    return {
      ...stage,
      status,
      finishedAt: timestamp,
      summary: stage.summary || summarizeAgentStage(stage),
    }
  })
}

export function activityEventFromToolEvent(event: AgentToolEvent): AgentActivityEvent {
  const kind = inferActivityKindFromToolName(event.name)
  const statusText = toolStatusText(event.type)
  return createAgentActivityEvent({
    id: `tool:${event.callId}:${event.type}:${event.timestamp}`,
    stageId: inferStageIdFromToolName(event.name),
    kind,
    title: `${statusText}：${event.name}`,
    content: event.result || event.preview || formatParams(event.params),
    toolCallId: event.callId,
    timestamp: event.timestamp,
  })
}

function createStageFromEvent(event: AgentActivityEvent): AgentStageTrace {
  return {
    id: event.stageId,
    title: inferStageTitle(event),
    status: "pending",
    summary: event.content,
    events: [],
  }
}

function applyEventToStage(stage: AgentStageTrace, event: AgentActivityEvent): AgentStageTrace {
  const events = [...stage.events, event].sort((a, b) => a.timestamp - b.timestamp)
  const status = statusFromEvent(stage.status, event)
  const startedAt = stage.startedAt ?? event.timestamp
  const finishedAt = status === "done" || status === "error" || status === "cancelled"
    ? event.timestamp
    : stage.finishedAt

  return {
    ...stage,
    title: event.kind === "stage_started" ? inferStageTitle(event) : stage.title,
    summary: event.kind === "stage_started" || event.kind === "stage_output" || event.kind === "final_output" || event.kind === "error"
      ? summarizeAgentStage({ ...stage, events })
      : stage.summary,
    status,
    events,
    startedAt,
    finishedAt,
  }
}

function statusFromEvent(current: AgentStageStatus, event: AgentActivityEvent): AgentStageStatus {
  if (event.kind === "error") return "error"
  if (event.kind === "stage_output" || event.kind === "final_output") return "done"
  if (current === "done" || current === "error" || current === "cancelled") return current
  if (event.kind === "tool_call" && /待确认|需要确认|approval/i.test(event.content)) return "approval_required"
  return "running"
}

function normalizeActivityContent(content: string): string {
  const trimmed = String(content ?? "").trim()
  if (!trimmed || trimmed === "undefined" || trimmed === "null") return EMPTY_CONTENT
  return trimmed
}

function trimForSummary(content: string, maxLength: number): string {
  const normalized = normalizeActivityContent(content).replace(/\s+/g, " ")
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

function formatParams(params: Record<string, unknown>): string {
  const entries = Object.entries(params)
  if (entries.length === 0) return "已调用工具。"
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join("\n")
}

function inferStageIdFromToolName(name: string): string {
  if (/read|context|chapter_context/.test(name)) return "read_context"
  if (/skill/.test(name)) return "capability_selection"
  if (/web|search/.test(name)) return "external_search"
  if (/workflow|draft|chapter_/.test(name)) return "chapter_workflow"
  if (/write|save|modify/.test(name)) return "write_confirmation"
  return "react_tools"
}

function inferStageTitle(event: AgentActivityEvent): string {
  const titles: Record<string, string> = {
    task_understanding: "任务理解",
    capability_selection: "能力选择",
    read_context: "读取上下文",
    plot_analysis: "分析剧情走向",
    chapter_workflow: "多任务写作循环",
    generate_draft: "生成章节草稿",
    validate_revision: "校验与修正",
    final_output: "最终输出",
    external_search: "外部检索",
    write_confirmation: "写入确认",
    react_tools: "工具调用",
  }
  return titles[event.stageId] ?? event.title
}

function inferActivityKindFromToolName(name: string): AgentActivityKind {
  if (/skill/.test(name)) return "skill_used"
  if (/mcp/.test(name)) return "mcp_call"
  if (/web|search/.test(name)) return "web_search"
  if (/read|context/.test(name)) return "read_source"
  return "tool_call"
}

function toolStatusText(type: AgentToolEvent["type"]): string {
  if (type === "call_started") return "开始调用"
  if (type === "result") return "调用完成"
  if (type === "approval_required") return "等待确认"
  if (type === "cancelled") return "已取消"
  return "调用失败"
}
