import { beforeEach, describe, expect, it, vi } from "vitest"
import { RealMcpConnector } from "./real-connector"
import type { McpConfig } from "./config"

const transportMocks = vi.hoisted(() => ({
  TauriStdioTransport: vi.fn(),
}))

const clientMocks = vi.hoisted(() => ({
  call: vi.fn(),
  close: vi.fn(async () => {}),
  JsonRpcClient: vi.fn(),
}))

vi.mock("./transport/stdio", () => transportMocks)
vi.mock("./transport/json-rpc", () => clientMocks)

const config: McpConfig = {
  servers: [
    {
      id: "graph",
      name: "图谱 MCP",
      enabled: true,
      command: "node",
      args: ["server.js"],
      tools: [
        {
          serverId: "graph",
          serverName: "图谱 MCP",
          name: "query_graph",
          description: "查询图谱",
          operation: "read",
          inputSchema: { type: "object" },
        },
      ],
    },
  ],
}

describe("RealMcpConnector", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transportMocks.TauriStdioTransport.mockImplementation(function (this: { options: unknown }, options) {
      this.options = options
    })
    clientMocks.JsonRpcClient.mockImplementation(function (this: { call: unknown; close: unknown }) {
      this.call = clientMocks.call
      this.close = clientMocks.close
    })
    clientMocks.call.mockResolvedValue({})
  })

  it("ensureConnected 首次调用时创建 stdio transport 并 initialize", async () => {
    const connector = new RealMcpConnector(config)

    await connector.ensureConnected("graph")

    expect(transportMocks.TauriStdioTransport).toHaveBeenCalledWith({
      command: "node",
      args: ["server.js"],
      cwd: undefined,
      env: undefined,
    })
    expect(clientMocks.call).toHaveBeenCalledWith("initialize", expect.any(Object))
  })

  it("ensureConnected 已连接时复用 client", async () => {
    const connector = new RealMcpConnector(config)

    await connector.ensureConnected("graph")
    await connector.ensureConnected("graph")

    expect(clientMocks.JsonRpcClient).toHaveBeenCalledTimes(1)
    expect(clientMocks.call).toHaveBeenCalledTimes(1)
  })

  it("call 成功时返回 ok 结果", async () => {
    clientMocks.call.mockImplementation(async (method: string) => {
      if (method === "initialize") return {}
      return { content: [{ type: "text", text: "图谱结果" }] }
    })
    const connector = new RealMcpConnector(config)

    const result = await connector.call({
      serverId: "graph",
      serverName: "图谱 MCP",
      toolName: "query_graph",
      qmaiToolName: "mcp_graph_query_graph",
    }, { query: "主角" })

    expect(clientMocks.call).toHaveBeenCalledWith("tools/call", {
      name: "query_graph",
      arguments: { query: "主角" },
    })
    expect(result).toEqual({ status: "ok", content: "图谱结果", summary: "图谱结果" })
  })

  it("call 失败时返回中文降级信息", async () => {
    clientMocks.call.mockImplementation(async (method: string) => {
      if (method === "initialize") return {}
      throw new Error("连接断开")
    })
    const connector = new RealMcpConnector(config)

    const result = await connector.call({
      serverId: "graph",
      serverName: "图谱 MCP",
      toolName: "query_graph",
      qmaiToolName: "mcp_graph_query_graph",
    }, {})

    expect(result.status).toBe("error")
    expect(result.message).toContain("MCP 服务“图谱 MCP”调用失败：连接断开")
    expect(result.message).toContain("普通 AI 会话可以继续")
  })

  it("closeAll 关闭所有 client", async () => {
    const connector = new RealMcpConnector(config)
    await connector.ensureConnected("graph")

    await connector.closeAll()

    expect(clientMocks.close).toHaveBeenCalled()
  })
})
