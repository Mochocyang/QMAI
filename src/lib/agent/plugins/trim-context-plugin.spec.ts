import { describe, expect, it, vi } from "vitest"
import { createTrimContextPlugin } from "./trim-context-plugin"
import { createBuildSystemPromptPlugin } from "./build-system-prompt-plugin"
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
  storyFrameworkBinding: "",
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

describe("TrimContextPlugin", () => {
  it("生产默认路径遇到正典溢出时停机，而不是静默丢掉正典继续生成", async () => {
    // 生产装配（novel-pre-plugin-chain）两个 fn 依赖都不传，会走 mod.trimContextPack，
    // 那条路径没有守卫，必须由插件自己兜住。
    const canon = "原作正典：" + "斗气分九段。".repeat(80)
    const errors: Error[] = []
    const plugin = createTrimContextPlugin({
      tokenBudget: 200,
      onError: (error) => errors.push(error),
    })

    const result = await plugin.run({
      userMessage: "写第2章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      contextPack: { ...mockContextPack, sourceCanon: canon },
    })

    expect(result.shouldStop).toBe(true)
    expect(result.stopReason).toBe("source_canon_overflow")
    // 不能让提示词带着「没有正典」的内容流下去
    expect(result.novelSystemPrompt).toBeUndefined()
    expect(errors[0]?.message).toContain("原作正典")
  })

  it("预算充足时正典完整保留且不停机", async () => {
    const canon = "原作正典：斗气分九段；萧炎曾跌为废物。"
    const plugin = createTrimContextPlugin({ tokenBudget: 60000 })

    const result = await plugin.run({
      userMessage: "写第2章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      contextPack: { ...mockContextPack, sourceCanon: canon },
    })

    expect(result.shouldStop).toBeFalsy()
    expect(result.novelSystemPrompt).toContain(canon)
  })

  it("原创项目（无正典）在极小预算下照常裁剪，不触发停机", async () => {
    const plugin = createTrimContextPlugin({ tokenBudget: 200 })

    const result = await plugin.run({
      userMessage: "写第2章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      contextPack: mockContextPack,
    })

    expect(result.shouldStop).toBeFalsy()
    expect(result.novelSystemPrompt).toBeTruthy()
  })

  it("trims context pack to prompt string", async () => {
    const mockToPrompt = vi.fn().mockReturnValue("裁剪后的上下文")
    const plugin = createTrimContextPlugin({ contextPackToPromptFn: mockToPrompt })

    const result = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      contextPack: mockContextPack,
    })

    expect(result.novelSystemPrompt).toBe("裁剪后的上下文")
    expect(mockToPrompt).toHaveBeenCalled()
  })

  it("passes token budget when maxContextSize available", async () => {
    const mockToPrompt = vi.fn().mockReturnValue("裁剪后")
    const plugin = createTrimContextPlugin({ contextPackToPromptFn: mockToPrompt })

    const result = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {
        llmConfig: { maxContextSize: 204_800 },
      } as any,
      novelMode: true,
      contextPack: mockContextPack,
    })

    expect(result.novelSystemPrompt).toBeDefined()
    expect(mockToPrompt).toHaveBeenCalled()
    const budgetArg = mockToPrompt.mock.calls[0][1]
    expect(typeof budgetArg).toBe("number")
    expect(budgetArg).toBeGreaterThan(0)
    expect(Number.isFinite(budgetArg)).toBe(true)
  })

  it("supports custom token budget", async () => {
    const mockToPrompt = vi.fn().mockReturnValue("裁剪后")
    const plugin = createTrimContextPlugin({ contextPackToPromptFn: mockToPrompt, tokenBudget: 2000 })

    await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      contextPack: mockContextPack,
    })

    expect(mockToPrompt.mock.calls[0][1]).toBe(2000)
  })

  it("returns empty when not in novel mode", async () => {
    const mockToPrompt = vi.fn().mockReturnValue("裁剪后")
    const plugin = createTrimContextPlugin({ contextPackToPromptFn: mockToPrompt })

    const result = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: false,
      contextPack: mockContextPack,
    })

    expect(result.novelSystemPrompt).toBeUndefined()
    expect(mockToPrompt).not.toHaveBeenCalled()
  })

  it("returns empty when no context pack", async () => {
    const mockToPrompt = vi.fn().mockReturnValue("裁剪后")
    const plugin = createTrimContextPlugin({ contextPackToPromptFn: mockToPrompt })

    const result = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
    })

    expect(result.novelSystemPrompt).toBeUndefined()
    expect(mockToPrompt).not.toHaveBeenCalled()
  })

  it("handles error gracefully", async () => {
    const mockError = vi.fn()
    const mockToPrompt = vi.fn().mockImplementation(() => {
      throw new Error("trim failed")
    })
    const plugin = createTrimContextPlugin({ contextPackToPromptFn: mockToPrompt, onError: mockError })

    const result = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      contextPack: mockContextPack,
    })

    expect(result.novelSystemPrompt).toBeUndefined()
    expect(mockError).toHaveBeenCalled()
  })
})

