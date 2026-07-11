import { describe, expect, it, vi } from "vitest"
import {
  runOutlineMultiAgentWorkflow,
  validateOutlineSubAgentPlan,
  type OutlineSubAgentPlan,
} from "./outline-multi-agent-orchestrator"

function plan(
  id: string,
  dependencies: string[] = [],
  priority = 0,
): OutlineSubAgentPlan {
  return {
    id,
    name: `${id}中文名称`,
    kind: "outline",
    dimension: `${id}维度`,
    skillNames: [`${id}-skill`],
    taskPrompt: `执行${id}`,
    dependencies,
    priority,
    finalReview: false,
    writeToolsEnabled: false,
  }
}

function resultJson(item: OutlineSubAgentPlan): string {
  return JSON.stringify({
    agent_id: item.id,
    agent_name: item.name,
    stage: item.dimension,
    used_skills: item.skillNames,
    confidence: 0.8,
    summary: `${item.id}完成`,
    content_markdown: `## ${item.id}`,
    constraints: [],
    writeback_items: [],
    risks: [],
    questions: [],
  })
}

describe("动态大纲 Agent 任务图", () => {
  it("拒绝重复 ID、孤儿依赖、循环依赖和超过 12 个任务", () => {
    expect(validateOutlineSubAgentPlan([plan("a"), plan("a")]).ok).toBe(false)
    expect(validateOutlineSubAgentPlan([plan("a", ["missing"])]).ok).toBe(false)
    expect(validateOutlineSubAgentPlan([plan("a", ["b"]), plan("b", ["a"])]).ok).toBe(false)
    expect(validateOutlineSubAgentPlan(Array.from({ length: 13 }, (_, i) => plan(`a${i}`))).ok).toBe(false)
    expect(validateOutlineSubAgentPlan([plan("a"), plan("b", ["a"])]).ok).toBe(true)
  })

  it("最多并发 3 个，依赖结束后自动补位，并按规划顺序合并", async () => {
    const tasks = [plan("a"), plan("b"), plan("c"), plan("d", ["a"]), plan("e", ["b"])]
    let running = 0
    let peak = 0
    const releases = new Map<string, () => void>()
    const started: string[] = []

    const workflow = runOutlineMultiAgentWorkflow({
      plan: tasks,
      maxConcurrency: 3,
      runSubAgent: async (item) => {
        started.push(item.id)
        running += 1
        peak = Math.max(peak, running)
        await new Promise<void>((resolve) => releases.set(item.id, resolve))
        running -= 1
        return resultJson(item)
      },
      runSingleAgentFallback: async () => "不应降级",
      mergeResults: async (items) => items.map((item) => item.agentId).join(","),
    })

    await vi.waitFor(() => expect(started).toEqual(["a", "b", "c"]))
    releases.get("a")?.()
    await vi.waitFor(() => expect(started).toContain("d"))
    expect(started).not.toContain("e")
    releases.get("b")?.()
    await vi.waitFor(() => expect(started).toContain("e"))
    releases.get("c")?.()
    releases.get("d")?.()
    releases.get("e")?.()

    const output = await workflow
    expect(peak).toBe(3)
    expect(output.mode).toBe("multi-agent")
    expect(output.finalText).toBe("a,b,c,d,e")
  })

  it("失败自动重试一次；再次失败后下游携带缺失维度继续，部分失败不整体降级", async () => {
    const attempts = new Map<string, number>()
    const receivedPrompts = new Map<string, string>()

    const output = await runOutlineMultiAgentWorkflow({
      plan: [plan("source"), plan("downstream", ["source"])],
      runSubAgent: async (item) => {
        attempts.set(item.id, (attempts.get(item.id) ?? 0) + 1)
        receivedPrompts.set(item.id, item.taskPrompt)
        if (item.id === "source") throw new Error("上游持续失败")
        return resultJson(item)
      },
      runSingleAgentFallback: async () => "不应因部分失败降级",
      mergeResults: async (items) => items.map((item) => item.agentId).join(","),
    })

    expect(attempts.get("source")).toBe(2)
    expect(attempts.get("downstream")).toBe(1)
    expect(receivedPrompts.get("downstream")).toContain("source维度")
    expect(receivedPrompts.get("downstream")).toContain("上游持续失败")
    expect(output.mode).toBe("multi-agent")
    expect(output.finalText).toBe("downstream")
    expect(output.failedAgents).toEqual(["source"])
  })

  it("没有任何成功结果时才降级为单 Agent", async () => {
    const output = await runOutlineMultiAgentWorkflow({
      plan: [plan("a"), plan("b")],
      runSubAgent: async () => { throw new Error("全部失败") },
      runSingleAgentFallback: async () => "单 Agent 安全结果",
      mergeResults: async () => "不应合并",
    })

    expect(output.mode).toBe("single-agent-fallback")
    expect(output.finalText).toBe("单 Agent 安全结果")
    expect(output.fallbackReason).toContain("没有任何成功")
  })
})
