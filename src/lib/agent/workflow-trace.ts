import type { ContextTrace } from "./context-trace"
import type { ToolCallStatus } from "./types"

export type AgentWorkflowStepStatus =
  | "pending"
  | "running"
  | "done"
  | "approval_required"
  | "error"
  | "cancelled"

export type AgentWorkflowStepKind =
  | "intent"
  | "skill"
  | "context"
  | "tool"
  | "decision"
  | "validation"

export interface WorkflowToolCall {
  id: string
  parentCallId?: string
  name: string
  params: Record<string, unknown>
  result?: string
  preview?: string
  status: ToolCallStatus
  startedAt: number
  finishedAt?: number
}

export interface AgentWorkflowDetail {
  label: string
  value: string
  tone?: "default" | "muted" | "warning" | "error" | "success"
}

export interface AgentWorkflowStep {
  id: string
  kind: AgentWorkflowStepKind
  title: string
  summary: string
  status: AgentWorkflowStepStatus
  details: AgentWorkflowDetail[]
  startedAt?: number
  finishedAt?: number
}

interface BuildAgentWorkflowStepsInput {
  toolCalls?: WorkflowToolCall[]
  contextTrace?: ContextTrace | null
}

const LIST_TOOLS = new Set(["list_chapters", "list_outlines", "list_memories", "list_deductions"])
const READ_TOOLS = new Set([
  "read_chapter",
  "read_outline",
  "read_memory",
  "read_deduction",
  "read_chat_history",
  "read_outline_history",
  "search_chapters",
])
const WRITE_TOOLS = new Set(["write_chapter", "write_outline_node", "write_memory"])
const SKILL_TOOLS = new Set(["apply_skill"])
const ROUTE_TOOLS = new Set(["route_task"])
const CHAPTER_CONTEXT_TOOLS = new Set(["chapter_context", "chapter_previous_analysis"])

const INTENT_LABELS: Record<string, string> = {
  write_chapter: "生成小说章节",
  continue_chapter: "续写章节",
  rewrite_chapter: "改写章节",
  polish_chapter: "润色章节",
  review_chapter: "AI 审稿",
  lint_chapter: "连贯性检查",
  generate_outline: "生成大纲",
  search_plot: "剧情搜索",
  extract_memory: "章节提取",
  character_query: "人物查询",
  foreshadowing_query: "伏笔查询",
  timeline_query: "时间线查询",
  setting_query: "设定查询",
  general_chat: "普通问答",
}

function normalizeToolCalls(input: BuildAgentWorkflowStepsInput): WorkflowToolCall[] {
  if (input.toolCalls && input.toolCalls.length > 0) return input.toolCalls
  return (input.contextTrace?.toolCalls ?? []).map((call) => ({
    id: call.id,
    name: call.name,
    params: call.params,
    result: call.result ?? call.error ?? "",
    preview: call.preview,
    status: call.status,
    startedAt: call.startedAt,
    finishedAt: call.finishedAt,
  }))
}

function getStringParam(params: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = params[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number") return String(value)
  }
  return ""
}

function getPathLabel(value: string): string {
  const normalized = value.replace(/\\/g, "/")
  return normalized.split("/").filter(Boolean).pop() || value
}

