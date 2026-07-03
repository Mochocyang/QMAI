import { describe, expect, it } from "vitest"
import type { AiCapability } from "./types"
import {
  buildAvailableCapabilities,
  buildBuiltInToolCapabilities,
  buildUserSkillCapabilities,
} from "./registry"
import { selectCapabilities } from "./selector"
import { normalizeUserSkill } from "@/lib/novel/skill-library"

const toolNames = [
  "read_chapter",
  "read_outline",
  "load_context",
  "trim_context",
  "write_chapter",
  "web_search",
  "read_web_page",
]

function futureMcpCapability(): AiCapability {
  return {
    id: "mcp:knowledge-graph:query",
    name: "Knowledge Graph Query",
    kind: "mcp_tool",
    permission: "auto",
    modes: ["strict"],
    intents: ["character_query", "setting_query", "general"],
    toolName: "mcp_knowledge_graph_query",
    source: "mcp",
  }
}

describe("AI capability selector", () => {
  it("builds capabilities from built-in tool names and selected skills", () => {
    const skill = normalizeUserSkill({
      id: "three-turns",
      name: "Three Turns",
      kind: ["structure", "planning"],
      stages: ["planning", "drafting"],
      modes: ["standard", "strict"],
      content: "private skill content",
      source: "project",
    })

    const capabilities = buildAvailableCapabilities({
      toolNames,
      selectedSkills: [skill],
    })

    expect(capabilities.some((capability) => capability.toolName === "read_chapter")).toBe(true)
    expect(capabilities.some((capability) => capability.kind === "web_search" && capability.toolName === "web_search")).toBe(true)
    expect(capabilities).toContainEqual(expect.objectContaining({
      id: "skill:three-turns",
      name: "Three Turns",
      kind: "user_skill",
      skillId: "three-turns",
    }))
    expect(JSON.stringify(capabilities)).not.toContain("private skill content")
  })

  it("keeps fast writing mode to minimal read/context tools and selected output skills", () => {
    const outputSkill = normalizeUserSkill({
      id: "output",
      name: "Output Protocol",
      kind: ["output"],
      stages: ["output"],
      modes: ["fast", "standard", "strict"],
      content: "private output instructions",
    })
    const capabilities = buildAvailableCapabilities({
      toolNames,
      selectedSkills: [outputSkill],
      mcpCapabilities: [futureMcpCapability()],
    })

    const selected = selectCapabilities({
      capabilities,
      intent: "write_chapter",
      mode: "fast",
      userMessage: "write the next chapter",
    })

    expect(selected.map((item) => item.id)).toEqual(expect.arrayContaining([
      "tool:read_chapter",
      "tool:read_outline",
      "tool:load_context",
      "tool:trim_context",
      "skill:output",
    ]))
    expect(selected.some((item) => item.kind === "web_search")).toBe(false)
    expect(selected.some((item) => item.kind === "mcp_tool")).toBe(false)
    expect(JSON.stringify(selected)).not.toContain("private output instructions")
  })

  it("selects web search only when standard writing explicitly asks for external search", () => {
    const capabilities = buildBuiltInToolCapabilities(toolNames)

    const withoutSearchRequest = selectCapabilities({
      capabilities,
      intent: "write_chapter",
      mode: "standard",
      userMessage: "write the next chapter",
    })

    const withSearchRequest = selectCapabilities({
      capabilities,
      intent: "write_chapter",
      mode: "standard",
      userMessage: "please search the web for Huang Rong information first",
    })

    expect(withoutSearchRequest.some((item) => item.kind === "web_search")).toBe(false)
    expect(withSearchRequest.map((item) => item.toolName)).toEqual(expect.arrayContaining([
      "web_search",
      "read_web_page",
    ]))
  })

  it("selects chapter workflow tool for chapter writing intents", () => {
    const capabilities = buildAvailableCapabilities({
      toolNames: ["read_chapter", "run_chapter_workflow"],
      selectedSkills: [],
      mcpCapabilities: [],
    })

    const selected = selectCapabilities({
      capabilities,
      intent: "write_chapter",
      mode: "standard",
      userMessage: "生成第3章",
    })

    expect(selected.map((item) => item.toolName)).toContain("run_chapter_workflow")
  })

  it("allows strict knowledge tasks to select future MCP placeholders without executing MCP", () => {
    const capabilities = [
      ...buildBuiltInToolCapabilities(toolNames),
      futureMcpCapability(),
    ]

    const selected = selectCapabilities({
      capabilities,
      intent: "character_query",
      mode: "strict",
      userMessage: "use knowledge graph to analyze protagonist and antagonist relationship",
    })

    expect(selected).toContainEqual(expect.objectContaining({
      id: "mcp:knowledge-graph:query",
      kind: "mcp_tool",
      permission: "auto",
      toolName: "mcp_knowledge_graph_query",
    }))
  })

  it("does not select graph MCP capabilities when classification blocks graph data", () => {
    const selected = selectCapabilities({
      capabilities: [
        ...buildBuiltInToolCapabilities(toolNames),
        futureMcpCapability(),
      ],
      intent: "character_query",
      mode: "strict",
      userMessage: "use knowledge graph to analyze relationships",
      blockedSources: ["graph"],
    })

    expect(selected.some((item) => item.kind === "mcp_tool")).toBe(false)
  })

  it("can build selected skill capabilities directly", () => {
    const capabilities = buildUserSkillCapabilities([
      normalizeUserSkill({
        id: "review",
        name: "Review Skill",
        kind: ["review"],
        stages: ["review"],
        modes: ["standard", "strict"],
        content: "private review content",
        source: "uploaded",
      }),
    ])

    expect(capabilities).toEqual([
      expect.objectContaining({
        id: "skill:review",
        kind: "user_skill",
        permission: "auto",
        source: "uploaded",
      }),
    ])
    expect(JSON.stringify(capabilities)).not.toContain("private review content")
  })
})
