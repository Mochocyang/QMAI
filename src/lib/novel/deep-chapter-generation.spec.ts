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
import { contractToTaskBriefText, createEmptyContract, type ChapterExecutionContract } from "./chapter-execution-contract"

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

const executionContract: ChapterExecutionContract = {
  objective: "推进旧屋线索",
  knownContext: ["上一章门缝声未解"],
  assumptions: [],
  sceneSteps: [{
    id: "S1",
    title: "旧屋门口",
    purpose: "承接悬念",
    conflict: "主角要进屋，小晴阻止",
    turn: "门内传来第二声响",
    requiredOutcome: "主角进入旧屋",
    acceptanceCriteria: ["出现门缝声承接", "主角进入旧屋"],
  }],
  mustDo: ["推进锈钥匙"],
  mustAvoid: ["不得提前揭露旧屋主人"],
  dialogueGoals: ["主角试探小晴"],
  informationFlow: { reveal: [], hide: [], mislead: [], foreshadow: [] },
  finalHook: "门外出现第二个人影",
  freeSpace: ["环境细节可自由补足"],
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
    runChapterExecutionContractBuild: vi.fn(async () => executionContract),
    runChapterExecutionReportCheck: vi.fn(async () => ({
      status: "pass" as const,
      sceneResults: [{ id: "S1", passed: true, missing: [], evidence: "已进入旧屋", repairInstruction: "" }],
      mustDoResults: [],
      mustAvoidResults: [],
      finalHookPassed: true,
      repairItems: [],
    })),
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

function createLegacyPlanComplianceDeps(reviewResults: NovelReviewResult[] = []): DeepChapterGenerationDeps {
  return {
    ...createDeps(reviewResults),
    runChapterExecutionContractBuild: vi.fn(async () => createEmptyContract()),
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
    expect(planningPrompt).not.toContain("用户已确认的章节计划")
    expect(planningPrompt).toContain("章节节奏曲线")
    expect(planningPrompt).toContain("对话目标")
    expect(planningPrompt).toContain("爽点/期待点")
    expect(draftPrompt).toContain("不要写成说明文")
    expect(draftPrompt).toContain("动作、对话、场景细节、人物反应")
    expect(draftPrompt).toContain("开头")
    expect(draftPrompt).toContain("结尾")
  })

  it("injects the confirmed chapter plan into the brief prompt as an execution summary", () => {
    const plan = "维度四·场景序列编排：1. 雨夜旧屋揭示线索 2. 屋外脚步声悬念收束"
    const promptWithPlan = buildDeepChapterBriefPrompt(
      "",
      "上下文包内容",
      "生成第3章",
      3,
      undefined,
      undefined,
      plan,
    )
    const promptWithoutPlan = buildDeepChapterBriefPrompt("", "上下文包内容", "生成第3章", 3)

    expect(promptWithPlan).toContain("用户已确认的章节计划执行摘要")
    expect(promptWithPlan).toContain(plan)
    expect(promptWithPlan).toContain("逐条展开 S1/S2/S3")
    expect(promptWithPlan).toContain("不得合并、跳过或调换顺序")
    expect(promptWithPlan).toContain("不得推翻")
    expect(promptWithPlan).not.toContain("蓝图")
    expect(promptWithoutPlan).not.toContain("用户已确认的章节计划")
  })

  it("prefers the execution contract task brief over the old plan summary", () => {
    const taskBrief = contractToTaskBriefText(executionContract)
    const prompt = buildDeepChapterBriefPrompt(
      "",
      "上下文包内容",
      "生成第3章",
      3,
      undefined,
      undefined,
      "旧计划摘要",
      taskBrief,
    )

    expect(prompt).toContain("用户确认计划的执行清单")
    expect(prompt).toContain("以下执行清单是本阶段写作任务书的权威依据")
    expect(prompt).toContain("S1：旧屋门口")
    expect(prompt).toContain("必须完成：出现门缝声承接；主角进入旧屋")
    expect(prompt).toContain("不得重新设计剧情")
    expect(prompt).not.toContain("用户已确认的章节计划执行摘要")
  })

  it("generates an execution contract from confirmed plan and uses it for task brief", async () => {
    const deps = {
      ...createDeps(),
      runChapterExecutionContractBuild: vi.fn(async () => executionContract),
      runChapterPlanComplianceCheck: vi.fn(async () => "履约度：基本符合"),
    }

    await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "生成第3章",
        chapterNumber: 3,
        llmConfig,
        planBlueprint: "## 本章策划案\nS1：旧屋门口\n- 输出结果：主角进入旧屋。",
      },
      {},
      deps,
    )

    expect(deps.runChapterExecutionContractBuild).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining("## 本章策划案"),
      undefined,
    )
    const streamPrompts = vi.mocked(deps.streamChat).mock.calls.map((call) => messagesPromptText(call[1]))
    expect(streamPrompts.join("\n")).toContain("用户确认计划的执行清单")
    expect(streamPrompts.join("\n")).toContain("S1：旧屋门口")
  })

  it("falls back to local execution contract parsing when contract generation fails", async () => {
    const deps = {
      ...createDeps(),
      runChapterExecutionContractBuild: vi.fn(async () => {
        throw new Error("contract failed")
      }),
      runChapterPlanComplianceCheck: vi.fn(async () => "履约度：基本符合"),
    }

    const result = await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "生成第3章",
        chapterNumber: 3,
        llmConfig,
        planBlueprint: "## 本章策划案\nS1：旧屋门口\n- 输出结果：主角进入旧屋。\n- 验收标准：主角进入旧屋。",
      },
      {},
      deps,
    )

    expect(result.finalContent).toContain("最终去AI味正文")
    const streamPrompts = vi.mocked(deps.streamChat).mock.calls.map((call) => messagesPromptText(call[1]))
    expect(streamPrompts.join("\n")).toContain("用户确认计划的执行清单")
    expect(streamPrompts.join("\n")).toContain("完成后状态：主角进入旧屋。")
  })

  it("uses execution report repair items for targeted plan repair", async () => {
    const repairedContent = chapterText("执行报告返修后正文", 3000)
    const deps = {
      ...createDeps(),
      runChapterExecutionContractBuild: vi.fn(async () => executionContract),
      runChapterExecutionReportCheck: vi.fn(async () => ({
        status: "fail" as const,
        sceneResults: [{
          id: "S1",
          passed: false,
          missing: ["主角进入旧屋"],
          evidence: "正文停在门外。",
          repairInstruction: "补写主角进入旧屋。",
        }],
        mustDoResults: [],
        mustAvoidResults: [],
        finalHookPassed: true,
        repairItems: ["S1 缺少主角进入旧屋"],
      })),
      runChapterPlanComplianceCheck: vi.fn(async () => "不应调用旧履约检查"),
      runChapterPlanDeviationRepair: vi.fn(async (_config, _plan, _content, compliance) => {
        expect(String(compliance)).toContain("S1 缺少主角进入旧屋")
        return repairedContent
      }),
    }

    const result = await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "生成第3章",
        chapterNumber: 3,
        llmConfig,
        planBlueprint: "## 本章策划案\nS1：旧屋门口\n- 输出结果：主角进入旧屋。",
      },
      {},
      deps,
    )

    expect(result.finalContent).toBe(repairedContent)
    expect(result.executionReport).toContain("执行状态：已返修")
    expect(result.planCompliance).toBe("")
    expect(deps.runChapterPlanComplianceCheck).not.toHaveBeenCalled()
  })

  it("emits the execution report as a visible activity result", async () => {
    const activityEvents: AgentActivityEvent[] = []
    const deps = {
      ...createDeps(),
      runChapterExecutionContractBuild: vi.fn(async () => executionContract),
      runChapterExecutionReportCheck: vi.fn(async () => ({
        status: "warning" as const,
        sceneResults: [
          { id: "S1", passed: true, missing: [], evidence: "已进入旧屋", repairInstruction: "" },
          { id: "S2", passed: false, missing: ["误导不足"], evidence: "", repairInstruction: "补误导" },
        ],
        mustDoResults: [],
        mustAvoidResults: [],
        finalHookPassed: true,
        repairItems: [],
      })),
      runChapterPlanDeviationRepair: vi.fn(async () => chapterText("执行报告可见性返修后正文", 3000)),
      runChapterPlanComplianceCheck: vi.fn(async () => "履约度：基本符合"),
    }

    const result = await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "生成第3章",
        chapterNumber: 3,
        llmConfig,
        planBlueprint: "## 本章策划案\nS1：旧屋门口\n- 输出结果：主角进入旧屋。",
      },
      { onActivityEvent: (event) => activityEvents.push(event) },
      deps,
    )

    const reportEvent = activityEvents.find((event) => event.stageId === "execution_report")
    expect(reportEvent?.title).toBe("执行报告")
    expect(reportEvent?.content).toContain("执行状态：有警告")
    expect(reportEvent?.content).toContain("完成场景：S1")
    expect(reportEvent?.content).toContain("待处理偏离项：补误导")
    expect(result.planCompliance).toBe("")
    expect(deps.runChapterPlanComplianceCheck).not.toHaveBeenCalled()
    expect(activityEvents.some((event) => event.stageId === "plan_compliance")).toBe(false)
  })

  it("rechecks the execution report after accepted targeted repair", async () => {
    const repairedContent = chapterText("执行报告返修后正文", 3000)
    const activityEvents: AgentActivityEvent[] = []
    const deps = {
      ...createDeps(),
      runChapterExecutionContractBuild: vi.fn(async () => executionContract),
      runChapterExecutionReportCheck: vi
        .fn()
        .mockResolvedValueOnce({
          status: "fail" as const,
          sceneResults: [{
            id: "S1",
            passed: false,
            missing: ["主角进入旧屋"],
            evidence: "正文停在门外。",
            repairInstruction: "补写主角进入旧屋。",
          }],
          mustDoResults: [],
          mustAvoidResults: [],
          finalHookPassed: true,
          repairItems: ["S1 缺少主角进入旧屋"],
        })
        .mockResolvedValueOnce({
          status: "pass" as const,
          sceneResults: [{ id: "S1", passed: true, missing: [], evidence: "返修后已进入旧屋。", repairInstruction: "" }],
          mustDoResults: [],
          mustAvoidResults: [],
          finalHookPassed: true,
          repairItems: [],
        }),
      runChapterPlanDeviationRepair: vi.fn(async () => repairedContent),
      runChapterPlanComplianceCheck: vi.fn(async () => "履约度：基本符合"),
    }

    const result = await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "生成第3章",
        chapterNumber: 3,
        llmConfig,
        planBlueprint: "## 本章策划案\nS1：旧屋门口\n- 输出结果：主角进入旧屋。",
      },
      { onActivityEvent: (event) => activityEvents.push(event) },
      deps,
    )

    expect(deps.runChapterExecutionReportCheck).toHaveBeenCalledTimes(2)
    expect(deps.runChapterExecutionReportCheck).toHaveBeenLastCalledWith(
      expect.any(Object),
      executionContract,
      repairedContent,
      undefined,
    )
    expect(result.executionReport).toContain("执行状态：已返修")
    expect(result.executionReport).toContain("完成场景：S1")
    expect(result.executionReport).toContain("待处理偏离项：无")
    expect(result.planCompliance).toBe("")
    expect(deps.runChapterPlanComplianceCheck).not.toHaveBeenCalled()
    expect(activityEvents.some((event) => event.stageId === "execution_recheck" && event.content.includes("执行状态：已返修"))).toBe(true)
    expect(activityEvents.some((event) => event.stageId === "plan_compliance")).toBe(false)
  })

  it("keeps final content when execution report generation fails", async () => {
    const deps = {
      ...createDeps(),
      runChapterExecutionContractBuild: vi.fn(async () => executionContract),
      runChapterExecutionReportCheck: vi.fn(async () => {
        throw new Error("report failed")
      }),
      runChapterPlanComplianceCheck: vi.fn(async () => "不应调用旧履约检查"),
    }

    const result = await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "生成第3章",
        chapterNumber: 3,
        llmConfig,
        planBlueprint: "## 本章策划案\nS1：旧屋门口\n- 输出结果：主角进入旧屋。",
      },
      {},
      deps,
    )

    expect(result.finalContent).toContain("最终去AI味正文")
    expect(result.executionReport).toContain("执行报告生成失败")
    expect(result.planCompliance).toBe("")
    expect(deps.runChapterPlanComplianceCheck).not.toHaveBeenCalled()
  })

  it("runs a final plan compliance check with the compact execution summary when a confirmed plan is provided", async () => {
    const deps = {
      ...createLegacyPlanComplianceDeps(),
      runChapterPlanComplianceCheck: vi.fn(async (
        _config: LlmConfig,
        _plan: string,
        _content: string,
        _signal?: AbortSignal,
      ) => "履约度：基本符合"),
    }
    const events: Array<{ name: string; result?: string }> = []
    const fullPlan = [
      Array.from({ length: 80 }, (_, index) => `普通说明 ${index}：这行只是解释计划来源，不是执行约束。`).join("\n"),
      "维度四·场景序列编排：旧屋揭示，章末脚步声钩子。",
      "维度六·伏笔与边界禁忌：推进锈钥匙，不提前揭露旧屋主人。",
      "维度七·节奏、字数与结尾钩子：结尾停在门外第二个人影。",
    ].join("\n")

    const result = await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "生成第3章",
        chapterNumber: 3,
        llmConfig,
        planBlueprint: fullPlan,
      },
      { onWorkflowEvent: (event) => events.push(event) },
      deps,
    )

    const compliancePlanArg = vi.mocked(deps.runChapterPlanComplianceCheck).mock.calls[0]?.[1] ?? ""
    expect(deps.runChapterPlanComplianceCheck).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining("用户已确认的章节计划执行摘要"),
      expect.stringContaining("最终去AI味正文"),
      undefined,
    )
    expect(compliancePlanArg.length).toBeLessThan(fullPlan.length)
    expect(compliancePlanArg).toContain("旧屋揭示")
    expect(compliancePlanArg).toContain("锈钥匙")
    expect(result.planCompliance).toBe("履约度：基本符合")
    expect(events.some((event) => event.name === "chapter_plan_compliance")).toBe(true)
  })

  it("publishes final content before waiting for blueprint compliance", async () => {
    const order: string[] = []
    const deps = {
      ...createLegacyPlanComplianceDeps(),
      runChapterPlanComplianceCheck: vi.fn(async () => {
        order.push("compliance-start")
        await Promise.resolve()
        order.push("compliance-end")
        return "履约度：基本符合"
      }),
    }

    await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "生成第3章",
        chapterNumber: 3,
        llmConfig,
        planBlueprint: "确认计划：旧屋揭示，章末脚步声钩子。",
      },
      { onFinalContent: () => order.push("final-content") },
      deps,
    )

    expect(order).toEqual(["final-content", "compliance-start", "compliance-end"])
  })

  it("forwards the stop signal into plan compliance", async () => {
    const deps = {
      ...createLegacyPlanComplianceDeps(),
      runChapterPlanComplianceCheck: vi.fn(async () => "履约度：基本符合"),
    }
    const controller = new AbortController()

    await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "生成第3章",
        chapterNumber: 3,
        llmConfig,
        planBlueprint: "确认计划：旧屋揭示，章末脚步声钩子。",
      },
      {},
      deps,
      controller.signal,
    )

    expect(deps.runChapterPlanComplianceCheck).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining("确认计划：旧屋揭示，章末脚步声钩子。"),
      expect.stringContaining("最终去AI味正文"),
      controller.signal,
    )
  })

  it("repairs final content once when plan compliance finds actionable deviations", async () => {
    const repairedContent = chapterText("计划偏离返修后正文", 3000)
    const finalContents: string[] = []
    const activityEvents: AgentActivityEvent[] = []
    const deps = {
      ...createLegacyPlanComplianceDeps(),
      runChapterPlanComplianceCheck: vi.fn(async () => JSON.stringify({
        status: "partial_deviation",
        summary: "结尾钩子缺失。",
        deviations: [{
          point: "章末钩子",
          evidence: "正文没有门外第二个人影。",
          suggestion: "只在结尾补入门外第二个人影，导向下一章。",
        }],
      })),
      runChapterPlanDeviationRepair: vi.fn(async (
        _config: LlmConfig,
        plan: string,
        content: string,
        compliance: unknown,
        _signal?: AbortSignal,
      ) => {
        expect(plan).toContain("用户已确认的章节计划执行摘要")
        expect(content).toContain("最终去AI味正文")
        expect(String(compliance)).toContain("章末钩子")
        return repairedContent
      }),
    }

    const result = await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "生成第3章",
        chapterNumber: 3,
        llmConfig,
        planBlueprint: "确认计划：旧屋揭示，章末必须出现门外第二个人影。",
      },
      {
        onFinalContent: (content) => finalContents.push(content),
        onActivityEvent: (event) => activityEvents.push(event),
      },
      deps,
    )

    expect(deps.runChapterPlanDeviationRepair).toHaveBeenCalledOnce()
    expect(result.finalContent).toBe(repairedContent)
    expect(result.revised).toBe(true)
    expect(result.planCompliance).toContain("计划偏离点返修：已完成")
    expect(result.planCompliance).not.toContain("partial_deviation")
    expect(finalContents[0]).toContain("最终去AI味正文")
    expect(finalContents[finalContents.length - 1]).toBe(repairedContent)
    const complianceEvent = activityEvents.find((event) => event.stageId === "plan_compliance")
    expect(complianceEvent?.content).toContain("履约状态：部分偏离")
    expect(complianceEvent?.content).toContain("偏离点数量：1")
    expect(complianceEvent?.content).toContain("处理决定：触发轻量返修")
    expect(complianceEvent?.content).toContain("章末钩子")
    const repairEvent = activityEvents.find((event) => event.stageId === "plan_deviation_repair")
    expect(repairEvent?.content).toContain("正文已更新")
    expect(repairEvent?.content).toContain("返修前")
    expect(repairEvent?.content).toContain("返修后")
  })

  it("does not repair final content when plan compliance is mostly compliant", async () => {
    const activityEvents: AgentActivityEvent[] = []
    const deps = {
      ...createLegacyPlanComplianceDeps(),
      runChapterPlanComplianceCheck: vi.fn(async () => "履约度：基本符合"),
      runChapterPlanDeviationRepair: vi.fn(async () => chapterText("不应出现的返修正文", 3000)),
    }

    const result = await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "生成第3章",
        chapterNumber: 3,
        llmConfig,
        planBlueprint: "确认计划：旧屋揭示，章末脚步声钩子。",
      },
      { onActivityEvent: (event) => activityEvents.push(event) },
      deps,
    )

    expect(deps.runChapterPlanDeviationRepair).not.toHaveBeenCalled()
    expect(result.finalContent).toContain("最终去AI味正文")
    const complianceEvent = activityEvents.find((event) => event.stageId === "plan_compliance")
    expect(complianceEvent?.content).toContain("履约状态：基本符合")
    expect(complianceEvent?.content).toContain("处理决定：无需返修")
  })

  it("keeps the original final content when plan deviation repair returns abnormal content", async () => {
    const finalContents: string[] = []
    const activityEvents: AgentActivityEvent[] = []
    const deps = {
      ...createLegacyPlanComplianceDeps(),
      runChapterPlanComplianceCheck: vi.fn(async () => JSON.stringify({
        status: "clear_deviation",
        summary: "章末钩子缺失。",
        deviations: [{
          point: "章末钩子",
          evidence: "正文没有门外第二个人影。",
          suggestion: "只在结尾补入门外第二个人影。",
        }],
      })),
      runChapterPlanDeviationRepair: vi.fn(async () => "短正文"),
    }

    const result = await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "生成第3章",
        chapterNumber: 3,
        llmConfig,
        planBlueprint: "确认计划：旧屋揭示，章末必须出现门外第二个人影。",
      },
      {
        onFinalContent: (content) => finalContents.push(content),
        onActivityEvent: (event) => activityEvents.push(event),
      },
      deps,
    )

    expect(deps.runChapterPlanDeviationRepair).toHaveBeenCalledOnce()
    expect(result.finalContent).toContain("最终去AI味正文")
    expect(result.finalContent).not.toBe("短正文")
    expect(finalContents).toHaveLength(1)
    const repairEvent = activityEvents.find((event) => event.stageId === "plan_deviation_repair")
    expect(repairEvent?.content).toContain("返修结果异常，已保留原正文")
    expect(repairEvent?.content).toContain("原因：返修后正文明显变短")
  })

  it("keeps the original final content when plan deviation repair becomes too long", async () => {
    const activityEvents: AgentActivityEvent[] = []
    const deps = {
      ...createLegacyPlanComplianceDeps(),
      runChapterPlanComplianceCheck: vi.fn(async () => JSON.stringify({
        status: "partial_deviation",
        summary: "缺少一个结尾动作。",
        deviations: [{ point: "结尾动作", evidence: "未出现人影。", suggestion: "补入人影。" }],
      })),
      runChapterPlanDeviationRepair: vi.fn(async () => chapterText("返修异常长正文", 5200)),
    }

    const result = await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "生成第3章",
        chapterNumber: 3,
        llmConfig,
        planBlueprint: "确认计划：旧屋揭示，章末必须出现门外第二个人影。",
      },
      { onActivityEvent: (event) => activityEvents.push(event) },
      deps,
    )

    expect(result.finalContent).toContain("最终去AI味正文")
    const repairEvent = activityEvents.find((event) => event.stageId === "plan_deviation_repair")
    expect(repairEvent?.content).toContain("原因：返修后正文明显变长")
  })

  it("keeps the original final content when plan deviation repair drops the original main content", async () => {
    const activityEvents: AgentActivityEvent[] = []
    const unrelatedRepair = Array.from({ length: 90 }, (_, index) =>
      `全新段落${index}：这里改写成完全不同的事件、地点、人物和线索，绕开旧屋、钥匙、脚步声。`,
    ).join("\n")
    const deps = {
      ...createLegacyPlanComplianceDeps(),
      runChapterPlanComplianceCheck: vi.fn(async () => JSON.stringify({
        status: "partial_deviation",
        summary: "缺少一个结尾动作。",
        deviations: [{ point: "结尾动作", evidence: "未出现人影。", suggestion: "补入人影。" }],
      })),
      runChapterPlanDeviationRepair: vi.fn(async () => unrelatedRepair),
    }

    const result = await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "生成第3章",
        chapterNumber: 3,
        llmConfig,
        planBlueprint: "确认计划：旧屋揭示，章末必须出现门外第二个人影。",
      },
      { onActivityEvent: (event) => activityEvents.push(event) },
      deps,
    )

    expect(result.finalContent).toContain("最终去AI味正文")
    const repairEvent = activityEvents.find((event) => event.stageId === "plan_deviation_repair")
    expect(repairEvent?.content).toContain("原因：返修后未保留原正文主要内容")
  })

  it("explains why unknown plan compliance results do not trigger repair", async () => {
    const activityEvents: AgentActivityEvent[] = []
    const deps = {
      ...createLegacyPlanComplianceDeps(),
      runChapterPlanComplianceCheck: vi.fn(async () => "模型输出混乱，未给出履约度。"),
      runChapterPlanDeviationRepair: vi.fn(async () => chapterText("不应出现的返修正文", 3000)),
    }

    await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "生成第3章",
        chapterNumber: 3,
        llmConfig,
        planBlueprint: "确认计划：旧屋揭示，章末脚步声钩子。",
      },
      { onActivityEvent: (event) => activityEvents.push(event) },
      deps,
    )

    expect(deps.runChapterPlanDeviationRepair).not.toHaveBeenCalled()
    const complianceEvent = activityEvents.find((event) => event.stageId === "plan_compliance")
    expect(complianceEvent?.content).toContain("履约状态：未知")
    expect(complianceEvent?.content).toContain("处理决定：未触发返修")
    expect(complianceEvent?.content).toContain("原因：模型未按结构返回，已避免误改正文")
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

  it("uses separate workflow routes for fast standard and strict modes", async () => {
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

  it("keeps workflow visibility aligned with the selected mode route", async () => {
    const fastEvents: Array<{ name: string; result?: string }> = []
    await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第三章", chapterNumber: 3, llmConfig, aiWorkflowMode: "fast" },
      { onWorkflowEvent: (event) => fastEvents.push(event) },
      createDeps(),
    )
    expect(fastEvents.some((event) => event.name === "chapter_review")).toBe(false)
    expect(fastEvents.some((event) => event.name === "chapter_final_polish")).toBe(false)
    expect(fastEvents.find((event) => event.name === "chapter_complete")?.result).toContain("快速模式写作完成")

    const standardEvents: Array<{ name: string; result?: string }> = []
    await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "生成第三章", chapterNumber: 3, llmConfig, aiWorkflowMode: "standard" },
      { onWorkflowEvent: (event) => standardEvents.push(event) },
      createDeps(),
    )
    expect(standardEvents.find((event) => event.name === "chapter_review")?.result).toContain("标准模式跳过")
    expect(standardEvents.find((event) => event.name === "chapter_final_polish" && event.result)?.result).toContain("简单审查与去AI味完成")
  })

  it("keeps fast mode on a lightweight route without post-draft plan audits", async () => {
    const deps = {
      ...createDeps(),
      runChapterExecutionContractBuild: vi.fn(async () => executionContract),
      runChapterExecutionReportCheck: vi.fn(async () => ({
        status: "fail" as const,
        sceneResults: [{
          id: "S1",
          passed: false,
          missing: ["主角进入旧屋"],
          evidence: "正文停在门外。",
          repairInstruction: "补写主角进入旧屋。",
        }],
        mustDoResults: [],
        mustAvoidResults: [],
        finalHookPassed: true,
        repairItems: ["S1 缺少主角进入旧屋"],
      })),
      runChapterPlanComplianceCheck: vi.fn(async () => "履约度：偏离"),
      runChapterPlanDeviationRepair: vi.fn(async () => chapterText("不应出现的返修正文", 3000)),
    }
    const events: Array<{ name: string; title: string; result?: string }> = []

    const result = await runDeepChapterGeneration(
      {
        projectPath: "E:/Novel",
        userRequest: "生成第三章",
        chapterNumber: 3,
        llmConfig,
        aiWorkflowMode: "fast",
        planBlueprint: "## 本章策划案\nS1：旧屋门口\n- 输出结果：主角进入旧屋。",
      },
      { onWorkflowEvent: (event) => events.push(event) },
      deps,
    )

    expect(deps.runChapterExecutionContractBuild).not.toHaveBeenCalled()
    expect(deps.runChapterExecutionReportCheck).not.toHaveBeenCalled()
    expect(deps.runChapterPlanComplianceCheck).not.toHaveBeenCalled()
    expect(deps.runChapterPlanDeviationRepair).not.toHaveBeenCalled()
    expect(result.planCompliance).toBe("")
    expect(result.executionReport).toBe("")
    expect(events.some((event) => event.name === "chapter_execution_report")).toBe(false)
    expect(events.some((event) => event.name === "chapter_plan_compliance")).toBe(false)
    const completeEvent = events.find((event) => event.name === "chapter_complete")
    expect(completeEvent?.title).toBe("完成快速写作")
    expect(completeEvent?.result).toContain("快速模式写作完成")
    expect(completeEvent?.result).not.toContain("多任务写作循环")
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
