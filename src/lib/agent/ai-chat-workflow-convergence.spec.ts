import { describe, expect, it, vi } from "vitest"
import { createPrePluginChain } from "./pipeline"
import { createBuildContextPackPlugin } from "./plugins/build-context-pack-plugin"
import { createSelectSkillsPlugin } from "./plugins/select-skills-plugin"
import { createSelectCapabilitiesPlugin } from "./plugins/select-capabilities-plugin"
import { createTrimContextPlugin } from "./plugins/trim-context-plugin"
import { createBuildSystemPromptPlugin } from "./plugins/build-system-prompt-plugin"
import { normalizeUserSkill } from "@/lib/novel/skill-library"
import type { AgentConfig, Tool } from "./types"
import type { ContextPack } from "@/lib/novel/context-engine"
import type { AiCapability } from "./capabilities/types"

const contextPack: ContextPack = {
  task: "写作任务",
  chapterGoal: "章节目标",
  outline: "大纲内容",
  recentSummaries: ["上一章摘要"],
  previousChapterEnding: "上一章结尾",
  characterStates: "人物状态",
  soulDoc: "作品灵魂",
  characterAuras: "",
  cognitionStates: "",
  foreshadowingStates: "",
  timeline: "",
  relatedSettings: "",
  canonRules: "",
  writingStyle: "",
  searchResults: "",
  graphSearchResults: "",
  mustDo: "",
  mustAvoid: "",
  nextChapterAdvice: "",
  revisionDirectives: "",
}

function tool(name: string, category: Tool["category"] = "read"): Tool {
  return {
    name,
    description: name,
    category,
    permission: category === "write" ? "confirm" : "auto",
    parameters: {},
    execute: async () => name,
  }
}

function agentConfig(): AgentConfig {
  return {
    maxRounds: 3,
    tools: [
      tool("read_chapter"),
      tool("read_outline"),
      tool("read_memory"),
      tool("search_chapters"),
      tool("load_context"),
      tool("trim_context"),
      tool("write_chapter", "write"),
      tool("apply_skill", "action"),
      tool("web_search"),
      tool("read_web_page"),
    ],
    systemPrompt: "基础系统提示",
    llmConfig: {} as AgentConfig["llmConfig"],
  }
}

function threeTurnsSkill() {
  return normalizeUserSkill({
    id: "three-turns",
    name: "三翻四抖",
    description: "三次转折，四次震惊",
    kind: ["structure", "planning"],
    stages: ["planning", "drafting"],
    modes: ["standard", "strict"],
    content: "内部技巧内容",
    source: "uploaded",
  })
}

function outputSkill() {
  return normalizeUserSkill({
    id: "output",
    name: "正文输出协议",
    kind: ["output"],
    stages: ["output"],
    modes: ["fast", "standard", "strict"],
    content: "只输出最终文本",
    source: "project",
  })
}

function mcpCapability(): AiCapability {
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

async function runWorkflow(input: {
  userMessage: string
  intent: any
  mode: "fast" | "standard" | "strict"
  skills?: ReturnType<typeof normalizeUserSkill>[]
  capabilities?: AiCapability[]
  blockedSources?: string[]
}) {
  const chain = createPrePluginChain([
    createBuildContextPackPlugin({ buildContextPack: vi.fn().mockResolvedValue(contextPack) }),
    createSelectSkillsPlugin(),
    createSelectCapabilitiesPlugin(),
    createTrimContextPlugin({ contextPackToPromptFn: () => "裁剪后的上下文" }),
    createBuildSystemPromptPlugin(),
  ])

  return chain.run({
    userMessage: input.userMessage,
    projectPath: "/project",
    agentConfig: agentConfig(),
    novelMode: true,
    taskRoute: { intent: input.intent, confidence: 0.9, extractedParams: {} },
    aiWorkflowMode: input.mode,
    availableSkills: input.skills ?? [],
    availableCapabilities: input.capabilities,
    blockedSources: input.blockedSources,
  })
}

describe("AI chat workflow convergence", () => {
  it("fast polish keeps tool use minimal and does not enable write tools", async () => {
    const result = await runWorkflow({
      userMessage: "帮我润色这句话",
      intent: "polish_chapter",
      mode: "fast",
      skills: [outputSkill()],
    })

    expect(result.enabledToolNames).toEqual(expect.arrayContaining([
      "read_chapter",
      "read_outline",
      "load_context",
      "trim_context",
    ]))
    expect(result.enabledToolNames).not.toContain("write_chapter")
    expect(result.selectedCapabilities).toContainEqual(expect.objectContaining({ kind: "user_skill", skillId: "output" }))
  })

  it("standard next chapter enables writing context, selected skill, and write confirmation tool", async () => {
    const result = await runWorkflow({
      userMessage: "帮我写下一章",
      intent: "write_chapter",
      mode: "standard",
      skills: [threeTurnsSkill(), outputSkill()],
    })

    expect(result.enabledToolNames).toEqual(expect.arrayContaining([
      "read_chapter",
      "read_outline",
      "read_memory",
      "search_chapters",
      "write_chapter",
      "apply_skill",
    ]))
    expect(result.selectedCapabilities).toContainEqual(expect.objectContaining({ kind: "user_skill", skillId: "three-turns" }))
    expect(result.selectedCapabilities).toContainEqual(expect.objectContaining({ toolName: "write_chapter", permission: "confirm" }))
  })

  it("explicit external search enables search tools without pretending search always happened", async () => {
    const result = await runWorkflow({
      userMessage: "搜索一下黄蓉的信息再回答",
      intent: "setting_query",
      mode: "standard",
    })

    expect(result.enabledToolNames).toEqual(expect.arrayContaining(["web_search", "read_web_page"]))
    expect(result.selectedCapabilities).toContainEqual(expect.objectContaining({
      kind: "web_search",
      reason: expect.stringContaining("external search"),
    }))
  })

  it("strict knowledge graph task can select read-only MCP capability", async () => {
    const result = await runWorkflow({
      userMessage: "use knowledge graph to analyze protagonist relationship",
      intent: "character_query",
      mode: "strict",
      capabilities: [
        ...agentConfig().tools.map((item): AiCapability => ({
          id: `tool:${item.name}`,
          name: item.name,
          kind: item.name === "web_search" || item.name === "read_web_page" ? "web_search" as const : "built_in_tool" as const,
          permission: item.permission ?? "auto",
          modes: ["fast", "standard", "strict"],
          intents: ["general"],
          toolName: item.name,
          source: "built-in" as const,
        })),
        mcpCapability(),
      ],
    })

    expect(result.enabledToolNames).toContain("mcp_knowledge_graph_query")
    expect(result.selectedCapabilities).toContainEqual(expect.objectContaining({
      kind: "mcp_tool",
      toolName: "mcp_knowledge_graph_query",
    }))
  })

  it("classification graph block prevents MCP graph capability selection", async () => {
    const result = await runWorkflow({
      userMessage: "use knowledge graph to analyze protagonist relationship",
      intent: "character_query",
      mode: "strict",
      capabilities: [mcpCapability()],
      blockedSources: ["graph"],
    })

    expect(result.enabledToolNames).not.toContain("mcp_knowledge_graph_query")
    expect(result.selectedCapabilities?.some((item) => item.kind === "mcp_tool")).toBe(false)
  })
})