export function getWorkflowToolDescription(call: WorkflowToolCall): string {
  switch (call.name) {
    case "read_chapter": {
      const target = getStringParam(call.params, "name", "title", "path")
      return target ? `读取章节《${getPathLabel(target)}》` : "读取章节"
    }
    case "read_outline": {
      const target = getStringParam(call.params, "name", "title", "path")
      return target ? `读取大纲《${getPathLabel(target)}》` : "读取大纲"
    }
    case "read_memory": {
      const target = getStringParam(call.params, "name", "title", "path")
      return target ? `读取记忆「${getPathLabel(target)}」` : "读取记忆"
    }
    case "read_deduction": {
      const target = getStringParam(call.params, "name", "title", "path")
      return target ? `读取推演「${getPathLabel(target)}」` : "读取推演"
    }
    case "read_chat_history": {
      const target = getStringParam(call.params, "conversationTitle", "conversationId", "name")
      return target ? `读取 AI 会话「${target}」` : "读取 AI 会话"
    }
    case "read_outline_history": {
      const target = getStringParam(call.params, "conversationTitle", "conversationId", "name")
      return target ? `读取 AI 大纲「${target}」` : "读取 AI 大纲"
    }
    case "search_chapters": {
      const keyword = getStringParam(call.params, "keyword", "query")
      return keyword ? `搜索章节关键词「${keyword}」` : "搜索章节资料"
    }
    case "list_chapters":
    case "list_outlines":
    case "list_memories":
    case "list_deductions":
      return "整理资料范围"
    case "write_chapter": {
      const target = getStringParam(call.params, "name", "title", "path")
      return target ? `生成章节写入草稿《${getPathLabel(target)}》` : "生成章节写入草稿"
    }
    case "write_outline_node": {
      const node = getStringParam(call.params, "nodeTitle")
      const outline = getStringParam(call.params, "outlineName", "name")
      if (node && outline) return `生成大纲节点写入草稿「${node}」到「${outline}」`
      return node ? `生成大纲节点写入草稿「${node}」` : "生成大纲节点写入草稿"
    }
    case "write_memory": {
      const target = getStringParam(call.params, "name", "title", "path")
      return target ? `生成记忆写入草稿「${getPathLabel(target)}」` : "生成记忆写入草稿"
    }
    case "apply_skill": {
      const target = getStringParam(call.params, "skillName", "skillId", "name")
      return target ? `应用技能「${target}」` : "应用写作技能"
    }
    case "route_task":
      return "识别任务意图"
    case "load_context":
      return "加载小说上下文"
    case "trim_context":
      return "整理上下文长度"
    case "run_chapter_workflow":
      return "运行章节工作流"
    case "chapter_context":
      return "读取章节上下文"
    case "chapter_previous_analysis":
      return "分析前情章节"
    case "chapter_task_brief":
      return "生成写作任务书"
    case "chapter_draft":
      return "生成章节正文初稿"
    case "chapter_expansion":
      return "正文扩写补足"
    case "chapter_review":
      return "执行 AI 审稿"
    case "chapter_revision":
      return "自动返修章节正文"
    case "chapter_post_revision_review":
      return "返修后角色一致性复审"
    case "chapter_final_polish":
      return "简单审查与去AI味"
    case "chapter_execution_report":
      return "检查章节执行清单"
    case "chapter_execution_repair":
      return "返修执行清单失败项"
    case "chapter_execution_recheck":
      return "复检章节执行清单"
    case "chapter_plan_compliance":
      return "检查章节计划履约度"
    case "chapter_plan_deviation_repair":
      return "返修章节计划偏离点"
    case "chapter_plan_deviation_recheck":
      return "复检章节计划履约度"
    case "chapter_complete":
      return "完成多任务写作循环"
    default:
      return call.name
  }
}

function mergeStatus(calls: WorkflowToolCall[], fallback: AgentWorkflowStepStatus = "done"): AgentWorkflowStepStatus {
  if (calls.some((call) => call.status === "running")) return "running"
  if (calls.some((call) => call.status === "approval_required")) return "approval_required"
  if (calls.some((call) => call.status === "error")) return "error"
  if (calls.some((call) => call.status === "cancelled")) return "cancelled"
  if (calls.length === 0) return fallback
  return "done"
}

function getFirstStartedAt(calls: WorkflowToolCall[]): number | undefined {
  const values = calls.map((call) => call.startedAt).filter((value) => Number.isFinite(value))
  return values.length > 0 ? Math.min(...values) : undefined
}

function getLastFinishedAt(calls: WorkflowToolCall[]): number | undefined {
  const values = calls.map((call) => call.finishedAt).filter((value): value is number => Number.isFinite(value))
  return values.length > 0 ? Math.max(...values) : undefined
}

