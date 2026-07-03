import { describe, expect, it } from "vitest"
import { createSelectCapabilitiesPlugin } from "./select-capabilities-plugin"
import { buildAvailableCapabilities } from "../capabilities/registry"
import { normalizeUserSkill } from "@/lib/novel/skill-library"

describe("SelectCapabilitiesPlugin", () => {
  it("selects capabilities for routed novel tasks after skills are selected", async () => {
    const plugin = createSelectCapabilitiesPlugin()
    const selectedSkill = normalizeUserSkill({
      id: "output",
      name: "Output Protocol",
      kind: ["output"],
      stages: ["output"],
      modes: ["fast", "standard", "strict"],
      content: "private skill content",
    })
    const availableCapabilities = buildAvailableCapabilities({
      toolNames: ["read_chapter", "read_outline", "load_context", "trim_context", "write_chapter"],
      selectedSkills: [selectedSkill],
    })

    const result = await plugin.run({
      userMessage: "write the next chapter",
      projectPath: "/project",
      agentConfig: {} as any,
      novelMode: true,
      aiWorkflowMode: "standard",
      availableCapabilities,
      selectedSkills: [selectedSkill],
      taskRoute: { intent: "write_chapter", confidence: 0.9, extractedParams: {} },
    })

    expect(result.selectedCapabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "tool:read_chapter", kind: "built_in_tool" }),
      expect.objectContaining({ id: "skill:output", kind: "user_skill" }),
    ]))
    expect(JSON.stringify(result.selectedCapabilities)).not.toContain("private skill content")
  })

  it("is a no-op outside novel routed tasks", async () => {
    const plugin = createSelectCapabilitiesPlugin()

    const result = await plugin.run({
      userMessage: "hello",
      projectPath: "/project",
      agentConfig: {} as any,
      novelMode: false,
      aiWorkflowMode: "standard",
      availableCapabilities: buildAvailableCapabilities({ toolNames: ["read_chapter"] }),
    })

    expect(result.selectedCapabilities).toEqual([])
  })

  it("merges MCP capabilities with selected skills when building available capabilities", async () => {
    const plugin = createSelectCapabilitiesPlugin()
    const selectedSkill = normalizeUserSkill({
      id: "plot-turns",
      name: "Plot Turns",
      kind: ["knowledge"],
      stages: ["planning"],
      modes: ["strict"],
      content: "private skill content",
    })

    const result = await plugin.run({
      userMessage: "查一下主角关系并规划下一章",
      projectPath: "/project",
      agentConfig: {
        tools: [{ name: "read_chapter" }],
      } as any,
      novelMode: true,
      aiWorkflowMode: "strict",
      selectedSkills: [selectedSkill],
      mcpCapabilities: [{
        id: "mcp:graph:query_graph",
        name: "Knowledge Graph / query_graph",
        kind: "mcp_tool",
        permission: "auto",
        modes: ["strict"],
        intents: ["search_plot", "character_query", "general"],
        toolName: "mcp_graph_query_graph",
        source: "mcp",
      }],
      taskRoute: { intent: "search_plot", confidence: 0.9, extractedParams: {} },
    })

    expect(result.selectedCapabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "mcp:graph:query_graph", kind: "mcp_tool" }),
      expect.objectContaining({ id: "skill:plot-turns", kind: "user_skill" }),
    ]))
    expect(result.enabledToolNames).toContain("mcp_graph_query_graph")
  })
})
