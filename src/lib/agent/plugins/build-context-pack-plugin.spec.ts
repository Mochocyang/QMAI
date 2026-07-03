import { describe, expect, it, vi } from "vitest"
import { createBuildContextPackPlugin } from "./build-context-pack-plugin"
import { createSoulDialogPlugin } from "./soul-dialog-plugin"
import { createPrePluginChain } from "../pipeline"
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

describe("BuildContextPackPlugin", () => {
  it("builds context pack in novel mode with task route", async () => {
    const mockBuild = vi.fn().mockResolvedValue(mockContextPack)
    const plugin = createBuildContextPackPlugin({ buildContextPack: mockBuild })

    const result = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: { intent: "write_chapter", confidence: 0.9, chapterNumber: 5, extractedParams: {} },
    })

    expect(result.contextPack).toBeDefined()
    expect(result.contextPack?.task).toBe("写第5章")
    expect(mockBuild).toHaveBeenCalledWith("/test-project", "写第5章", 5)
  })

  it("uses effectiveTaskRoute if available", async () => {
    const mockBuild = vi.fn().mockResolvedValue(mockContextPack)
    const plugin = createBuildContextPackPlugin({ buildContextPack: mockBuild })

    await plugin.run({
      userMessage: "写章节",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: { intent: "write_chapter", confidence: 0.9, extractedParams: {} },
      effectiveTaskRoute: { intent: "write_chapter", confidence: 0.9, chapterNumber: 7, extractedParams: { chapterNumber: "7" } },
    })

    expect(mockBuild).toHaveBeenCalledWith("/test-project", "写章节", 7)
  })

  it("returns empty when not in novel mode", async () => {
    const mockBuild = vi.fn().mockResolvedValue(mockContextPack)
    const plugin = createBuildContextPackPlugin({ buildContextPack: mockBuild })

    const result = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: false,
    })

    expect(result.contextPack).toBeUndefined()
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it("returns empty when no task route", async () => {
    const mockBuild = vi.fn().mockResolvedValue(mockContextPack)
    const plugin = createBuildContextPackPlugin({ buildContextPack: mockBuild })

    const result = await plugin.run({
      userMessage: "随便聊聊",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: null,
    })

    expect(result.contextPack).toBeUndefined()
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it("handles build error gracefully", async () => {
    const mockError = vi.fn()
    const mockBuild = vi.fn().mockRejectedValue(new Error("build failed"))
    const plugin = createBuildContextPackPlugin({ buildContextPack: mockBuild, onError: mockError })

    const result = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: { intent: "write_chapter", confidence: 0.9, chapterNumber: 5, extractedParams: {} },
    })

    expect(result.contextPack).toBeUndefined()
    expect(mockError).toHaveBeenCalled()
  })

  it("loads classification before context and passes allowed categories to build", async () => {
    const mockBuild = vi.fn().mockResolvedValue(mockContextPack)
    const mockLoadClassification = vi.fn().mockResolvedValue({
      config: {
        routes: [
          {
            intent: "generate_outline",
            required: ["soul", "settings"],
            optional: ["outline"],
            forbidden: ["chapter_content", "recent_summaries"],
          },
        ],
      },
      source: "project",
    })
    const mockApplyRouteRules = vi.fn().mockReturnValue({
      pack: mockContextPack,
      blockedSources: ["chapter_content", "recent_summaries"],
      keptSources: ["soul", "settings", "outline"],
    })
    const plugin = createBuildContextPackPlugin({
      buildContextPack: mockBuild,
      enableClassification: true,
      loadClassificationConfig: mockLoadClassification as any,
      applyRouteRules: mockApplyRouteRules as any,
    })

    const result = await plugin.run({
      userMessage: "生成大纲",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: { intent: "generate_outline", confidence: 0.9, extractedParams: {} },
    })

    expect(mockLoadClassification).toHaveBeenCalledWith("/test-project", undefined)
    expect(mockBuild).toHaveBeenCalledWith("/test-project", "生成大纲", undefined, {
      categories: ["soul", "settings", "outline"],
    })
    expect(result.routeSource).toBe("project")
    expect(result.blockedSources).toEqual(["chapter_content", "recent_summaries"])
  })
})

describe("SoulDialogPlugin", () => {
  it("stops chain when characterAuras present", async () => {
    const plugin = createSoulDialogPlugin()

    const result = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      contextPack: { ...mockContextPack, characterAuras: "角色光环内容" },
    })

    expect(result.shouldStop).toBe(true)
    expect(result.stopReason).toBe("soul_dialog_confirmation_required")
  })

  it("does not stop when characterAuras empty", async () => {
    const plugin = createSoulDialogPlugin()

    const result = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      contextPack: { ...mockContextPack, characterAuras: "" },
    })

    expect(result.shouldStop).toBeUndefined()
  })

  it("does nothing when not in novel mode", async () => {
    const plugin = createSoulDialogPlugin()

    const result = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: false,
      contextPack: { ...mockContextPack, characterAuras: "角色光环内容" },
    })

    expect(result.shouldStop).toBeUndefined()
  })

  it("does nothing when no context pack", async () => {
    const plugin = createSoulDialogPlugin()

    const result = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
    })

    expect(result.shouldStop).toBeUndefined()
  })

  it("supports custom shouldRequest function", async () => {
    const customShould = vi.fn().mockReturnValue(true)
    const plugin = createSoulDialogPlugin({ shouldRequestSoulDialog: customShould })

    const result = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      contextPack: mockContextPack,
    })

    expect(customShould).toHaveBeenCalledWith(mockContextPack)
    expect(result.shouldStop).toBe(true)
  })
})

describe("Task3: Plugin Chain Integration", () => {
  it("chains build_context_pack -> soul_dialog correctly", async () => {
    const mockBuild = vi.fn().mockResolvedValue({
      ...mockContextPack,
      characterAuras: "需要确认的角色光环",
    })

    const chain = createPrePluginChain([
      createBuildContextPackPlugin({ buildContextPack: mockBuild }),
      createSoulDialogPlugin(),
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
    expect(result.errors).toHaveLength(0)
  })

  it("continues chain when soul dialog not needed", async () => {
    const mockBuild = vi.fn().mockResolvedValue({
      ...mockContextPack,
      characterAuras: "",
    })

    const chain = createPrePluginChain([
      createBuildContextPackPlugin({ buildContextPack: mockBuild }),
      createSoulDialogPlugin(),
    ])

    const result = await chain.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: { intent: "write_chapter", confidence: 0.9, chapterNumber: 5, extractedParams: {} },
    })

    expect(result.contextPack).toBeDefined()
    expect(result.shouldStop).toBeUndefined()
    expect(result.errors).toHaveLength(0)
  })
})
