import type { AiCapability } from "@/lib/agent/capabilities/types"
import type { Tool } from "@/lib/agent/types"
import { adaptMcpTool } from "./adapter"
import type { McpConfig } from "./config"
import type { McpToolCaller, McpToolDescriptor } from "./types"
import type { RealMcpConnector } from "./real-connector"

export interface McpRuntime {
  mcpTools: Tool[]
  mcpCapabilities: AiCapability[]
  warnings: string[]
}

export const defaultUnavailableMcpCaller: McpToolCaller = async (request) => ({
  status: "error",
  content: "",
  summary: "",
  message: `MCP 服务“${request.serverName}”尚未连接，普通 AI 会话可以继续。本次未使用该 MCP 的外部结果。`,
})

export function buildMcpRuntime(
  config: McpConfig | null | undefined,
  caller: McpToolCaller = defaultUnavailableMcpCaller,
  realConnector?: Pick<RealMcpConnector, "caller">,
): McpRuntime {
  const mcpTools: Tool[] = []
  const mcpCapabilities: AiCapability[] = []
  const warnings: string[] = []

  for (const server of config?.servers ?? []) {
    if (!server.enabled) continue

    for (const descriptor of server.tools) {
      const normalized: McpToolDescriptor = {
        ...descriptor,
        serverId: descriptor.serverId || server.id,
        serverName: descriptor.serverName || server.name,
      }
      const selectedCaller = server.command && realConnector ? realConnector.caller : caller
      const result = adaptMcpTool(normalized, selectedCaller)
      if (!result.ok) {
        warnings.push(`MCP 工具“${server.name}/${descriptor.name}”未启用：${result.error}`)
        continue
      }

      mcpTools.push(result.tool)
      mcpCapabilities.push(toMcpCapability(normalized, result.tool))
    }
  }

  return { mcpTools, mcpCapabilities, warnings }
}

function toMcpCapability(descriptor: McpToolDescriptor, tool: Tool): AiCapability {
  return {
    id: `mcp:${descriptor.serverId}:${descriptor.name}`,
    name: `${descriptor.serverName} / ${descriptor.name}`,
    kind: "mcp_tool",
    permission: tool.permission ?? (tool.category === "write" ? "confirm" : "auto"),
    modes: ["strict"],
    intents: ["character_query", "setting_query", "search_plot", "general"],
    toolName: tool.name,
    source: "mcp",
  }
}
