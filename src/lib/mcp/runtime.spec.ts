import { describe, expect, it, vi } from "vitest"
import { buildMcpRuntime, defaultUnavailableMcpCaller } from "./runtime"
import type { McpConfig } from "./config"
import type { McpToolDescriptor } from "./types"

function descriptor(operation: McpToolDescriptor["operation"], name = "query_graph"): McpToolDescriptor {
  return {
    serverId: "graph",
    serverName: "Knowledge Graph",
    name,
    description: "Query graph",
    operation,
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Query" } },
      required: ["query"],
    },
  }
}

describe("buildMcpRuntime", () => {
  it("ignores disabled servers", () => {
    const config: McpConfig = {
      servers: [{ id: "graph", name: "Graph", enabled: false, tools: [descriptor("read")] }],
    }

    const runtime = buildMcpRuntime(config)

    expect(runtime.mcpTools).toEqual([])
    expect(runtime.mcpCapabilities).toEqual([])
    expect(runtime.warnings).toEqual([])
  })

  it("builds tools and capabilities for enabled read and analysis MCP descriptors", () => {
    const config: McpConfig = {
      servers: [{
        id: "graph",
        name: "Graph",
        enabled: true,
        tools: [descriptor("read"), descriptor("analysis", "analyze_relation")],
      }],
    }

    const runtime = buildMcpRuntime(config)

    expect(runtime.mcpTools.map((tool) => tool.name)).toEqual([
      "mcp_graph_query_graph",
      "mcp_graph_analyze_relation",
    ])
    expect(runtime.mcpCapabilities).toContainEqual(expect.objectContaining({
      kind: "mcp_tool",
      toolName: "mcp_graph_query_graph",
      source: "mcp",
    }))
    expect(runtime.mcpCapabilities).toContainEqual(expect.objectContaining({
      kind: "mcp_tool",
      toolName: "mcp_graph_analyze_relation",
      source: "mcp",
    }))
  })

  it("rejects destructive and unsupported MCP descriptors with Chinese warnings", () => {
    const badSchema: McpToolDescriptor = {
      ...descriptor("read", "bad"),
      inputSchema: {
        type: "object",
        properties: { cb: { type: "function" } },
      },
    }
    const config: McpConfig = {
      servers: [{
        id: "graph",
        name: "Graph",
        enabled: true,
        tools: [descriptor("delete"), descriptor("overwrite"), badSchema],
      }],
    }

    const runtime = buildMcpRuntime(config)

    expect(runtime.mcpTools).toEqual([])
    expect(runtime.mcpCapabilities).toEqual([])
    expect(runtime.warnings.join("\n")).toContain("MCP")
    expect(runtime.warnings.join("\n")).toContain("未启用")
  })

  it("default caller returns Chinese unavailable degradation", async () => {
    const result = await defaultUnavailableMcpCaller({
      serverId: "graph",
      serverName: "Knowledge Graph",
      toolName: "query_graph",
      qmaiToolName: "mcp_graph_query_graph",
    }, { query: "主角关系" })

    expect(result.status).toBe("error")
    expect(result.message).toContain("MCP")
    expect(result.message).toContain("未连接")
  })

  it("server 配置 command 且提供 realConnector 时使用真实 caller", async () => {
    const realCaller = vi.fn(async () => ({
      status: "ok" as const,
      content: "真实结果",
      summary: "真实结果",
    }))
    const config: McpConfig = {
      servers: [{
        id: "graph",
        name: "Graph",
        enabled: true,
        command: "node",
        tools: [descriptor("read")],
      }],
    }

    const runtime = buildMcpRuntime(config, defaultUnavailableMcpCaller, { caller: realCaller } as any)
    await runtime.mcpTools[0].execute({ query: "主角" })

    expect(realCaller).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: "graph", toolName: "query_graph" }),
      { query: "主角" },
      undefined,
    )
  })
})
