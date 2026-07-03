import { describe, expect, it, vi } from "vitest"
import { DEFAULT_NOVEL_CONFIG, useWikiStore, type LlmConfig } from "@/stores/wiki-store"
import type { AgentActivityEvent } from "@/lib/agent/types"
import type { ChatMessage, RequestOverrides, StreamCallbacks } from "@/lib/llm-client"
import type { ContextPack } from "./context-engine"
import type { NovelReviewResult } from "./review-adapter"
import {
  shouldUseDeepChapterGeneration,
  runDeepChapterGeneration,
  type DeepChapterGenerationDeps,
  type DeepChapterGenerationResumeCheckpoint,
} from "./deep-chapter-generation"
import {
  buildDeepChapterBriefPrompt,
  buildDeepChapterDraftPrompt,
  buildDeepChapterFinalPolishPrompt,
  buildDeepChapterRevisionPrompt,
  DEEP_CHAPTER_DRAFT_MAX_CHARS,
  DEEP_CHAPTER_MIN_CHARS,
} from "./deep-chapter-prompts"

const llmConfig = {
  provider: "custom",
  apiKey: "test-key",
  model: "test-model",
  ollamaUrl: "",
  customEndpoint: "https://example.test/v1",
  maxContextSize: 120000,
  reasoning: { mode: "high" },
} satisfies LlmConfig

const contextPack: ContextPack = {
  task: "生成第3章",
  chapterGoal: "第3章目标：主角进入雨夜旧屋，发现第一条线索。",
  outline: "第3章：雨夜旧屋，发现线索，结尾留下危险钩子。",
  recentSummaries: ["第1章：主角收到匿名信。", "第2章：主角抵达旧城区。"],
  previousChapterEnding: "门缝里传来金属拖拽声。",
  characterStates: "主角谨慎，但急于确认真相。",
  soulDoc: "",
  characterAuras: "",
  cognitionStates: "主角不知道旧屋主人真实身份。",
  foreshadowingStates: "匿名信、锈钥匙尚未回收。",
  timeline: "雨夜，当晚十点。",
  relatedSettings: "旧屋位于停电后的城区边缘。",
  canonRules: "主角不能凭空知道旧屋主人身份。",
  writingStyle: "悬疑、克制、画面感强。",
  searchResults: "旧屋相关记忆片段。",
  graphSearchResults: "匿名信 -> 旧屋 -> 锈钥匙。",
  mustDo: "承接上一章门缝声，推进锈钥匙线索。",
  mustAvoid: "不要提前揭露旧屋主人身份。",
  nextChapterAdvice: "结尾引出屋内第二个人影。",
  revisionDirectives: "",
}

function chapterText(prefix: string, count = 3000): string {
  const scenes = [
    "雨水沿着瓦檐落下，旧屋里的灯影忽明忽暗，主角先确认门缝后的动静。",
    "他没有急着开口，而是把锈钥匙压在掌心，听见墙后传来短促的摩擦声。",
    "小晴醒来时仍有些发冷，她的回答补上了上一章留下的疑点，却也带出新的矛盾。",
    "两人沿着走廊往里走，地板下的空响让他们意识到这间屋子被人提前动过手脚。",
    "主角试探着推开柜门，里面没有想象中的尸体，只有一封被雨气浸软的旧信。",
    "信纸上的字迹和匿名信相互呼应，但关键名字被刻意刮掉，线索因此变得更危险。",
    "屋外的脚步声突然停住，像有人贴着门听他们说话，空气一下子绷紧。",
    "主角把小晴挡到身后，决定先带走信纸，却在箱底摸到第二把完全陌生的钥匙。",
  ]
  let text = prefix
  let index = 0
  while (text.length < count) {
    text += `${scenes[index % scenes.length]}第${index + 1}个细节把人物选择继续往前推。`
    index += 1
  }
  return text.slice(0, count)
}

// 写作阶段现在可能把 user 消息内容拆成带 cache_control 的文本块（见 applyCachePrefix）；
// provider 侧会把纯文本块拼回字符串，这里在测试桩里也照做，保持按关键字匹配阶段的逻辑。
function messagesPromptText(messages: ChatMessage[]): string {
  return messages
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
    )
    .join("\n")
}

