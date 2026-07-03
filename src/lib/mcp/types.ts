import type { ToolCategory, ToolParameter, ToolPermission } from "@/lib/agent/types"

export type McpToolOperation = "read" | "analysis" | "suggestion" | "write" | "delete" | "overwrite"

export interface McpJsonSchemaProperty {
  type: ToolParameter["type"] | "function" | string
  description?: string
  enum?: string[]
}

export interface McpJsonSchema {
  type: "object"
  properties?: Record<string, McpJsonSchemaProperty>
  required?: string[]
}

export interface McpToolDescriptor {
  serverId: string
  serverName: string
  name: string
  description: string
  operation: McpToolOperation
  inputSchema: McpJsonSchema
}

export interface McpToolPolicy {
  category: ToolCategory
  permission: ToolPermission
  blocked: boolean
}

export interface McpToolCallRequest {
  serverId: string
  serverName: string
  toolName: string
  qmaiToolName: string
}

export interface McpToolCallResult {
  status: "ok" | "error"
  content: string
  summary?: string
  message?: string
}

export type McpToolCaller = (
  request: McpToolCallRequest,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<McpToolCallResult>
