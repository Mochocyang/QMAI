import type { McpConfig, McpServerConfig } from "./config"
import type { McpToolCaller, McpToolCallRequest, McpToolCallResult } from "./types"
import { JsonRpcClient } from "./transport/json-rpc"
import { TauriStdioTransport } from "./transport/stdio"

interface ConnectedMcpServer {
  client: JsonRpcClient
}

export class RealMcpConnector {
  private clients = new Map<string, ConnectedMcpServer>()

  constructor(private readonly config: McpConfig) {}

  get caller(): McpToolCaller {
    return this.call.bind(this)
  }

  async ensureConnected(serverId: string): Promise<JsonRpcClient> {
    const existing = this.clients.get(serverId)
    if (existing) return existing.client

    const server = this.findServer(serverId)
    if (!server) {
      throw new Error(`未找到 MCP 服务：${serverId}`)
    }
    if (!server.command) {
      throw new Error(`MCP 服务“${server.name}”未配置启动命令`)
    }

    const transport = new TauriStdioTransport({
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      env: server.env,
    })
    const client = new JsonRpcClient(transport)
    await client.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "QMaiWrite",
        version: "2.2.31",
      },
    })

    this.clients.set(serverId, { client })
    return client
  }

  async call(
    request: McpToolCallRequest,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
  ): Promise<McpToolCallResult> {
    try {
      const client = await this.ensureConnected(request.serverId)
      const result = await client.call("tools/call", {
        name: request.toolName,
        arguments: params,
      })
      const content = extractMcpText(result)
      return {
        status: "ok",
        content,
        summary: content,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        status: "error",
        content: "",
        summary: "",
        message: `MCP 服务“${request.serverName}”调用失败：${message}。普通 AI 会话可以继续，本次未使用该 MCP 的外部结果。`,
      }
    }
  }

  async closeAll(): Promise<void> {
    const clients = Array.from(this.clients.values())
    this.clients.clear()
    await Promise.all(clients.map(({ client }) => client.close().catch(() => undefined)))
  }

  private findServer(serverId: string): McpServerConfig | null {
    return this.config.servers.find((server) => server.id === serverId && server.enabled) ?? null
  }
}

function extractMcpText(result: unknown): string {
  if (!isRecord(result)) return stringifyResult(result)
  const content = result.content
  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        if (!isRecord(item)) return ""
        return item.type === "text" && typeof item.text === "string" ? item.text : ""
      })
      .filter(Boolean)
      .join("\n")
      .trim()
    if (text) return text
  }
  if (typeof result.text === "string") return result.text
  return stringifyResult(result)
}

function stringifyResult(result: unknown): string {
  if (typeof result === "string") return result
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