function uniqueDetails(details: AgentWorkflowDetail[]): AgentWorkflowDetail[] {
  const seen = new Set<string>()
  return details.filter((detail) => {
    const key = `${detail.label}:${detail.value}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildIntentStep(calls: WorkflowToolCall[], contextTrace?: ContextTrace | null): AgentWorkflowStep {
  const routeCall = calls.find((call) => ROUTE_TOOLS.has(call.name))
  const info = contextTrace?.contextInfo
  const intent = info?.intent || getStringParam(routeCall?.params ?? {}, "intent")
  const label = intent ? (INTENT_LABELS[intent] || intent) : "根据用户输入判断任务"
  const confidence = typeof info?.confidence === "number" ? `${Math.round(info.confidence * 100)}%` : ""
  const details: AgentWorkflowDetail[] = [
    intent ? { label: "任务意图", value: label, tone: "success" } : { label: "任务意图", value: "等待模型判断" },
    confidence ? { label: "置信度", value: confidence } : null,
    info?.routeSource ? { label: "路由来源", value: info.routeSource } : null,
  ].filter(Boolean) as AgentWorkflowDetail[]

  const status = routeCall ? mergeStatus([routeCall]) : info ? "done" : "pending"
  return {
    id: "intent",
    kind: "intent",
    title: "任务理解",
    summary: intent ? `识别为“${label}”，按该目标准备资料和输出格式。` : "正在根据用户输入判断任务目标。",
    status,
    details,
    startedAt: routeCall?.startedAt ?? contextTrace?.startedAt,
    finishedAt: routeCall?.finishedAt,
  }
}

function buildSkillStep(calls: WorkflowToolCall[]): AgentWorkflowStep {
  const skillCalls = calls.filter((call) => SKILL_TOOLS.has(call.name))
  const details = uniqueDetails(
    skillCalls.map((call) => ({
      label: "使用技能",
      value: getWorkflowToolDescription(call),
      tone: call.status === "error" ? "error" : "success",
    })),
  )
  const status = mergeStatus(skillCalls, "done")
  return {
    id: "skill",
    kind: "skill",
    title: "使用技能",
    summary: details.length > 0 ? `已应用 ${details.length} 个写作技能约束。` : "本轮未调用专用技能。",
    status,
    details: details.length > 0 ? details : [{ label: "技能", value: "未调用专用技能", tone: "muted" }],
    startedAt: getFirstStartedAt(skillCalls),
    finishedAt: getLastFinishedAt(skillCalls),
  }
}

function buildContextStep(calls: WorkflowToolCall[], contextTrace?: ContextTrace | null): AgentWorkflowStep {
  const contextCalls = calls.filter((call) => LIST_TOOLS.has(call.name) || READ_TOOLS.has(call.name) || CHAPTER_CONTEXT_TOOLS.has(call.name) || call.name === "load_context" || call.name === "trim_context")
  const listCount = contextCalls.filter((call) => LIST_TOOLS.has(call.name)).length
  const readDetails = contextCalls
    .filter((call) => READ_TOOLS.has(call.name) || CHAPTER_CONTEXT_TOOLS.has(call.name) || call.name === "load_context" || call.name === "trim_context")
    .map((call): AgentWorkflowDetail => ({
      label: call.status === "running" ? "正在处理" : call.status === "error" ? "读取失败" : "已读取",
      value: getWorkflowToolDescription(call),
      tone: call.status === "error" ? "error" : call.status === "running" ? "warning" : "success",
    }))
  const details = uniqueDetails([
    ...(listCount > 0 ? [{ label: "资料范围", value: `已整理 ${listCount} 类资料范围`, tone: "success" as const }] : []),
    ...readDetails,
    ...(contextTrace?.contextInfo?.contextBudget
      ? [{
          label: "上下文预算",
          value: `${contextTrace.contextInfo.contextBudget.used.toLocaleString()} / ${contextTrace.contextInfo.contextBudget.limit.toLocaleString()} 字符`,
        }]
      : []),
  ])
  const status = mergeStatus(contextCalls, contextTrace?.status === "running" ? "running" : "done")
  const runningCall = contextCalls.find((call) => call.status === "running")
  const completedReads = contextCalls.filter((call) => call.status === "done" && READ_TOOLS.has(call.name)).length
  let summary = "未加载额外资料。"
  if (runningCall) summary = `正在${getWorkflowToolDescription(runningCall)}。`
  else if (details.length > 0) summary = listCount > 0 || completedReads > 0
    ? `已整理资料范围，并读取 ${completedReads} 项相关内容。`
    : details[0]?.value ?? summary

  return {
    id: "context",
    kind: "context",
    title: "上下文准备",
    summary,
    status,
    details: details.length > 0 ? details : [{ label: "上下文", value: "没有需要展开的读取记录", tone: "muted" }],
    startedAt: getFirstStartedAt(contextCalls),
    finishedAt: getLastFinishedAt(contextCalls),
  }
}

function buildToolStep(calls: WorkflowToolCall[]): AgentWorkflowStep {
  const toolCalls = calls.filter((call) => !ROUTE_TOOLS.has(call.name) && !SKILL_TOOLS.has(call.name))
  const status = mergeStatus(toolCalls)
  const doneCount = toolCalls.filter((call) => call.status === "done").length
  const approvalCount = toolCalls.filter((call) => call.status === "approval_required").length
  const errorCount = toolCalls.filter((call) => call.status === "error").length
  const hasChapterWorkflow = toolCalls.some((call) => call.name === "run_chapter_workflow" || call.parentCallId)
  const details = uniqueDetails(toolCalls.map((call) => ({
    label: call.status === "approval_required" ? "等待确认" : call.status === "error" ? "失败" : "工具",
    value: getWorkflowToolDescription(call),
    tone: call.status === "approval_required" ? "warning" : call.status === "error" ? "error" : "default",
  })))
  const summaryParts = [hasChapterWorkflow ? `章节工作流调用 ${toolCalls.length} 个步骤` : `调用 ${toolCalls.length} 个工具`]
  if (doneCount > 0) summaryParts.push(`${doneCount} 个完成`)
  if (approvalCount > 0) summaryParts.push(`${approvalCount} 个等待确认`)
  if (errorCount > 0) summaryParts.push(`${errorCount} 个失败`)

  return {
    id: "tool",
    kind: "tool",
    title: "工具调用",
    summary: toolCalls.length > 0 ? `${summaryParts.join("，")}。` : "本轮没有工具调用。",
    status,
    details: details.length > 0 ? details : [{ label: "工具", value: "无工具调用", tone: "muted" }],
    startedAt: getFirstStartedAt(toolCalls),
    finishedAt: getLastFinishedAt(toolCalls),
  }
}

function buildDecisionStep(calls: WorkflowToolCall[], contextTrace?: ContextTrace | null): AgentWorkflowStep {
  const info = contextTrace?.contextInfo
  const protocolType = info?.resultProtocol?.type
  const hasWriteApproval = calls.some((call) => WRITE_TOOLS.has(call.name) && call.status === "approval_required")
  const summary = hasWriteApproval
    ? "判断本轮涉及写入，必须等待用户确认后才能保存。"
    : protocolType
      ? `判断最终结果应保持“${protocolType}”格式，不把过程分析混入正文。`
      : "判断最终回复应按用户任务直接输出，过程只保留在折叠面板。"
  return {
    id: "decision",
    kind: "decision",
    title: "思考与决策",
    summary,
    status: mergeStatus(calls),
    details: [
      { label: "输出边界", value: "最终正文区只放任务结果，不放工具报告或读取清单。", tone: "success" },
      hasWriteApproval
        ? { label: "写入安全", value: "写入草稿需要用户确认，不自动保存。", tone: "warning" }
        : { label: "写入安全", value: "未触发自动写入。", tone: "muted" },
    ],
  }
}

function buildValidationStep(calls: WorkflowToolCall[], contextTrace?: ContextTrace | null): AgentWorkflowStep {
  const protocol = contextTrace?.contextInfo?.resultProtocol
  const status = contextTrace?.status === "error" ? "error" : mergeStatus(calls)
  if (!protocol) {
    return {
      id: "validation",
      kind: "validation",
      title: "生成与校验",
      summary: "结果将按任务类型输出，避免混入过程说明。",
      status,
      details: [{ label: "校验", value: "等待最终结果格式校验。", tone: "muted" }],
    }
  }

  const details: AgentWorkflowDetail[] = [
    { label: "期望类型", value: protocol.type },
    { label: "校验结果", value: protocol.valid ? "通过" : "未通过", tone: protocol.valid ? "success" : "error" },
    ...(protocol.warnings ?? []).map((warning) => ({ label: "警告", value: warning, tone: "warning" as const })),
    ...(protocol.errors ?? []).map((error) => ({ label: "错误", value: error, tone: "error" as const })),
  ]

  return {
    id: "validation",
    kind: "validation",
    title: "生成与校验",
    summary: protocol.valid
      ? `结果已按“${protocol.type}”格式校验。`
      : `结果未通过“${protocol.type}”格式校验。`,
    status: protocol.valid ? "done" : "error",
    details,
    finishedAt: protocol.validatedAt,
  }
}

export function buildAgentWorkflowSteps(input: BuildAgentWorkflowStepsInput): AgentWorkflowStep[] {
  const calls = normalizeToolCalls(input)
  if (calls.length === 0 && !input.contextTrace?.contextInfo) return []
  return [
    buildIntentStep(calls, input.contextTrace),
    buildSkillStep(calls),
    buildContextStep(calls, input.contextTrace),
    buildToolStep(calls),
    buildDecisionStep(calls, input.contextTrace),
    buildValidationStep(calls, input.contextTrace),
  ]
}
