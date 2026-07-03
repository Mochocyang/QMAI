import { describe, expect, it, vi } from "vitest"
import { createMcpTool } from "./mcp-tool"
import type { McpToolDescriptor } from "@/lib/mcp/types"

const descriptor: McpToolDescriptor = {
  serverId: "graph",
  serverName: "Graph MCP",
  name: "query",
  description: "Query graph",
  operation: "read",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Query text" },
    },
    required: ["query"],
  },
}

describe("createMcpTool", () => {
  it("wraps an MCP caller as a QMai tool", async () => {
    const caller = vi.fn().mockResolvedValue({
      status: "ok",
      content: "graph result",
      summary: "graph result",
    })
    const tool = createMcpTool(descriptor, caller)

    expect(tool.name).toBe("mcp_graph_query")
    expect(tool.category).toBe("read")
    expect(tool.permission).toBe("auto")

    const result = JSON.parse(await tool.execute({ query: "hero" }))

    expect(caller).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      status: "ok",
      serverId: "graph",
      toolName: "query",
      content: "graph result",
    })
  })

  it("returns a Chinese degradation message when MCP call fails", async () => {
    const tool = createMcpTool(descriptor, vi.fn().mockRejectedValue(new Error("offline")))

    const result = JSON.parse(await tool.execute({ query: "hero" }))

    expect(result.status).toBe("error")
    expect(result.message).toContain("MCP 调用失败")
    expect(result.message).toContain("普通 AI 会话可以继续")
  })
})
