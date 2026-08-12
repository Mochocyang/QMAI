import type { LlmConfig } from "@/stores/wiki-store"
import type { ChatMessage, RequestOverrides } from "../llm-providers"
import type { LlmUsage } from "../llm-usage"

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
}

export interface Tool {
  name: string
  description: string
  category: ToolCategory
  permission?: ToolPermission
  /** 0 表示不使用通用工具超时，适用于内部有阶段进度和取消信号的长流程工具。 */
  executeTimeoutMs?: number
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
  /** Cumulative prompt/usage so far across agent rounds. */
  onUsage?: (usage: LlmUsage) => void
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
  usage?: LlmUsage
  /** Memory decision from the first LLM round that applied user memory. */
  userMemoryDecision?: import("@/lib/user-memory/decision-trace").UserMemoryDecision | null
}

export const DEFAULT_MAX_ROUNDS = 15
export const TOOL_EXECUTE_TIMEOUT_MS = 30_000
