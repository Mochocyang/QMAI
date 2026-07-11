import { describe, expect, it } from "vitest"
import {
  planOutlineSubAgents,
  runOutlineMultiAgentWorkflow,
  type OutlineSubAgentPlan,
} from "./outline-multi-agent-orchestrator"

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
