import type { LlmConfig } from "@/stores/wiki-store"

export interface ToolParameter {
  type: "string" | "number" | "boolean" | "object" | "array" | "integer"
  description: string
  required?: boolean
  enum?: string[]
}

export type ToolCategory = "read" | "write" | "action"

export interface Tool {
  name: string
  description: string
  category: ToolCategory
  parameters: Record<string, ToolParameter>
  execute(params: Record<string, unknown>, signal?: AbortSignal): Promise<string>
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
}

export interface AgentRunCallbacks {
  onText: (chunk: string) => void
  onToolCall: (call: ToolCall) => void
  onToolResult: (callId: string, result: string) => void
  onToolError: (callId: string, error: string) => void
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
    status: "done" | "error"
    startedAt: number
    finishedAt: number
  }[]
  roundsUsed: number
  finalText: string
}

export const DEFAULT_MAX_ROUNDS = 15
export const TOOL_EXECUTE_TIMEOUT_MS = 30_000
