import type { LlmConfig } from "@/stores/wiki-store"
import type { ChatMessage, RequestOverrides } from "../llm-providers"
import type { LlmUsage } from "../llm-usage"
import type { LlmRequestCacheTrace } from "../llm-request-trace"

export interface ToolParameter {
  type: "string" | "number" | "boolean" | "object" | "array" | "integer"
  description: string
  required?: boolean
  enum?: string[]
}

export type ToolCategory = "read" | "write" | "action" | "virtual"
export type ToolPermission = "auto" | "confirm"
export type ToolCallStatus = "running" | "done" | "error" | "approval_required" | "cancelled"

export interface ToolExecutionContext {
  callId: string
  toolName: string
  onToolEvent?: (event: AgentToolEvent) => void
  onActivityEvent?: (event: AgentActivityEvent) => void
  onRequestTrace?: (trace: LlmRequestCacheTrace) => void
  /**
   * 工具直接向用户交付终稿。多次调用按覆盖处理，最后一次为准。
   * 仅 finalizesRun 工具需要调用。
   */
  onFinalContent?: (content: string) => void
}

export interface Tool {
  name: string
  description: string
  category: ToolCategory
  permission?: ToolPermission
  /** 0 表示不使用通用工具超时，适用于内部有阶段进度和取消信号的长流程工具。 */
  executeTimeoutMs?: number
  /**
   * 该工具经 onFinalContent 自行交付终稿；成功交付后 runner 立即结束本 run，
   * 不再让模型复述或改写（见 AgentRunner / CodexAppServerRunner 的交付短路）。
   */
  finalizesRun?: boolean
  /**
   * Build trusted arguments when this tool is mandatory but the model fails
   * to call it. Only explicitly approved deterministic fallback entrypoints
   * should implement this hook.
   */
  buildRequiredToolFallbackParams?: (input: { taskGoal: string }) => Record<string, unknown>
  parameters: Record<string, ToolParameter>
  execute(params: Record<string, unknown>, signal?: AbortSignal, context?: ToolExecutionContext): Promise<string>
  generatePreview?: (params: Record<string, unknown>, signal?: AbortSignal, context?: ToolExecutionContext) => Promise<string>
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolCallDelta {
  index: number
  id?: string
  name?: string
  arguments?: string
}

export interface AgentConfig {
  maxRounds: number
  tools: Tool[]
  systemPrompt: string
  llmConfig: LlmConfig
  toolResultContextLimit?: number
  requestOverrides?: RequestOverrides
  /** 模型标识，用于上层识别当前使用的模型 */
  modelId?: string
  /** Stage F: 项目路径，用于断点持久化 */
  projectPath?: string
  /** Stage F: 本次任务目标，用于断点恢复 */
  taskGoal?: string
  /**
   * 本 run 结束前必须至少发起过一次的工具名。
   * 缺则拒绝无 tool 终稿并续轮（见 AgentRunner required-tools gate）。
   */
  requiredToolsOnce?: string[]
  /** Internal retry policy: execute deterministic required-tool fallbacks before asking the model. */
  forceRequiredToolsImmediately?: boolean
}

export interface RequiredToolRunDiagnostics {
  requiredTools: string[]
  satisfiedTools: string[]
  missingTools: string[]
  fallbackAttempted: boolean
  fallbackTool?: string
  fallbackStatus?: "success" | "error" | "unavailable"
  fallbackError?: string
  provider: LlmConfig["provider"]
  model: string
  reasoningMode: string
  roundsUsed: number
  finishReasons: string[]
  observedToolCalls: Array<{ round: number; index: number; name?: string }>
}

export interface AgentToolEvent {
  type: "call_started" | "result" | "error" | "approval_required" | "cancelled"
  callId: string
  parentCallId?: string
  name: string
  params: Record<string, unknown>
  result?: string
  preview?: string
  timestamp: number
}

export type AgentStageStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "approval_required"
  | "cancelled"

export type AgentActivityKind =
  | "stage_started"
  | "stage_input"
  | "read_source"
  | "extract_goal"
  | "extract_result"
  | "analysis"
  | "tool_call"
  | "skill_used"
  | "mcp_call"
  | "web_search"
  | "stage_output"
  | "final_output"
  | "error"

export interface AgentSourceRef {
  title: string
  path?: string
  type: string
}

export interface AgentActivityEvent {
  id: string
  stageId: string
  kind: AgentActivityKind
  title: string
  content: string
  sourceRefs?: AgentSourceRef[]
  toolCallId?: string
  timestamp: number
}

export interface AgentStageTrace {
  id: string
  title: string
  status: AgentStageStatus
  summary: string
  events: AgentActivityEvent[]
  startedAt?: number
  finishedAt?: number
}

export interface AgentRunCallbacks {
  onText: (chunk: string) => void
  onReasoningToken?: (chunk: string) => void
  onToolCall: (call: ToolCall) => void
  onToolResult: (callId: string, result: string) => void
  onToolError: (callId: string, error: string) => void
  onToolEvent?: (event: AgentToolEvent) => void
  onActivityEvent?: (event: AgentActivityEvent) => void
  /** finalizesRun 工具交付的终稿，按覆盖处理。 */
  onFinalContent?: (content: string) => void
  /** Usage for the current/latest provider request. */
  onUsage?: (usage: LlmUsage) => void
  onRequestTrace?: (trace: LlmRequestCacheTrace) => void
  onUserMemoryDecision?: (decision: import("@/lib/user-memory/decision-trace").UserMemoryDecision | null) => void
  onDone: () => void
  onError: (error: Error) => void
}

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: ChatMessage["content"]
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]
  tool_call_id?: string
  name?: string
  reasoning_content?: string
}

export interface AgentRunRecord {
  toolCalls: {
    id: string
    parentCallId?: string
    name: string
    params: Record<string, unknown>
    result: string
    preview?: string
    status: ToolCallStatus
    startedAt: number
    finishedAt: number
  }[]
  roundsUsed: number
  finalText: string
  /** Cumulative provider usage across all requests in this agent run. */
  usage?: LlmUsage
  /** Provider-managed thread totals cannot be assigned a reliable internal request count. */
  usageAggregationScope?: "workflow" | "provider_thread"
  providerRequestCountAvailable?: boolean
  /** Provider usage for the final request only; used for context-window UI. */
  lastRequestUsage?: LlmUsage
  /** Sanitized request traces for this run, including nested workflow calls. */
  requestTraces?: LlmRequestCacheTrace[]
  omittedRequestTraceCount?: number
  /** Memory decision from the first LLM round that applied user memory. */
  userMemoryDecision?: import("@/lib/user-memory/decision-trace").UserMemoryDecision | null
  /** Required-tool convergence and sanitized provider/tool-selection diagnostics. */
  requiredToolDiagnostics?: RequiredToolRunDiagnostics
}

export const DEFAULT_MAX_ROUNDS = 15
export const TOOL_EXECUTE_TIMEOUT_MS = 30_000
