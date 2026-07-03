import type { Tool, ToolParameter } from "@/lib/agent/types"
import type {
  McpJsonSchema,
  McpToolCaller,
  McpToolDescriptor,
  McpToolOperation,
  McpToolPolicy,
} from "./types"

const SUPPORTED_PARAMETER_TYPES = new Set<ToolParameter["type"]>([
  "string",
  "number",
  "boolean",
  "object",
  "array",
  "integer",
])

export type AdaptMcpToolResult =
  | { ok: true; tool: Tool }
  | { ok: false; error: string }

export function mapMcpOperationToToolPolicy(operation: McpToolOperation): McpToolPolicy {
  if (operation === "read") {
    return { category: "read", permission: "auto", blocked: false }
  }
  if (operation === "analysis" || operation === "suggestion") {
    return { category: "action", permission: "auto", blocked: false }
  }
  if (operation === "write") {
    return { category: "write", permission: "confirm", blocked: false }
  }
  return { category: "write", permission: "confirm", blocked: true }
}

export function adaptMcpTool(
  descriptor: McpToolDescriptor,
  caller: McpToolCaller,
): AdaptMcpToolResult {
  const policy = mapMcpOperationToToolPolicy(descriptor.operation)
  if (policy.blocked) {
    return {
      ok: false,
      error: "高风险 MCP 工具暂未启用。删除或覆盖类 MCP 操作需要单独安全设计。",
    }
  }

  const converted = mcpSchemaToToolParameters(descriptor.inputSchema)
  if (!converted.ok) return converted

  return {
    ok: true,
    tool: createMcpToolFromParameters(descriptor, caller, converted.parameters),
  }
}

export function createMcpTool(
  descriptor: McpToolDescriptor,
  caller: McpToolCaller,
): Tool {
  const converted = mcpSchemaToToolParameters(descriptor.inputSchema)
  const parameters = converted.ok ? converted.parameters : {}
  return createMcpToolFromParameters(descriptor, caller, parameters)
}

export function mcpToolName(descriptor: McpToolDescriptor): string {
  return `mcp_${sanitizeName(descriptor.serverId)}_${sanitizeName(descriptor.name)}`
}

function createMcpToolFromParameters(
  descriptor: McpToolDescriptor,
  caller: McpToolCaller,
  parameters: Record<string, ToolParameter>,
): Tool {
  const policy = mapMcpOperationToToolPolicy(descriptor.operation)
  const qmaiToolName = mcpToolName(descriptor)
  return {
    name: qmaiToolName,
    description: descriptor.description,
    category: policy.category,
    permission: policy.permission,
    parameters,
    execute: async (params, signal) => {
      try {
        const result = await caller({
          serverId: descriptor.serverId,
          serverName: descriptor.serverName,
          toolName: descriptor.name,
          qmaiToolName,
        }, params, signal)
        return JSON.stringify({
          status: result.status,
          serverId: descriptor.serverId,
          serverName: descriptor.serverName,
          toolName: descriptor.name,
          content: result.content,
          summary: result.summary,
          message: result.message,
        })
      } catch (error) {
        return JSON.stringify({
          status: "error",
          serverId: descriptor.serverId,
          serverName: descriptor.serverName,
          toolName: descriptor.name,
          content: "",
          summary: "",
          message: `MCP 调用失败，普通 AI 会话可以继续。原因：${error instanceof Error ? error.message : String(error)}`,
        })
      }
    },
  }
}

function mcpSchemaToToolParameters(schema: McpJsonSchema): { ok: true; parameters: Record<string, ToolParameter> } | { ok: false; error: string } {
  const parameters: Record<string, ToolParameter> = {}
  const required = new Set(schema.required ?? [])
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    if (!SUPPORTED_PARAMETER_TYPES.has(property.type as ToolParameter["type"])) {
      return { ok: false, error: `不支持的 MCP 参数类型：${name}=${property.type}` }
    }
    parameters[name] = {
      type: property.type as ToolParameter["type"],
      description: property.description ?? name,
      required: required.has(name),
      enum: property.enum,
    }
  }
  return { ok: true, parameters }
}

function sanitizeName(value: string): string {
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
  return sanitized || "tool"
}
