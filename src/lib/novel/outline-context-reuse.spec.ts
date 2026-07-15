import { describe, expect, it } from "vitest"
import {
  buildOutlineContextSummary,
  estimateOutlineContextBudget,
  OUTLINE_CONTEXT_REUSE_DISABLED_TOOLS,
  planOutlineAgentHistory,
  planOutlineContextReuse,
} from "./outline-context-reuse"

describe("AI 大纲上下文复用策略", () => {
  it("首次生成时刷新上下文并保留读取工具", () => {
    const decision = planOutlineContextReuse({
      hasPriorAssistantAnswer: false,
      attachedReferenceCount: 0,
      inputText: "生成一本玄幻小说大纲",
      enableMultiAgent: true,
    })

    expect(decision.mode).toBe("refresh")
    expect(decision.disabledTools).toEqual([])
    expect(decision.sourceLabel).toContain("本轮将读取")
  })

  it("后续普通追问时复用已有上下文并禁用资料读取工具", () => {
    const decision = planOutlineContextReuse({
      hasPriorAssistantAnswer: true,
      attachedReferenceCount: 0,
      inputText: "继续把刚才的主角动机说清楚",
      enableMultiAgent: false,
    })

    expect(decision.mode).toBe("reuse")
    expect(decision.disabledTools).toEqual(OUTLINE_CONTEXT_REUSE_DISABLED_TOOLS)
    expect(decision.instruction).toContain("不要重新读取项目资料")
    expect(decision.sourceLabel).toContain("已复用上次上下文")
  })

  it("后续追问带引用或明确要求读取时刷新上下文", () => {
    expect(planOutlineContextReuse({
      hasPriorAssistantAnswer: true,
      attachedReferenceCount: 1,
      inputText: "结合这个章纲继续分析",
      enableMultiAgent: false,
    }).mode).toBe("refresh")

    expect(planOutlineContextReuse({
      hasPriorAssistantAnswer: true,
      attachedReferenceCount: 0,
      inputText: "重新读取大纲文件后再分析",
      enableMultiAgent: false,
    }).mode).toBe("refresh")
  })

  it("用户手动强制刷新时刷新上下文并说明来源", () => {
    const decision = planOutlineContextReuse({
      hasPriorAssistantAnswer: true,
      attachedReferenceCount: 0,
      inputText: "继续优化主角动机",
      enableMultiAgent: false,
      forceRefresh: true,
    })

    expect(decision.mode).toBe("refresh")
    expect(decision.reason).toContain("用户手动要求")
    expect(decision.sourceLabel).toContain("强制刷新")
  })

  it("复用模式下裁剪长历史，只保留首轮目标、最近结论和最近对话", () => {
    const history = [
      { role: "user" as const, content: "我要写一本男频玄幻长篇，核心是废材逆袭。" },
      { role: "assistant" as const, content: "完整大纲：" + "世界观设定。".repeat(120) },
      { role: "user" as const, content: "继续补充主角。" },
      { role: "assistant" as const, content: "主角设定：" + "动机与成长。".repeat(120) },
      { role: "user" as const, content: "继续补反派。" },
      { role: "assistant" as const, content: "反派设定：" + "压迫与冲突。".repeat(120) },
      { role: "user" as const, content: "刚才那版动机再清楚一点。" },
      { role: "assistant" as const, content: "最新结论：" + "动机来自家族危机。".repeat(80) },
    ]

    const plan = planOutlineAgentHistory({
      history,
      contextDecision: planOutlineContextReuse({
        hasPriorAssistantAnswer: true,
        attachedReferenceCount: 0,
        inputText: "继续优化主角动机",
        enableMultiAgent: false,
      }),
    })

    expect(plan.level).toBe("high")
    expect(plan.messages[0]).toEqual(history[0])
    expect(plan.messages.length).toBeLessThan(history.length)
    expect(plan.messages[plan.messages.length - 1]?.content).toContain("最新结论")
    expect(plan.instruction).toContain("已压缩历史上下文")
  })

  it("复用长历史时优先注入摘要缓存", () => {
    const history = [
      { role: "user" as const, content: "我要写一本女频仙侠短篇。" },
      { role: "assistant" as const, content: "设定：" + "师门、禁术、情感拉扯。".repeat(100) },
      { role: "user" as const, content: "继续补反派。" },
      { role: "assistant" as const, content: "反派：" + "旧情、权力、背叛。".repeat(100) },
    ]
    const summary = buildOutlineContextSummary(history)

    const plan = planOutlineAgentHistory({
      history,
      contextDecision: planOutlineContextReuse({
        hasPriorAssistantAnswer: true,
        attachedReferenceCount: 0,
        inputText: "继续",
        enableMultiAgent: false,
      }),
      cachedSummary: summary,
    })

    expect(summary).toContain("上下文摘要缓存")
    expect(plan.messages[0].role).toBe("assistant")
    expect(plan.messages[0].content).toContain("上下文摘要缓存")
    expect(plan.sources).toContain("摘要: 已复用上下文摘要缓存")
  })

  it("摘要已在系统上下文时不重复注入摘要消息", () => {
    const history = [
      { role: "user" as const, content: "初始目标" },
      { role: "assistant" as const, content: "初始结论" },
      { role: "user" as const, content: "最近问题" },
      { role: "assistant" as const, content: "最近回答" },
    ]
    const plan = planOutlineAgentHistory({
      history,
      contextDecision: planOutlineContextReuse({
        hasPriorAssistantAnswer: true,
        attachedReferenceCount: 0,
        inputText: "继续",
      }),
      cachedSummary: "系统中的会话摘要",
      summaryInSystem: true,
    })

    expect(plan.messages).toEqual(history.slice(-2))
    expect(plan.messages.some((message) => message.content === "系统中的会话摘要")).toBe(false)
  })

  it("估算上下文预算并计算压缩节省", () => {
    const original = [
      { role: "user" as const, content: "生成大纲" + "需求".repeat(500) },
      { role: "assistant" as const, content: "大纲" + "内容".repeat(1000) },
    ]
    const planned = [
      { role: "assistant" as const, content: "上下文摘要缓存：保留核心需求。" },
    ]

    const budget = estimateOutlineContextBudget({ original, planned })

    expect(budget.originalTokens).toBeGreaterThan(budget.plannedTokens)
    expect(budget.savedTokens).toBeGreaterThan(0)
    expect(budget.label).toContain("预计节省")
  })

  it("按中文、英文单词和标点分层估算 token", () => {
    const chinese = estimateOutlineContextBudget({
      original: [{ role: "user" as const, content: "主角进入宗门，发现师尊隐瞒禁术真相。" }],
      planned: [],
    })
    const english = estimateOutlineContextBudget({
      original: [{ role: "user" as const, content: "The protagonist enters the sect and finds the hidden truth." }],
      planned: [],
    })
    const punctuation = estimateOutlineContextBudget({
      original: [{ role: "user" as const, content: "！！！？？？......" }],
      planned: [],
    })

    expect(chinese.originalTokens).toBeGreaterThan(english.originalTokens)
    expect(punctuation.originalTokens).toBeGreaterThan(0)
  })

  it("刷新模式保留完整历史并允许显示工具过程", () => {
    const history = [
      { role: "user" as const, content: "生成大纲" },
      { role: "assistant" as const, content: "大纲结果" },
    ]
    const plan = planOutlineAgentHistory({
      history,
      contextDecision: planOutlineContextReuse({
        hasPriorAssistantAnswer: true,
        attachedReferenceCount: 1,
        inputText: "重新读取这个章纲",
        enableMultiAgent: false,
      }),
    })

    expect(plan.level).toBe("low")
    expect(plan.messages).toEqual(history)
    expect(plan.showToolProcess).toBe(true)
  })

  it("复用模式隐藏重复工具过程但保留错误过程", () => {
    const plan = planOutlineAgentHistory({
      history: [
        { role: "user" as const, content: "生成大纲" },
        { role: "assistant" as const, content: "大纲结果" },
      ],
      contextDecision: planOutlineContextReuse({
        hasPriorAssistantAnswer: true,
        attachedReferenceCount: 0,
        inputText: "继续优化",
        enableMultiAgent: false,
      }),
    })

    expect(plan.showToolProcess).toBe(false)
    expect(plan.showToolProcessOnError).toBe(true)
    expect(plan.sources).toContain("过程: 已隐藏重复工具过程")
  })

  it("systemGenerated 标记跳过关键词检测，避免系统 prompt 触发刷新", () => {
    // 系统生成的 prompt 包含"读取资料"关键词，但不应触发刷新
    const decision = planOutlineContextReuse({
      hasPriorAssistantAnswer: true,
      attachedReferenceCount: 0,
      inputText: "3. 读取资料。4. 提取关键内容。5. 生成大纲。",
      enableMultiAgent: false,
      systemGenerated: true,
    })

    expect(decision.mode).toBe("reuse")
    expect(decision.disabledTools).toEqual(OUTLINE_CONTEXT_REUSE_DISABLED_TOOLS)
  })

  it("用户手动输入包含读取关键词时仍触发刷新（systemGenerated 为 false）", () => {
    const decision = planOutlineContextReuse({
      hasPriorAssistantAnswer: true,
      attachedReferenceCount: 0,
      inputText: "读取资料后重新分析",
      enableMultiAgent: false,
      systemGenerated: false,
    })

    expect(decision.mode).toBe("refresh")
  })

  it("systemGenerated 为 undefined 时保持原有行为（关键词检测生效）", () => {
    const decision = planOutlineContextReuse({
      hasPriorAssistantAnswer: true,
      attachedReferenceCount: 0,
      inputText: "读取资料后重新分析",
      enableMultiAgent: false,
    })

    expect(decision.mode).toBe("refresh")
  })
})
