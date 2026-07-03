import { describe, expect, it, vi } from "vitest"
import { adaptMcpTool, mapMcpOperationToToolPolicy } from "./adapter"
import type { McpToolDescriptor } from "./types"

function descriptor(partial: Partial<McpToolDescriptor>): McpToolDescriptor {
  return {
    serverId: "knowledge",
    serverName: "Knowledge Graph",
    name: "query_graph",
    description: "Query relationship graph",
    operation: "read",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Query text" },
      },
      required: ["query"],
    },
    ...partial,
  }
}

describe("MCP adapter", () => {
  it("maps read-only MCP tools to read and auto permission", () => {
    expect(mapMcpOperationToToolPolicy("read")).toEqual({
      category: "read",
      permission: "auto",
      blocked: false,
    })
  })

  it("maps write MCP tools to write and confirm permission", () => {
    expect(mapMcpOperationToToolPolicy("write")).toEqual({
      category: "write",
      permission: "confirm",
      blocked: false,
    })
  })

  it("blocks destructive MCP tools until a separate safety design exists", () => {
    expect(mapMcpOperationToToolPolicy("delete")).toEqual({
      category: "write",
      permission: "confirm",
      blocked: true,
    })
  })

  it("adapts supported MCP schemas into QMai tools", async () => {
    const caller = vi.fn().mockResolvedValue({
      status: "ok",
      content: "Graph answer",
      summary: "Graph answer",
    })

    const result = adaptMcpTool(descriptor({ operation: "analysis" }), caller)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.tool.name).toBe("mcp_knowledge_query_graph")
    expect(result.tool.category).toBe("action")
    expect(result.tool.permission).toBe("auto")
    expect(result.tool.parameters.query).toEqual({
      type: "string",
      description: "Query text",
      required: true,
    })

    const output = JSON.parse(await result.tool.execute({ query: "A and B" }))
    expect(caller).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: "knowledge", toolName: "query_graph" }),
      { query: "A and B" },
      undefined,
    )
    expect(output.status).toBe("ok")
    expect(output.content).toBe("Graph answer")
  })

  it("rejects unsupported MCP schema types with a Chinese error", () => {
    const result = adaptMcpTool(descriptor({
      inputSchema: {
        type: "object",
        properties: {
          callback: { type: "function" as any, description: "Unsupported" },
        },
      },
    }), vi.fn())

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected schema rejection")
    expect(result.error).toContain("不支持的 MCP 参数类型")
  })
})
