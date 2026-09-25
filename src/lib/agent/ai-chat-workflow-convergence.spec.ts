import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(async () => []),
}))

import { listDirectory } from "@/commands/fs"
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
  storyFrameworkBinding: "",
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
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listDirectory).mockResolvedValue([])
  })

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
    expect(result.enabledToolNames).not.toContain("run_chapter_workflow")
    expect((result.selectedCapabilities ?? []).some((item) => item.kind === "user_skill")).toBe(false)
  })

  it("standard next chapter uses the old fast lightweight workflow route", async () => {
    const result = await runWorkflow({
      userMessage: "帮我写下一章",
      intent: "write_chapter",
      mode: "standard",
      skills: [threeTurnsSkill(), outputSkill()],
    })

    expect(result.enabledToolNames).toEqual(expect.arrayContaining([
      "read_chapter",
      "read_outline",
      "load_context",
      "trim_context",
    ]))
    expect(result.enabledToolNames).not.toContain("write_chapter")
    expect(result.enabledToolNames).not.toContain("apply_skill")
    expect(result.selectedCapabilities).toContainEqual(expect.objectContaining({ kind: "user_skill", skillId: "output" }))
  })

  it("strict next chapter enables writing workflow, selected skill, and write confirmation tool", async () => {
    const result = await runWorkflow({
      userMessage: "帮我写下一章",
      intent: "write_chapter",
      mode: "strict",
      skills: [threeTurnsSkill(), outputSkill()],
    })

    expect(result.enabledToolNames).toEqual(expect.arrayContaining([
      "read_chapter",
      "read_outline",
      "read_memory",
      "search_chapters",
      "write_chapter",
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

  it("character_query enables web search when local entity table misses the name", async () => {
    vi.mocked(listDirectory).mockResolvedValue([])

    const result = await runWorkflow({
      userMessage: "黄蓉是谁",
      intent: "character_query",
      mode: "standard",
    })

    expect(result.enabledToolNames).toEqual(expect.arrayContaining(["web_search", "read_web_page"]))
    expect(result.selectedCapabilities).toContainEqual(expect.objectContaining({
      kind: "web_search",
      reason: expect.stringContaining("local entity miss"),
    }))
  })

  it("character_query does not enable web search when local entity name is present", async () => {
    vi.mocked(listDirectory).mockImplementation(async (path: string) => {
      if (path.endsWith("wiki/entities")) {
        return [{ name: "黄蓉.md", path: "/project/wiki/entities/黄蓉.md", is_dir: false }]
      }
      return []
    })

    const result = await runWorkflow({
      userMessage: "黄蓉是谁",
      intent: "character_query",
      mode: "standard",
    })

    expect(result.enabledToolNames ?? []).not.toContain("web_search")
    expect((result.selectedCapabilities ?? []).some((item) => item.kind === "web_search")).toBe(false)
  })
})