describe("BuildSystemPromptPlugin", () => {
  it("builds final system prompt from base + context + task directive", async () => {
    const plugin = createBuildSystemPromptPlugin({ baseSystemPrompt: "你是一个写作助手" })

    const result = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: { intent: "write_chapter", confidence: 0.9, chapterNumber: 5, extractedParams: {} },
      novelSystemPrompt: "小说上下文内容",
    })

    expect(result.finalSystemPrompt).toBeDefined()
    expect(result.finalSystemPrompt).toContain("你是一个写作助手")
    expect(result.finalSystemPrompt).toContain("小说上下文内容")
    expect(result.finalSystemPrompt).toContain("任务类型识别")
    expect(result.finalSystemPrompt).toContain("章节生成")
  })

  it("uses effectiveTaskRoute if available", async () => {
    const plugin = createBuildSystemPromptPlugin({ baseSystemPrompt: "基础系统提示" })

    const result = await plugin.run({
      userMessage: "写章节",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: { intent: "write_chapter", confidence: 0.9, extractedParams: {} },
      effectiveTaskRoute: { intent: "continue_chapter", confidence: 0.95, chapterNumber: 7, extractedParams: { chapterNumber: "7" } },
      novelSystemPrompt: "小说上下文",
    })

    expect(result.finalSystemPrompt).toContain("章节续写")
  })

  it("works without task route", async () => {
    const plugin = createBuildSystemPromptPlugin({ baseSystemPrompt: "基础系统提示" })

    const result = await plugin.run({
      userMessage: "随便聊聊",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      novelSystemPrompt: "小说上下文",
    })

    expect(result.finalSystemPrompt).toContain("基础系统提示")
    expect(result.finalSystemPrompt).toContain("小说上下文")
  })

  it("works without novel system prompt", async () => {
    const plugin = createBuildSystemPromptPlugin({ baseSystemPrompt: "基础系统提示" })

    const result = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: { intent: "write_chapter", confidence: 0.9, chapterNumber: 5, extractedParams: {} },
    })

    expect(result.finalSystemPrompt).toContain("基础系统提示")
    expect(result.finalSystemPrompt).toContain("章节生成")
  })

  it("returns empty when not in novel mode", async () => {
    const plugin = createBuildSystemPromptPlugin({ baseSystemPrompt: "基础系统提示" })

    const result = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: false,
      taskRoute: { intent: "write_chapter", confidence: 0.9, chapterNumber: 5, extractedParams: {} },
      novelSystemPrompt: "小说上下文",
    })

    expect(result.finalSystemPrompt).toBeUndefined()
  })

  it("uses agentConfig systemPrompt as fallback", async () => {
    const plugin = createBuildSystemPromptPlugin()

    const result = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: { systemPrompt: "Agent配置的系统提示" } as any,
      novelMode: true,
      taskRoute: { intent: "write_chapter", confidence: 0.9, chapterNumber: 5, extractedParams: {} },
    })

    expect(result.finalSystemPrompt).toContain("Agent配置的系统提示")
  })
})

describe("Task4: Plugin Chain Integration", () => {
  it("full chain: trim_context -> build_system_prompt", async () => {
    const mockToPrompt = vi.fn().mockReturnValue("裁剪后的小说上下文")

    const chain = createPrePluginChain([
      createTrimContextPlugin({ contextPackToPromptFn: mockToPrompt }),
      createBuildSystemPromptPlugin({ baseSystemPrompt: "你是一个专业的小说写作助手" }),
    ])

    const result = await chain.run({
      userMessage: "写第5章",
      projectPath: "/test-project",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: { intent: "write_chapter", confidence: 0.9, chapterNumber: 5, extractedParams: {} },
      contextPack: mockContextPack,
    })

    expect(result.novelSystemPrompt).toBe("裁剪后的小说上下文")
    expect(result.finalSystemPrompt).toBeDefined()
    expect(result.finalSystemPrompt).toContain("你是一个专业的小说写作助手")
    expect(result.finalSystemPrompt).toContain("裁剪后的小说上下文")
    expect(result.finalSystemPrompt).toContain("章节生成")
    expect(result.errors).toHaveLength(0)
  })
})
