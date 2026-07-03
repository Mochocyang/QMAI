import { describe, expect, it } from "vitest"
import {
  createSampleGraphMcpServer,
  normalizeMcpConfig,
  normalizeMcpServerConfig,
} from "./config"

describe("MCP config normalization", () => {
  it("falls back to an empty config for invalid input", () => {
    expect(normalizeMcpConfig(null)).toEqual({ servers: [] })
    expect(normalizeMcpConfig({ servers: "bad" })).toEqual({ servers: [] })
  })

  it("normalizes server and tool descriptors while filling server identity", () => {
    const config = normalizeMcpConfig({
      servers: [{
        id: " Graph Server ",
        name: " Knowledge Graph ",
        enabled: true,
        tools: [{
          name: " query_graph ",
          description: " Query graph ",
          operation: "read",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Query" },
            },
            required: ["query"],
          },
        }],
      }],
    })

    expect(config.servers[0]).toEqual(expect.objectContaining({
      id: "Graph Server",
      name: "Knowledge Graph",
      enabled: true,
    }))
    expect(config.servers[0].tools[0]).toEqual(expect.objectContaining({
      serverId: "Graph Server",
      serverName: "Knowledge Graph",
      name: "query_graph",
      description: "Query graph",
      operation: "read",
    }))
  })

  it("drops malformed tools but keeps destructive descriptors for runtime warnings", () => {
    const server = normalizeMcpServerConfig({
      id: "graph",
      name: "Graph",
      enabled: true,
      tools: [
        { name: "", description: "bad", operation: "read", inputSchema: { type: "object" } },
        { name: "delete_node", description: "Delete node", operation: "delete", inputSchema: { type: "object" } },
      ],
    })

    expect(server).not.toBeNull()
    if (!server) return
    expect(server.tools).toHaveLength(1)
    expect(server.tools[0].operation).toBe("delete")
  })

  it("creates a stable sample GraphRAG server", () => {
    const server = createSampleGraphMcpServer()

    expect(server.id).toBe("graph")
    expect(server.name).toContain("Graph")
    expect(server.enabled).toBe(true)
    expect(server.tools.map((tool) => tool.name)).toEqual(["query_graph", "analyze_relation"])
    expect(server.tools.every((tool) => tool.serverId === "graph")).toBe(true)
  })
})
