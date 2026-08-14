import { describe, expect, it } from "vitest"
import {
  DEFAULT_OUTLINE_SUBAGENT_MERGE_MAX_CHARS,
  buildBoundedSubAgentMergePayload,
  planOutlineSubAgents,
  resumeOutlineMultiAgentWorkflow,
  runOutlineMultiAgentWorkflow,
  type OutlineSubAgentPlan,
} from "./outline-multi-agent-orchestrator"
import type { OutlineSubAgentResult } from "./outline-result-protocol"

const baseSkillNames = [
  "outline-master-builder",
  "male-xuanhuan-xianxia",
  "character-design",
  "world-rules",
  "foreshadowing-suspense",
]

describe("AI大纲多 Agent 编排器", () => {
  it("根据 SkillHub Skill 名称生成子 Agent 计划", () => {
    const plan = planOutlineSubAgents({
      preferredSkillNames: baseSkillNames,
      taskPrompt: "生成男频玄幻长篇大纲",
      maxConcurrency: 3,
    })

    expect(plan.map((item) => item.kind)).toEqual([
      "outline",
      "topic",
      "character",
      "setting",
      "foreshadowing",
    ])
    expect(plan.find((item) => item.kind === "topic")?.skillNames).toContain("male-xuanhuan-xianxia")
    expect(plan.every((item) => item.writeToolsEnabled === false)).toBe(true)
  })

  it("限制最大并发并保留成功子 Agent 输出", async () => {
    const started: string[] = []
    const finished: string[] = []
    const plan: OutlineSubAgentPlan[] = [
      makePlan("outline"),
      makePlan("topic"),
      makePlan("character"),
    ]

    const result = await runOutlineMultiAgentWorkflow({
      plan,
      maxConcurrency: 2,
      runSubAgent: async (item) => {
        started.push(item.id)
        await Promise.resolve()
        finished.push(item.id)
        return makeSubAgentJson(item.id, item.name)
      },
      runSingleAgentFallback: async () => "单 Agent 结果",
      mergeResults: async (items) => `合并：${items.map((item) => item.agentId).join("、")}`,
    })

    expect(started).toEqual(["outline-agent", "topic-agent", "character-agent"])
    expect(finished).toEqual(["outline-agent", "topic-agent", "character-agent"])
    expect(result.mode).toBe("multi-agent")
    expect(result.finalText).toBe("合并：outline-agent、topic-agent、character-agent")
  })

  it("单个子 Agent 失败时继续合并成功结果", async () => {
    const result = await runOutlineMultiAgentWorkflow({
      plan: [makePlan("outline"), makePlan("topic"), makePlan("character")],
      maxConcurrency: 3,
      runSubAgent: async (item) => {
        if (item.kind === "topic") throw new Error("题材失败")
        return makeSubAgentJson(item.id, item.name)
      },
      runSingleAgentFallback: async () => "单 Agent 结果",
      mergeResults: async (items) => `成功数量：${items.length}`,
    })

    expect(result.mode).toBe("multi-agent")
    expect(result.finalText).toBe("成功数量：2")
    expect(result.failedAgents).toEqual(["topic-agent"])
  })

  it("部分 Agent 失败时不整体降级，继续合并成功结果", async () => {
    const result = await runOutlineMultiAgentWorkflow({
      plan: [makePlan("outline"), makePlan("topic"), makePlan("character")],
      maxConcurrency: 3,
      runSubAgent: async (item) => {
        if (item.kind !== "outline") throw new Error("失败")
        return makeSubAgentJson(item.id, item.name)
      },
      runSingleAgentFallback: async () => "不应降级",
      mergeResults: async (items) => `成功数量：${items.length}`,
    })

    expect(result.mode).toBe("multi-agent")
    expect(result.finalText).toBe("成功数量：1")
    expect(result.failedAgents).toEqual(["topic-agent", "character-agent"])
    expect(result.failureDetails?.[0]).toContain("topic Agent")
    expect(result.failureDetails?.[0]).toContain("失败")
  })

  it("合并 Agent 失败时自动回退为单 Agent", async () => {
    const result = await runOutlineMultiAgentWorkflow({
      plan: [makePlan("outline"), makePlan("topic")],
      maxConcurrency: 2,
      runSubAgent: async (item) => makeSubAgentJson(item.id, item.name),
      runSingleAgentFallback: async () => "单 Agent 兜底结果",
      mergeResults: async () => {
        throw new Error("合并格式异常")
      },
    })

    expect(result.mode).toBe("single-agent-fallback")
    expect(result.finalText).toBe("单 Agent 兜底结果")
    expect(result.fallbackReason).toContain("合并 Agent 失败")
  })

  it("简单调整任务只使用一个 Agent", () => {
    const plan = planOutlineSubAgents({
      preferredSkillNames: baseSkillNames,
      taskPrompt: "把当前标题改短一些",
    })

    expect(plan).toHaveLength(1)
  })

  it("将成功依赖的结构化结论传给下游 Agent", async () => {
    const parent = { ...makePlan("outline"), id: "parent" }
    const child = { ...makePlan("character"), id: "child", dependencies: ["parent"] }
    let childPrompt = ""

    await runOutlineMultiAgentWorkflow({
      plan: [parent, child],
      maxConcurrency: 2,
      runSubAgent: async (item) => {
        if (item.id === "child") childPrompt = item.taskPrompt
        return makeSubAgentJson(item.id, item.name)
      },
      runSingleAgentFallback: async () => "fallback",
      mergeResults: async () => "merged",
    })

    expect(childPrompt).toContain("上游依赖结论")
    expect(childPrompt).toContain("完成")
  })

  it("续传失败 Agent 时复用已完成的上游依赖", async () => {
    const parent = { ...makePlan("outline"), id: "parent" }
    const child = { ...makePlan("character"), id: "child", dependencies: ["parent"] }
    const completedParent: OutlineSubAgentResult = {
      agentId: "parent",
      agentName: parent.name,
      stage: "outline",
      usedSkills: [],
      confidence: 0.9,
      summary: "上游大纲已经完成",
      contentMarkdown: "## 已完成的大纲",
      constraints: ["保持主线"],
      writebackItems: [],
      risks: [],
      questions: [],
    }
    let resumedPrompt = ""

    const result = await resumeOutlineMultiAgentWorkflow({
      plan: [parent, child],
      completedResults: [completedParent],
      failedAgentIds: ["child"],
      runSubAgent: async (item) => {
        resumedPrompt = item.taskPrompt
        return makeSubAgentJson(item.id, item.name)
      },
      mergeResults: async (items) => `合并数量：${items.length}`,
    })

    expect(resumedPrompt).toContain("上游大纲已经完成")
    expect(result.finalText).toBe("合并数量：2")
    expect(result.successfulAgents).toEqual(["parent", "child"])
  })

  it("合并载荷保留子 Agent 正文中段和写回项", () => {
    const results = Array.from({ length: 2 }, (_, index) => ({
      agentId: `a${index}`,
      agentName: `Agent ${index}`,
      stage: "planning",
      usedSkills: [],
      confidence: 0.8,
      summary: `总结 ${index}`,
      contentMarkdown: `开头 ${index}\n中间正文 ${index}\n结尾 ${index}`,
      constraints: ["保持一致"],
      writebackItems: [{
        type: "character",
        name: `角色${index}`,
        content: `角色正文 ${index}`,
        targetFolder: "人物小传",
      }],
      risks: ["存在冲突"],
      questions: ["是否保留这条线？"],
    }))

    const payload = buildBoundedSubAgentMergePayload(results)

    expect(payload).toContain("中间正文 0")
    expect(payload).toContain("中间正文 1")
    expect(payload).toContain("角色正文 0")
    expect(payload).toContain("待确认问题：是否保留这条线？")
    expect(payload).not.toContain("子 Agent 内容已压缩")
  })

  it("超出预算时整份丢弃靠后的 Agent，不砍中段", () => {
    const results = [
      {
        agentId: "a0",
        agentName: "Agent 0",
        stage: "planning",
        usedSkills: [],
        confidence: 0.8,
        summary: "总结 0",
        contentMarkdown: "开头 0\n中间正文 0\n结尾 0",
        constraints: [],
        writebackItems: [],
        risks: [],
        questions: [],
      },
      {
        agentId: "a1",
        agentName: "Agent 1",
        stage: "planning",
        usedSkills: [],
        confidence: 0.8,
        summary: "总结 1",
        contentMarkdown: "x".repeat(4000),
        constraints: [],
        writebackItems: [],
        risks: [],
        questions: [],
      },
    ]

    const payload = buildBoundedSubAgentMergePayload(results, 200)

    expect(payload).toContain("中间正文 0")
    expect(payload).not.toContain("Agent 1")
    expect(payload).not.toContain("子 Agent 内容已压缩")
  })

  it("默认上限下整份丢弃靠后的 Agent，不砍中段", () => {
    const results = [
      {
        agentId: "a0",
        agentName: "Agent 0",
        stage: "planning",
        usedSkills: [],
        confidence: 0.8,
        summary: "总结 0",
        contentMarkdown: "开头 0\n中间正文 0\n结尾 0",
        constraints: [],
        writebackItems: [],
        risks: [],
        questions: [],
      },
      {
        agentId: "a1",
        agentName: "Agent 1",
        stage: "planning",
        usedSkills: [],
        confidence: 0.8,
        summary: "总结 1",
        contentMarkdown: "x".repeat(DEFAULT_OUTLINE_SUBAGENT_MERGE_MAX_CHARS),
        constraints: [],
        writebackItems: [],
        risks: [],
        questions: [],
      },
    ]

    const payload = buildBoundedSubAgentMergePayload(results)

    expect(payload).toContain("中间正文 0")
    expect(payload).not.toContain("Agent 1")
    expect(payload.length).toBeLessThan(DEFAULT_OUTLINE_SUBAGENT_MERGE_MAX_CHARS)
  })
})

function makePlan(kind: OutlineSubAgentPlan["kind"]): OutlineSubAgentPlan {
  return {
    id: `${kind}-agent`,
    name: `${kind} Agent`,
    kind,
    skillNames: [kind],
    taskPrompt: `执行 ${kind}`,
    writeToolsEnabled: false,
  }
}

function makeSubAgentJson(agentId: string, agentName: string): string {
  return JSON.stringify({
    agent_id: agentId,
    agent_name: agentName,
    stage: "planning",
    used_skills: [agentId],
    confidence: 0.8,
    summary: "完成",
    content_markdown: `## ${agentName}`,
    constraints: [],
    writeback_items: [],
    risks: [],
    questions: [],
  })
}