function createDeps(reviewResults: NovelReviewResult[] = []): DeepChapterGenerationDeps {
  const responses = [
    "写作任务书内容",
    chapterText("初稿正文内容"),
    chapterText("返修正文内容"),
    chapterText("最终去AI味正文"),
  ]
  return {
    buildContextPack: vi.fn(async () => contextPack),
    contextPackToPrompt: vi.fn(() => "上下文包内容"),
    reviewChapter: vi.fn(async () => reviewResults),
    streamChat: vi.fn(async (_config: LlmConfig, messages: ChatMessage[], callbacks: StreamCallbacks) => {
      const prompt = messagesPromptText(messages)
      const content = prompt.includes("简单审查") || prompt.includes("去AI味")
        ? responses[3]
        : prompt.includes("返修")
          ? responses[2]
          : prompt.includes("正文")
            ? responses[1]
            : responses[0]
      callbacks.onToken(content)
      callbacks.onDone()
    }),
  }
}

describe("runDeepChapterGeneration", () => {
  it("keeps the word-count target in planning and draft prompts without forcing later review stages", () => {
    const reviewResults: NovelReviewResult[] = [{
      severity: "error",
      type: "plot",
      message: "测试问题",
      evidence: "",
      relatedMemory: "",
      suggestion: "",
    }]

    const planningPrompt = buildDeepChapterBriefPrompt("", "上下文包内容", "生成第3章", 3)
    const draftPrompt = buildDeepChapterDraftPrompt("", "上下文包内容", "写作任务书内容", "生成第3章", 3)
    const revisionPrompt = buildDeepChapterRevisionPrompt("", "上下文包内容", "写作任务书内容", "初稿正文内容", reviewResults, "生成第3章", 3)
    const finalPolishPrompt = buildDeepChapterFinalPolishPrompt("", "上下文包内容", "写作任务书内容", "返修正文内容", "生成第3章", 3)

    for (const prompt of [planningPrompt, draftPrompt]) {
      expect(prompt).toContain(`低于 ${DEEP_CHAPTER_MIN_CHARS} 字`)
      expect(prompt).toContain("目标约 3000 字")
      expect(prompt).not.toContain("2200-3200 字")
      expect(prompt).not.toContain("阶段4优化")
    }
    expect(draftPrompt).toContain(`阶段3正文草稿最多 ${DEEP_CHAPTER_DRAFT_MAX_CHARS} 字`)
    for (const prompt of [revisionPrompt, finalPolishPrompt]) {
      expect(prompt).not.toContain(`低于 ${DEEP_CHAPTER_MIN_CHARS} 字`)
      expect(prompt).not.toContain("目标约 3000 字")
      expect(prompt).not.toContain("全文安全上限")
      expect(prompt).not.toContain("2200-3200 字")
    }
    expect(finalPolishPrompt).toContain("中文小说去 AI 味补充规则")
    expect(finalPolishPrompt).toContain("角色声线")
    expect(finalPolishPrompt).toContain("不要按非虚构文章规则硬删副词")
  })

  it("enables the multi-task generation loop for all chapter writing routes", () => {
    expect(shouldUseDeepChapterGeneration({ intent: "write_chapter", confidence: 1, extractedParams: {} }, false)).toBe(true)
    expect(shouldUseDeepChapterGeneration({ intent: "continue_chapter", confidence: 1, extractedParams: {} }, false)).toBe(true)
    expect(shouldUseDeepChapterGeneration({ intent: "rewrite_chapter", confidence: 1, extractedParams: {} }, false)).toBe(true)
    expect(shouldUseDeepChapterGeneration({ intent: "general_chat", confidence: 1, extractedParams: {} }, true)).toBe(false)
    expect(shouldUseDeepChapterGeneration(null, true)).toBe(false)
  })

  it("publishes stage results into thinking and returns the final simple review result when review passes", async () => {
    const deps = createDeps()
    const thinking: string[] = []

    const result = await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第3章", chapterNumber: 3, llmConfig },
      { onThinking: (content) => thinking.push(content) },
      deps,
    )

    expect(result.finalContent).toContain("最终去AI味正文")
    expect(result.revised).toBe(false)
    expect(thinking.join("\n")).toContain("阶段1：上下文分析")
    expect(thinking.join("\n")).toContain("阶段2：写作任务书")
    expect(thinking.join("\n")).toContain("阶段3：正文初稿")
    expect(thinking.join("\n")).toContain("阶段4：AI审稿")
    expect(thinking.join("\n")).toContain("阶段6：简单审查与去AI味")
    expect(thinking.join("\n")).toContain("未发现阻断问题")
  })

  it("emits structured activity events for context extraction and stage outputs", async () => {
    const deps = createDeps()
    const activityEvents: AgentActivityEvent[] = []

    await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "生成第3章",
        chapterNumber: 3,
        llmConfig,
        aiWorkflowMode: "fast",
      },
      { onActivityEvent: (event) => activityEvents.push(event) },
      deps,
    )

    expect(activityEvents.some((event) => event.kind === "read_source" && event.content.includes("上一章结尾"))).toBe(true)
    expect(activityEvents.some((event) => event.kind === "extract_goal" && event.content.includes("上一章结尾"))).toBe(true)
    expect(activityEvents.some((event) => event.kind === "extract_result" && event.content.includes("门缝里传来金属拖拽声"))).toBe(true)
    expect(activityEvents.some((event) => event.kind === "stage_output" && event.content.includes("任务书"))).toBe(true)
  })

  it("injects the enabled writing style into the stage 3 draft prompt", async () => {
    const capturedPrompts: string[] = []
    const enabledStyleContext = "目标文风来源：《长夜书》\n风格硬约束：冷峻克制、短句推进、少解释"
    const deps = createDeps()
    vi.mocked(deps.contextPackToPrompt).mockImplementation((pack) => {
      expect(pack.writingStyle).toContain("悬疑")
      return enabledStyleContext
    })
    vi.mocked(deps.streamChat).mockImplementation(async (_config: LlmConfig, messages: ChatMessage[], callbacks: StreamCallbacks) => {
      const prompt = messagesPromptText(messages)
      capturedPrompts.push(prompt)
      const content = prompt.includes("简单审查") || prompt.includes("去AI味")
        ? chapterText("最终文风正文", 3000)
        : prompt.includes("返修")
          ? chapterText("返修文风正文", 3000)
          : prompt.includes("正文")
            ? chapterText("初稿文风正文", 3000)
            : "写作任务书内容"
      callbacks.onToken(content)
      callbacks.onDone()
    })

    await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第三章", chapterNumber: 3, llmConfig },
      {},
      deps,
    )

    expect(capturedPrompts[1]).toContain("目标文风来源：《长夜书》")
    expect(capturedPrompts[1]).toContain("冷峻克制")
  })

  it("does not pass app-side max_tokens limits to deep chapter model calls", async () => {
    const deps = createDeps()
    const overrides: Array<RequestOverrides | undefined> = []
    vi.mocked(deps.streamChat).mockImplementation(async (
      _config: LlmConfig,
      messages: ChatMessage[],
      callbacks: StreamCallbacks,
      _signal,
      requestOverrides,
    ) => {
      overrides.push(requestOverrides)
      const prompt = messagesPromptText(messages)
      const content = prompt.includes("简单审查") || prompt.includes("去AI味")
        ? chapterText("最终无上限正文", 3000)
        : prompt.includes("返修")
          ? chapterText("返修无上限正文", 3000)
          : prompt.includes("正文")
            ? chapterText("初稿无上限正文", 3000)
            : "写作任务书内容"
      callbacks.onToken(content)
      callbacks.onDone()
    })

    await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第三章", chapterNumber: 3, llmConfig },
      {},
      deps,
    )

    expect(overrides.length).toBeGreaterThan(0)
    expect(overrides.every((item) => item?.max_tokens === undefined)).toBe(true)
  })

  it("preserves configured model reasoning for chapter generation calls", async () => {
    const deps = createDeps()
    const overrides: Array<RequestOverrides | undefined> = []
    vi.mocked(deps.streamChat).mockImplementation(async (
      _config: LlmConfig,
      messages: ChatMessage[],
      callbacks: StreamCallbacks,
      _signal,
      requestOverrides,
    ) => {
      overrides.push(requestOverrides)
      const prompt = messagesPromptText(messages)
      callbacks.onToken(prompt.includes("正文") ? chapterText("保留推理正文", 3000) : "写作任务书内容")
      callbacks.onDone()
    })

    await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第三章", chapterNumber: 3, llmConfig },
      {},
      deps,
    )

    expect(overrides.length).toBeGreaterThan(0)
    expect(overrides.every((item) => item?.reasoning === undefined)).toBe(true)
  })

  it("retries the current chapter generation stage with reasoning disabled after reasoning-only output", async () => {
    const deps = createDeps()
    const overrides: Array<RequestOverrides | undefined> = []
    let callCount = 0
    vi.mocked(deps.streamChat).mockImplementation(async (
      _config: LlmConfig,
      messages: ChatMessage[],
      callbacks: StreamCallbacks,
      _signal,
      requestOverrides,
    ) => {
      callCount += 1
      overrides.push(requestOverrides)
      if (callCount === 1) {
        callbacks.onReasoningToken?.("思考".repeat(160))
        callbacks.onError(new Error("模型只输出了 543 字符的思考内容，但没有输出正文。"))
        return
      }

      const prompt = messagesPromptText(messages)
      const content = prompt.includes("简单审查") || prompt.includes("去AI味")
        ? chapterText("最终兜底正文", 3000)
        : prompt.includes("返修")
          ? chapterText("返修兜底正文", 3000)
          : prompt.includes("正文")
            ? chapterText("初稿兜底正文", 3000)
            : "写作任务书内容"
      callbacks.onToken(content)
      callbacks.onDone()
    })

    const result = await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第三章", chapterNumber: 3, llmConfig },
      {},
      deps,
    )

    expect(result.finalContent).toContain("最终兜底正文")
    expect(overrides[0]?.reasoning).toBeUndefined()
    expect(overrides[1]).toEqual({ reasoning: { mode: "off" } })
  })

  it("uses the same task loop with different workflow strength for fast standard and strict modes", async () => {
    const fastDeps = createDeps()
    await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第三章", chapterNumber: 3, llmConfig, aiWorkflowMode: "fast" },
      {},
      fastDeps,
    )
    expect(fastDeps.streamChat).toHaveBeenCalledTimes(2)
    expect(fastDeps.reviewChapter).not.toHaveBeenCalled()

    const standardDeps = createDeps()
    await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第三章", chapterNumber: 3, llmConfig, aiWorkflowMode: "standard" },
      {},
      standardDeps,
    )
    expect(standardDeps.streamChat).toHaveBeenCalledTimes(3)
    expect(standardDeps.reviewChapter).not.toHaveBeenCalled()

    const strictDeps = createDeps()
    await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第三章", chapterNumber: 3, llmConfig, aiWorkflowMode: "strict" },
      {},
      strictDeps,
    )
    expect(strictDeps.streamChat).toHaveBeenCalledTimes(3)
    expect(strictDeps.reviewChapter).toHaveBeenCalled()
  })

  it("keeps AI review mandatory in strict mode even when the global deep chapter review switch is off", async () => {
    const previousNovelConfig = useWikiStore.getState().novelConfig
    useWikiStore.setState({
      novelConfig: {
        ...DEFAULT_NOVEL_CONFIG,
        ...previousNovelConfig,
        deepChapterReview: false,
      },
    })
    try {
      const deps = createDeps()
      const events: Array<{ name: string; result?: string }> = []

      await runDeepChapterGeneration(
        { projectPath: "E:/Novel", userRequest: "生成第三章", chapterNumber: 3, llmConfig, aiWorkflowMode: "strict" },
        { onWorkflowEvent: (event) => events.push(event) },
        deps,
      )

      expect(deps.reviewChapter).toHaveBeenCalled()
      expect(events.find((event) => event.name === "chapter_review" && event.result)?.result).toContain("AI 审稿完成")
    } finally {
      useWikiStore.setState({ novelConfig: previousNovelConfig })
    }
  })

  it("emits visible workflow events for the chapter multi-task loop", async () => {
    const deps = createDeps()
    const events: Array<{ type: string; id: string; name: string; title: string; result?: string }> = []

    await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第三章", chapterNumber: 3, llmConfig, aiWorkflowMode: "strict" },
      { onWorkflowEvent: (event) => events.push(event) },
      deps,
    )

    const eventKeys = events.map((event) => `${event.type}:${event.name}`)
    expect(eventKeys).toEqual(expect.arrayContaining([
      "started:chapter_context",
      "completed:chapter_context",
      "started:chapter_task_brief",
      "completed:chapter_task_brief",
      "started:chapter_draft",
      "completed:chapter_draft",
      "started:chapter_review",
      "completed:chapter_review",
      "started:chapter_final_polish",
      "completed:chapter_final_polish",
      "completed:chapter_complete",
    ]))
    expect(events.find((event) => event.name === "chapter_task_brief")?.title).toBe("生成写作任务书")
    expect(events.find((event) => event.name === "chapter_complete")?.result).toContain("多任务写作循环完成")
  })

  it("keeps fast and standard workflow visibility aligned with their skipped stages", async () => {
    const fastEvents: Array<{ name: string; result?: string }> = []
    await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第三章", chapterNumber: 3, llmConfig, aiWorkflowMode: "fast" },
      { onWorkflowEvent: (event) => fastEvents.push(event) },
      createDeps(),
    )
    expect(fastEvents.find((event) => event.name === "chapter_review")?.result).toContain("快速模式跳过")
    expect(fastEvents.find((event) => event.name === "chapter_final_polish")?.result).toContain("快速模式跳过")

    const standardEvents: Array<{ name: string; result?: string }> = []
    await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第三章", chapterNumber: 3, llmConfig, aiWorkflowMode: "standard" },
      { onWorkflowEvent: (event) => standardEvents.push(event) },
      createDeps(),
    )
    expect(standardEvents.find((event) => event.name === "chapter_review")?.result).toContain("标准模式跳过")
    expect(standardEvents.find((event) => event.name === "chapter_final_polish" && event.result)?.result).toContain("简单审查与去AI味完成")
  })

  it("shows a visible golden-three hint in thinking when generating the first chapter", async () => {
    const deps = createDeps()
    const thinking: string[] = []

    await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "给我生成第1章内容",
        chapterNumber: 1,
        llmConfig,
        goldenThreeChapter: {
          enabled: true,
          targetChapter: 1,
          outputMode: "first_chapter_with_directions",
          requestedFirstThree: false,
        },
      },
      { onThinking: (content) => thinking.push(content) },
      deps,
    )

    expect(thinking.join("\n")).toContain("黄金三章：已启用")
    expect(thinking.join("\n")).toContain("当前按黄金三章规则生成第1章正文")
  })

  it("uses safe defaults when a context pack is missing optional array fields", async () => {
    const deps = createDeps()
    vi.mocked(deps.buildContextPack).mockResolvedValueOnce({
      ...contextPack,
      recentSummaries: undefined as unknown as string[],
      chapterGoal: undefined as unknown as string,
      characterStates: undefined as unknown as string,
    })
    const thinking: string[] = []

    await expect(runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第3章", chapterNumber: 3, llmConfig },
      { onThinking: (content) => thinking.push(content) },
      deps,
    )).resolves.toMatchObject({ finalContent: expect.any(String) })

    expect(thinking.join("\n")).toContain("近期剧情")
  })

  it("falls back to an empty context pack when context building throws", async () => {
    const deps = createDeps()
    vi.mocked(deps.buildContextPack).mockRejectedValueOnce(new Error("context failed"))
    const thinking: string[] = []

    await expect(runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "???3?", chapterNumber: 3, llmConfig },
      { onThinking: (content) => thinking.push(content) },
      deps,
    )).resolves.toMatchObject({ finalContent: expect.any(String) })

    expect(thinking.length).toBeGreaterThan(0)
  })

  it("revises once when review returns blocking errors", async () => {
    const deps = createDeps([
      {
        severity: "error",
        type: "plot",
        message: "没有承接上一章门缝声。",
        evidence: "初稿正文内容",
        relatedMemory: "上一章结尾",
        suggestion: "补上门缝声的承接。",
      },
    ])
    const thinking: string[] = []

    const result = await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第3章", chapterNumber: 3, llmConfig },
      { onThinking: (content) => thinking.push(content) },
      deps,
    )

    expect(result.finalContent).toContain("最终去AI味正文")
    expect(result.revised).toBe(true)
    expect(deps.streamChat).toHaveBeenCalledTimes(4)
    expect(thinking.join("\n")).toContain("阶段5：自动返修")
    expect(thinking.join("\n")).toContain("阶段6：简单审查与去AI味")
    expect(thinking.join("\n")).toContain("没有承接上一章门缝声")
  })

  it("automatically expands a too-short draft before review and final output", async () => {
    const shortDraft = chapterText("短稿", 800)
    const expandedDraft = chapterText("扩写后正文", 3000)
    const finalPolished = chapterText("最终去AI味正文", 3000)
    const deps: DeepChapterGenerationDeps = {
      buildContextPack: vi.fn(async () => contextPack),
      contextPackToPrompt: vi.fn(() => "上下文包内容"),
      reviewChapter: vi.fn(async () => []),
      streamChat: vi.fn(async (_config: LlmConfig, messages: ChatMessage[], callbacks: StreamCallbacks) => {
        const prompt = messagesPromptText(messages)
        const content = prompt.includes("简单审查") || prompt.includes("去AI味")
          ? finalPolished
          : prompt.includes("扩写补足")
          ? expandedDraft
          : prompt.includes("章节正文")
            ? shortDraft
            : "写作任务书内容"
        callbacks.onToken(content)
        callbacks.onDone()
      }),
    }
    const thinking: string[] = []

    const result = await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第3章", chapterNumber: 3, llmConfig },
      { onThinking: (content) => thinking.push(content) },
      deps,
    )

    expect(result.finalContent).toBe(finalPolished)
    expect(deps.streamChat).toHaveBeenCalledTimes(4)
    expect(deps.reviewChapter).toHaveBeenCalledWith("E:/Novel", expandedDraft, 3, expect.objectContaining({}))
    expect(thinking.join("\n")).toContain("阶段3：正文扩写补足")
    expect(thinking.join("\n")).toContain("阶段6：简单审查与去AI味")
  })

  it("does not force expansion after final polish even when the result is short", async () => {
    const draft = chapterText("初稿正文内容", 3000)
    const shortFinal = chapterText("最终润色后过短", 1800)
    const responses = [
      "写作任务书内容",
      draft,
      shortFinal,
    ]
    const deps: DeepChapterGenerationDeps = {
      buildContextPack: vi.fn(async () => contextPack),
      contextPackToPrompt: vi.fn(() => "上下文包内容"),
      reviewChapter: vi.fn(async () => []),
      streamChat: vi.fn(async (_config: LlmConfig, _messages: ChatMessage[], callbacks: StreamCallbacks) => {
        const content = responses.shift()
        callbacks.onToken(content ?? "")
        callbacks.onDone()
      }),
    }
    const thinking: string[] = []

    const result = await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成首章", chapterNumber: 1, llmConfig },
      { onThinking: (content) => thinking.push(content) },
      deps,
    )

    expect(result.finalContent).toBe(shortFinal)
    expect(deps.streamChat).toHaveBeenCalledTimes(3)
    expect(thinking.join("\n")).toContain("阶段5：无需自动返修")
    expect(thinking.join("\n")).toContain("阶段6：简单审查与去AI味")
    expect(thinking.join("\n")).not.toContain("阶段6：字数检查未达标")
    expect(thinking.join("\n")).not.toContain("阶段3：正文扩写补足")
  })

  it("trims runaway repeated chapter output before review and final polish", async () => {
    const repeatUnit = "屋外雨声小了些，风还从门缝挤进来。旧木箱的盖子松松地合上，那东西还在。小晴在床上动了动，掌心湿热，像两股不同的水在交汇。\n"
    const runawayDraft = repeatUnit.repeat(900)
    const optimizedDraft = chapterText("阶段4优化后正文", 3000)
    const finalPolished = chapterText("最终去AI味正文", 3000)
    const responses = [
      "写作任务书内容",
      runawayDraft,
      optimizedDraft,
      finalPolished,
    ]
    const deps: DeepChapterGenerationDeps = {
      buildContextPack: vi.fn(async () => contextPack),
      contextPackToPrompt: vi.fn(() => "上下文包内容"),
      reviewChapter: vi.fn(async () => []),
      streamChat: vi.fn(async (_config: LlmConfig, _messages: ChatMessage[], callbacks: StreamCallbacks) => {
        callbacks.onToken(responses.shift() ?? "")
        callbacks.onDone()
      }),
    }
    const thinking: string[] = []

    const result = await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第3章", chapterNumber: 3, llmConfig },
      { onThinking: (content) => thinking.push(content) },
      deps,
    )

    expect(result.draftContent).toBe(optimizedDraft)
    expect(result.finalContent).toBe(finalPolished)
    expect(deps.reviewChapter).toHaveBeenCalledWith("E:/Novel", optimizedDraft, 3, expect.objectContaining({}))
    expect(thinking.join("\n")).toContain("检测到模型重复输出")
  })

  it("does not stop the AI chat stream at the old chapter hard max", async () => {
    const longDraft = chapterText("超过旧硬上限但不是重复输出的正文", 6500)
    const finalPolished = chapterText("最终去AI味正文", 3000)
    const responses = [
      "写作任务书内容",
      longDraft,
      finalPolished,
    ]
    const deps: DeepChapterGenerationDeps = {
      buildContextPack: vi.fn(async () => contextPack),
      contextPackToPrompt: vi.fn(() => "上下文包内容"),
      reviewChapter: vi.fn(async () => []),
      streamChat: vi.fn(async (_config: LlmConfig, _messages: ChatMessage[], callbacks: StreamCallbacks) => {
        callbacks.onToken(responses.shift() ?? "")
        callbacks.onDone()
      }),
    }
    const thinking: string[] = []

    const result = await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第3章", chapterNumber: 3, llmConfig },
      { onThinking: (content) => thinking.push(content) },
      deps,
    )

    expect(result.draftContent).toBe(longDraft)
    expect(deps.reviewChapter).toHaveBeenCalledWith("E:/Novel", longDraft, 3, expect.objectContaining({}))
    expect(thinking.join("\n")).not.toContain("已达到本章字数上限")
    expect(thinking.join("\n")).not.toContain("内容已达到安全上限")
  })

  it("sends long drafts directly to review without a stage 4 length rewrite", async () => {
    const overlongDraft = chapterText("过长初稿正文", 5200)
    const finalPolished = chapterText("最终去AI味正文", 3000)
    const responses = [
      "写作任务书内容",
      overlongDraft,
      finalPolished,
    ]
    const deps: DeepChapterGenerationDeps = {
      buildContextPack: vi.fn(async () => contextPack),
      contextPackToPrompt: vi.fn(() => "上下文包内容"),
      reviewChapter: vi.fn(async () => []),
      streamChat: vi.fn(async (_config: LlmConfig, _messages: ChatMessage[], callbacks: StreamCallbacks) => {
        callbacks.onToken(responses.shift() ?? "")
        callbacks.onDone()
      }),
    }
    const thinking: string[] = []

    await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第3章", chapterNumber: 3, llmConfig },
      { onThinking: (content) => thinking.push(content) },
      deps,
    )

    expect(deps.reviewChapter).toHaveBeenCalledWith("E:/Novel", overlongDraft, 3, expect.objectContaining({}))
    expect(deps.streamChat).toHaveBeenCalledTimes(3)
    expect(thinking.join("\n")).not.toContain("2200-3200")
    expect(thinking.join("\n")).not.toContain("字数优化")
  })

  it("does not optimize the stage 3 draft in stage 4 before review", async () => {
    const draft = chapterText("阶段3较长初稿", 5500)
    const finalPolished = chapterText("最终去AI味正文", 3000)
    const responses = [
      "写作任务书内容",
      draft,
      finalPolished,
    ]
    const deps: DeepChapterGenerationDeps = {
      buildContextPack: vi.fn(async () => contextPack),
      contextPackToPrompt: vi.fn(() => "上下文包内容"),
      reviewChapter: vi.fn(async () => []),
      streamChat: vi.fn(async (_config: LlmConfig, _messages: ChatMessage[], callbacks: StreamCallbacks) => {
        callbacks.onToken(responses.shift() ?? "")
        callbacks.onDone()
      }),
    }
    const thinking: string[] = []

    await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第3章", chapterNumber: 3, llmConfig },
      { onThinking: (content) => thinking.push(content) },
      deps,
    )

    expect(deps.reviewChapter).toHaveBeenCalledWith("E:/Novel", draft, 3, expect.objectContaining({}))
    expect(deps.streamChat).toHaveBeenCalledTimes(3)
    expect(thinking.join("\n")).not.toContain("2200-3200")
  })

  it("does not retry stage 4 length optimization when the draft stays long", async () => {
    const draft = chapterText("阶段3超长初稿", 5500)
    const finalPolished = chapterText("最终去AI味正文", 3000)
    const responses = [
      "写作任务书内容",
      draft,
      finalPolished,
    ]
    const deps: DeepChapterGenerationDeps = {
      buildContextPack: vi.fn(async () => contextPack),
      contextPackToPrompt: vi.fn(() => "上下文包内容"),
      reviewChapter: vi.fn(async () => []),
      streamChat: vi.fn(async (_config: LlmConfig, _messages: ChatMessage[], callbacks: StreamCallbacks) => {
        callbacks.onToken(responses.shift() ?? "")
        callbacks.onDone()
      }),
    }
    const thinking: string[] = []

    const result = await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第3章", chapterNumber: 3, llmConfig },
      { onThinking: (content) => thinking.push(content) },
      deps,
    )

    expect(result.finalContent).toBe(finalPolished)
    expect(deps.reviewChapter).toHaveBeenCalledWith("E:/Novel", draft, 3, expect.objectContaining({}))
    expect(deps.streamChat).toHaveBeenCalledTimes(3)
    expect(thinking.join("\n")).not.toContain("2200-3200")
    expect(thinking.join("\n")).not.toContain("连续尝试")
  })

  it("does not force a length rewrite after final polish", async () => {
    const draft = chapterText("初稿正文内容", 3000)
    const overlongFinal = chapterText("简单审查后过长正文", 5200)
    const responses = [
      "写作任务书内容",
      draft,
      overlongFinal,
    ]
    const deps: DeepChapterGenerationDeps = {
      buildContextPack: vi.fn(async () => contextPack),
      contextPackToPrompt: vi.fn(() => "上下文包内容"),
      reviewChapter: vi.fn(async () => []),
      streamChat: vi.fn(async (_config: LlmConfig, _messages: ChatMessage[], callbacks: StreamCallbacks) => {
        callbacks.onToken(responses.shift() ?? "")
        callbacks.onDone()
      }),
    }
    const thinking: string[] = []

    const result = await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第3章", chapterNumber: 3, llmConfig },
      { onThinking: (content) => thinking.push(content) },
      deps,
    )

    expect(result.finalContent).toBe(overlongFinal)
    expect(deps.streamChat).toHaveBeenCalledTimes(3)
    expect(thinking.join("\n")).toContain("阶段6：简单审查与去AI味")
    expect(thinking.join("\n")).not.toContain("2200-3200")
    expect(thinking.join("\n")).not.toContain("字数检查与正文优化")
  })

  it("resumes from a saved review checkpoint instead of regenerating earlier stages", async () => {
    const finalPolished = chapterText("恢复后的最终正文", 3000)
    const checkpoint: DeepChapterGenerationResumeCheckpoint = {
      version: 1,
      originalRequest: "生成第3章",
      chapterNumber: 3,
      stage: "after_review",
      taskBrief: "写作任务书内容",
      draftContent: chapterText("阶段4完成后的正文草稿", 3000),
      reviewResults: [],
    }
    const deps: DeepChapterGenerationDeps = {
      buildContextPack: vi.fn(async () => contextPack),
      contextPackToPrompt: vi.fn(() => "上下文包内容"),
      reviewChapter: vi.fn(async () => {
        throw new Error("resume should not rerun review")
      }),
      streamChat: vi.fn(async (_config: LlmConfig, _messages: ChatMessage[], callbacks: StreamCallbacks) => {
        callbacks.onToken(finalPolished)
        callbacks.onDone()
      }),
    }
    const thinking: string[] = []

    const result = await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "生成第3章",
        chapterNumber: 3,
        llmConfig,
        resumeCheckpoint: checkpoint,
      },
      { onThinking: (content) => thinking.push(content) },
      deps,
    )

    expect(result.finalContent).toBe(finalPolished)
    expect(result.revised).toBe(false)
    expect(deps.streamChat).toHaveBeenCalledTimes(1)
    expect(deps.reviewChapter).not.toHaveBeenCalled()
    expect(thinking.join("\n")).not.toContain("阶段1：上下文分析")
    expect(thinking.join("\n")).not.toContain("阶段2：写作任务书")
    expect(thinking.join("\n")).toContain("阶段5：无需自动返修")
    expect(thinking.join("\n")).toContain("阶段7：完成")
  })

  it("still treats provider-side cancellation as an error when there is no local length cutoff", async () => {
    const longDraft = chapterText("供应商取消前已返回的长正文", 4700)
    let callIndex = 0
    const deps: DeepChapterGenerationDeps = {
      buildContextPack: vi.fn(async () => contextPack),
      contextPackToPrompt: vi.fn(() => "上下文包内容"),
      reviewChapter: vi.fn(async () => []),
      streamChat: vi.fn(async (_config: LlmConfig, _messages: ChatMessage[], callbacks: StreamCallbacks) => {
        callIndex += 1
        if (callIndex === 2) {
          callbacks.onToken(longDraft)
          callbacks.onError(new Error("Request cancelled"))
          return
        }
        callbacks.onToken("写作任务书内容")
        callbacks.onDone()
      }),
    }

    await expect(runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第3章", chapterNumber: 3, llmConfig },
      {},
      deps,
    )).rejects.toThrow("Request cancelled")
  })

  it("stops before review when the user cancels during draft streaming", async () => {
    const controller = new AbortController()
    const deps: DeepChapterGenerationDeps = {
      buildContextPack: vi.fn(async () => contextPack),
      contextPackToPrompt: vi.fn(() => "上下文包内容"),
      reviewChapter: vi.fn(async () => []),
      streamChat: vi.fn(async (_config: LlmConfig, messages: ChatMessage[], callbacks: StreamCallbacks) => {
        const prompt = messagesPromptText(messages)
        callbacks.onToken(prompt.includes("章节正文") ? chapterText("被停止的正文", 3000) : "写作任务书内容")
        if (prompt.includes("章节正文")) controller.abort()
        callbacks.onDone()
      }),
    }

    await expect(runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第3章", chapterNumber: 3, llmConfig },
      {},
      deps,
      controller.signal,
    )).rejects.toThrow("已停止生成")

    expect(deps.reviewChapter).not.toHaveBeenCalled()
  })
  it("forwards the stop signal into the review stage", async () => {
    const deps = createDeps()
    const controller = new AbortController()

    await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第3章", chapterNumber: 3, llmConfig },
      {},
      deps,
      controller.signal,
    )

    expect(deps.reviewChapter).toHaveBeenCalledWith(
      "E:/Novel",
      expect.any(String),
      3,
      expect.objectContaining({}),
      controller.signal,
    )
  })
})
