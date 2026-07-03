import type { LlmConfig } from "@/stores/wiki-store"
import type { RequestOverrides } from "../llm-providers"

export interface ToolParameter {
  type: "string" | "number" | "boolean" | "object" | "array" | "integer"
  description: string
  required?: boolean
  enum?: string[]
}

export type ToolCategory = "read" | "write" | "action" | "virtual"
export type ToolPermission = "auto" | "confirm"
export type ToolCallStatus = "running" | "done" | "error" | "approval_required" | "cancelled"

export interface Tool {
  name: string
  description: string
  category: ToolCategory
  permission?: ToolPermission
  parameters: Record<string, ToolParameter>
  execute(params: Record<string, unknown>, signal?: AbortSignal): Promise<string>
  generatePreview?: (params: Record<string, unknown>, signal?: AbortSignal) => Promise<string>
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
}

export interface AgentToolEvent {
  type: "call_started" | "result" | "error" | "approval_required" | "cancelled"
  callId: string
  name: string
  params: Record<string, unknown>
  result?: string
  preview?: string
  timestamp: number
}

export interface AgentRunCallbacks {
  onText: (chunk: string) => void
  onToolCall: (call: ToolCall) => void
  onToolResult: (callId: string, result: string) => void
  onToolError: (callId: string, error: string) => void
  onToolEvent?: (event: AgentToolEvent) => void
  onDone: () => void
  onError: (error: Error) => void
}

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]
  tool_call_id?: string
  name?: string
}

export interface AgentRunRecord {
  toolCalls: {
    id: string
    name: string
    params: Record<string, unknown>
    result: string
    status: ToolCallStatus
    startedAt: number
    finishedAt: number
  }[]
  roundsUsed: number
  finalText: string
}

export const DEFAULT_MAX_ROUNDS = 15
export const TOOL_EXECUTE_TIMEOUT_MS = 30_000
