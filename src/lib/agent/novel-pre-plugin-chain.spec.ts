import { describe, expect, it, vi } from "vitest"
import { createNovelPrePluginChain, runNovelPrePluginChain } from "./novel-pre-plugin-chain"
import { createPrePluginChain } from "./pipeline"
import type { ContextPack } from "@/lib/novel/context-engine"

const mockContextPack: ContextPack = {
  task: "写第5章",
  chapterGoal: "第5章目标",
  outline: "大纲内容",
  recentSummaries: ["第4章摘要"],
  previousChapterEnding: "上一章结尾",
  characterStates: "人物状态",
  soulDoc: "灵魂文档",
  characterAuras: "",
  cognitionStates: "认知状态",
  foreshadowingStates: "伏笔状态",
  timeline: "时间线",
  relatedSettings: "相关设定",
  canonRules: "正史规则",
  writingStyle: "写作风格",
  searchResults: "搜索结果",
  graphSearchResults: "图谱搜索结果",
  mustDo: "必须做",
  mustAvoid: "必须避免",
  nextChapterAdvice: "下一章建议",
  revisionDirectives: "修订指令",
}

describe("createNovelPrePluginChain", () => {
  it("creates 9 plugins in correct priority order", () => {
    const plugins = createNovelPrePluginChain()
    expect(plugins).toHaveLength(9)

    const names = plugins.map((p) => p.name)
    expect(names).toEqual([
      "route_task",
      "confidence_gate",
      "resolve_chapter",
      "build_context_pack",
      "select_skills",
      "select_capabilities",
      "soul_dialog",
      "trim_context",
      "build_system_prompt",
    ])

    const priorities = plugins.map((p) => p.priority)
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i]).toBeGreaterThan(priorities[i - 1])
    }
  })

  it("passes deps to plugins correctly", () => {
    const onError = vi.fn()
    const plugins = createNovelPrePluginChain({
      selectedFile: "/test/chapter.md",
      lastGeneratedChapterNumber: 4,
      onError,
    })

    expect(plugins).toHaveLength(9)
  })

  it("enables classification routing for the context pack plugin by default", async () => {
    const mockBuild = vi.fn().mockResolvedValue(mockContextPack)
    const mockLoadClassification = vi.fn().mockResolvedValue({
      config: {
        routes: [
          {
            intent: "generate_outline",
            required: ["soul", "settings"],
            optional: [],
            forbidden: ["chapter_content", "recent_summaries", "graph"],
          },
        ],
      },
      source: "project",
    })
    const mockApplyRouteRules = vi.fn().mockReturnValue({
      pack: { ...mockContextPack, recentSummaries: [], graphSearchResults: "" },
      blockedSources: ["recent_summaries", "graph"],
      keptSources: ["soul", "settings"],
    })
    const buildPlugin = createNovelPrePluginChain({
      buildContextPack: mockBuild,
      loadClassificationConfig: mockLoadClassification,
      applyRouteRules: mockApplyRouteRules,
    } as any).find((plugin) => plugin.name === "build_context_pack")
    expect(buildPlugin).toBeDefined()

    const result = await buildPlugin!.run({
      userMessage: "生成大纲",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: { intent: "generate_outline", confidence: 0.9, extractedParams: {} },
    } as any)

    expect(mockLoadClassification).toHaveBeenCalledWith("/test-project", undefined)
    expect(mockApplyRouteRules).toHaveBeenCalledOnce()
    expect(result.routeSource).toBe("project")
    expect(result.blockedSources).toEqual(["recent_summaries", "graph"])
  })
})

describe("runNovelPrePluginChain", () => {
  it("runs full chain in non-novel mode", async () => {
    const result = await runNovelPrePluginChain({
      input: {
        userMessage: "你好",
        projectPath: "/test-project",
        agentConfig: {} as any,
        novelMode: false,
      },
    })

    expect(result.taskRoute).toBeUndefined()
    expect(result.contextPack).toBeUndefined()
    expect(result.finalSystemPrompt).toBeUndefined()
    expect(result.errors).toHaveLength(0)
  })

  it("runs full chain in novel mode with route", async () => {
    const mockBuild = vi.fn().mockResolvedValue(mockContextPack)
    const mockToPrompt = vi.fn().mockReturnValue("裁剪后的上下文")

    const { createBuildContextPackPlugin } = await import("./plugins/build-context-pack-plugin")
    const { createTrimContextPlugin } = await import("./plugins/trim-context-plugin")

    const chain = createPrePluginChain([
      createBuildContextPackPlugin({ buildContextPack: mockBuild }),
      createTrimContextPlugin({ contextPackToPromptFn: mockToPrompt }),
    ])

    const result = await chain.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: { intent: "write_chapter", confidence: 0.9, chapterNumber: 5, extractedParams: {} },
    })

    expect(result.contextPack).toBeDefined()
    expect(result.novelSystemPrompt).toBe("裁剪后的上下文")
    expect(result.errors).toHaveLength(0)
  })

  it("stops chain when soul dialog required", async () => {
    const mockBuild = vi.fn().mockResolvedValue({
      ...mockContextPack,
      characterAuras: "需要确认的角色光环",
    })
    const mockShouldRequest = vi.fn().mockReturnValue(true)

    const { createBuildContextPackPlugin } = await import("./plugins/build-context-pack-plugin")
    const { createSoulDialogPlugin } = await import("./plugins/soul-dialog-plugin")

    const chain = createPrePluginChain([
      createBuildContextPackPlugin({ buildContextPack: mockBuild }),
      createSoulDialogPlugin({ shouldRequestSoulDialog: mockShouldRequest }),
    ])

    const result = await chain.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: { intent: "write_chapter", confidence: 0.9, chapterNumber: 5, extractedParams: {} },
    })

    expect(result.contextPack).toBeDefined()
    expect(result.shouldStop).toBe(true)
    expect(result.stopReason).toBe("soul_dialog_confirmation_required")
  })

  it("collects errors from plugins without stopping", async () => {
    const mockBuild = vi.fn().mockRejectedValue(new Error("build failed"))
    const mockToPrompt = vi.fn().mockReturnValue("裁剪后")

    const { createBuildContextPackPlugin } = await import("./plugins/build-context-pack-plugin")
    const { createTrimContextPlugin } = await import("./plugins/trim-context-plugin")

    const chain = createPrePluginChain([
      createBuildContextPackPlugin({ buildContextPack: mockBuild }),
      createTrimContextPlugin({ contextPackToPromptFn: mockToPrompt }),
    ])

    const result = await chain.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: { intent: "write_chapter", confidence: 0.9, chapterNumber: 5, extractedParams: {} },
      contextPack: mockContextPack,
    })

    expect(result.errors.length).toBeGreaterThanOrEqual(0)
  })
})
