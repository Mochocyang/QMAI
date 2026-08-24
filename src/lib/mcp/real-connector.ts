import type { McpConfig, McpServerConfig } from "./config"
import type { McpJsonSchema, McpToolCaller, McpToolCallRequest, McpToolCallResult, McpToolDescriptor } from "./types"
import { JsonRpcClient } from "./transport/json-rpc"
import { TauriStdioTransport } from "./transport/stdio"

interface ConnectedMcpServer {
  client: JsonRpcClient
  remoteTools: RemoteToolInfo[]
}

/** MCP tools/list 返回的单个工具原始信息（MCP 标准 schema）。 */
interface RemoteToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

interface McpTestConnectionResult {
  status: "ok" | "error"
  serverName: string
  toolCount: number
  tools: Pick<RemoteToolInfo, "name" | "description">[]
  message: string
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
    // MCP 协议规定客户端 initialize 后必须发 notifications/initialized 通知，
    // 部分严格 server 不收到此通知会拒绝后续 tools/list / tools/call。
    await client.notify("notifications/initialized")
    // 握手后立即拉取远端工具列表，用于校验/回填本地 descriptor（见 listRemoteTools）。
    const remoteTools = await this.fetchTools(client)

    this.clients.set(serverId, { client, remoteTools })
    return client
  }

  /**
   * 返回指定服务握手时拉取的远端工具列表。若尚未连接会先触发 ensureConnected。
   * 设置页“测试连接”按钮复用此能力，避免重复进程握手。
   */
  async listRemoteTools(serverId: string): Promise<RemoteToolInfo[]> {
    const entry = this.clients.get(serverId)
    if (entry) return entry.remoteTools
    await this.ensureConnected(serverId)
    return this.clients.get(serverId)?.remoteTools ?? []
  }

  /**
   * 设置页一键测试连接：握手 + tools/list 即时反馈，失败返回中文降级信息。
   * 不修改本地配置，只做只读探测。
   */
  async testConnection(serverId: string): Promise<McpTestConnectionResult> {
    const server = this.findServer(serverId)
    const serverName = server?.name ?? serverId
    try {
      const tools = await this.listRemoteTools(serverId)
      return {
        status: "ok",
        serverName,
        toolCount: tools.length,
        tools: tools.map((t) => ({ name: t.name, description: t.description })),
        message: `MCP 服务“${serverName}”连接成功，发现 ${tools.length} 个可用工具。`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        status: "error",
        serverName,
        toolCount: 0,
        tools: [],
        message: `MCP 服务“${serverName}”连接失败：${message}`,
      }
    }
  }

  /**
   * 合并远端 tools/list 与本地 descriptor：以远端 name/description/inputSchema 为权威，
   * 本地 operation（权限策略）若已配置则保留，未配置则默认 read。
   * 仅保留本地已声明的工具名（避免远端未授权工具自动暴露给 AI 会话）。
   */
  mergeRemoteTools(serverId: string, localTools: McpToolDescriptor[]): McpToolDescriptor[] {
    const remote = this.clients.get(serverId)?.remoteTools ?? []
    if (remote.length === 0) return localTools
    const remoteByName = new Map(remote.map((t) => [t.name, t]))
    return localTools.map((local) => {
      const r = remoteByName.get(local.name)
      if (!r) return local
      return {
        ...local,
        description: r.description?.trim() || local.description,
        inputSchema: normalizeRemoteSchema(r.inputSchema) ?? local.inputSchema,
      }
    })
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

  private async fetchTools(client: JsonRpcClient): Promise<RemoteToolInfo[]> {
    try {
      const result = await client.call<{ tools?: RemoteToolInfo[] }>("tools/list", {})
      return Array.isArray(result?.tools) ? result.tools : []
    } catch {
      // tools/list 失败不阻断握手；descriptor 继续以本地配置为准。
      return []
    }
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

/** 把远端 inputSchema 规整成 McpJsonSchema，不合法时返回 null（由调用方回退到本地）。 */
function normalizeRemoteSchema(schema: unknown): McpJsonSchema | null {
  if (!isRecord(schema) || schema.type !== "object") return null
  const properties = isRecord(schema.properties)
    ? (schema.properties as McpJsonSchema["properties"])
    : undefined
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string")
    : undefined
  return { type: "object", properties, required }
}
