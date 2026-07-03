import { describe, expect, it, vi } from "vitest"
import { ToolRegistry } from "../registry"
import { registerAllBuiltInTools } from "./index"

const baseOptions = {
  wikiPath: "/project/wiki",
  getSkillConfig: () => null,
  getChatConversations: () => [],
  getOutlineConversations: () => [],
}

describe("registerAllBuiltInTools", () => {
  it("can disable unsafe write tools for scoped agent panels", () => {
    const registry = new ToolRegistry()

    registerAllBuiltInTools(registry, {
      ...baseOptions,
      disabledTools: ["write_chapter", "write_memory"],
    })

    expect(registry.has("read_outline")).toBe(true)
    expect(registry.has("write_outline_node")).toBe(true)
    expect(registry.has("write_chapter")).toBe(false)
    expect(registry.has("write_memory")).toBe(false)
  })

  it("registers external web search read tools by default", () => {
    const registry = new ToolRegistry()

    registerAllBuiltInTools(registry, baseOptions)

    expect(registry.has("web_search")).toBe(true)
    expect(registry.has("read_web_page")).toBe(true)
    expect(registry.get("web_search")?.category).toBe("read")
    expect(registry.get("read_web_page")?.category).toBe("read")
  })

  it("can disable external web search tools", () => {
    const registry = new ToolRegistry()

    registerAllBuiltInTools(registry, {
      ...baseOptions,
      disabledTools: ["web_search", "read_web_page"],
    })

    expect(registry.has("web_search")).toBe(false)
    expect(registry.has("read_web_page")).toBe(false)
  })

  it("can register only enabled tool names for capability-scoped runs", () => {
    const registry = new ToolRegistry()

    registerAllBuiltInTools(registry, {
      ...baseOptions,
      enabledToolNames: ["read_chapter", "web_search"],
    })

    expect(registry.has("read_chapter")).toBe(true)
    expect(registry.has("web_search")).toBe(true)
    expect(registry.has("read_outline")).toBe(false)
    expect(registry.has("write_chapter")).toBe(false)
  })

  it("lets disabledTools override enabledToolNames", () => {
    const registry = new ToolRegistry()

    registerAllBuiltInTools(registry, {
      ...baseOptions,
      enabledToolNames: ["read_chapter", "web_search"],
      disabledTools: ["web_search"],
    })

    expect(registry.has("read_chapter")).toBe(true)
    expect(registry.has("web_search")).toBe(false)
  })

  it("registers provided MCP tools through the same filtering rules", () => {
    const registry = new ToolRegistry()
    const mcpTool = {
      name: "mcp_graph_query",
      description: "Query graph",
      category: "read" as const,
      permission: "auto" as const,
      parameters: {},
      execute: async () => "ok",
    }

    registerAllBuiltInTools(registry, {
      ...baseOptions,
      mcpTools: [mcpTool],
      enabledToolNames: ["mcp_graph_query"],
    })

    expect(registry.has("mcp_graph_query")).toBe(true)
    expect(registry.has("read_chapter")).toBe(false)
  })

  it("registers the chapter workflow tool when dependencies are provided", () => {
    const registry = new ToolRegistry()

    registerAllBuiltInTools(registry, {
      ...baseOptions,
      projectPath: "/project",
      llmConfig: {} as any,
      aiWorkflowMode: "standard",
      runDeepChapterGeneration: vi.fn() as any,
      getUserSkills: () => [],
      getSearchApiConfig: () => null,
    })

    expect(registry.has("run_chapter_workflow")).toBe(true)
  })
})
