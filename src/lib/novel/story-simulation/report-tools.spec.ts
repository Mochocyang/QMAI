import { describe, expect, it } from "vitest"
import type { SimulationEvent, TimelineEvent } from "@/lib/novel/story-simulation/types"
import { createReportTools } from "@/lib/novel/story-simulation/report-tools"

function timelineEvent(overrides: Partial<TimelineEvent> & { id: string }): SimulationEvent {
  const t: TimelineEvent = {
    round: 0,
    nodeIndex: 0,
    actorId: "a1",
    actorName: "甲",
    actionType: "speak",
    content: "内容",
    observableBy: [],
    impacts: [],
    timestamp: "2026-07-06T00:00:00.000Z",
    ...overrides,
  }
  return { type: "agent-action", timelineEvent: t, timestamp: t.timestamp }
}

const EVENTS: SimulationEvent[] = [
  timelineEvent({ id: "e1", nodeIndex: 0, round: 0, actorName: "甲", content: "我要走了。" }),
  timelineEvent({ id: "e2", nodeIndex: 0, round: 0, actorName: "乙", content: "别拦我。" }),
  timelineEvent({ id: "e3", nodeIndex: 0, round: 1, actorName: "甲", content: "那你走吧。" }),
  timelineEvent({ id: "e4", nodeIndex: 1, round: 0, actorName: "丙", content: "城门开了。" }),
]

const FRAMEWORK_NODES = [
  { index: 0, phase: "起", title: "开端", goal: "引出冲突", expectedOutcome: "两人决裂" },
  { index: 1, phase: "承", title: "发展", goal: "推动升级", expectedOutcome: "冲突公开" },
]

function registry() {
  return createReportTools(EVENTS, FRAMEWORK_NODES as never)
}

async function run(toolName: string, params: Record<string, unknown> = {}) {
  const tool = registry().get(toolName)
  expect(tool, `工具 ${toolName} 应当存在`).toBeDefined()
  return tool!.execute(params)
}

/**
 * 报告分析师的工具集与角色工具集（sim-agent-tools.ts）**刻意分开**：角色工具带
 * 视角（recall/observe 只返回该角色可见事件），而分析师要的是全局只读取证的
 * 能力。混用会污染角色工具语义，所以这里独立一套。
 *
 * 同时这些工具必须**全部是只读**：报告阶段只是分析，不该有写副作用。
 */
describe("createReportTools", () => {
  it("提供用于取证的全局只读工具，且全部标为 read", () => {
    const tools = registry().list()
    const names = tools.map((t) => t.name).sort()

    expect(names).toEqual([
      "character_timeline",
      "list_nodes",
      "query_events",
      "report_stats",
    ])
    for (const tool of tools) {
      expect(tool.category, `${tool.name} 必须是只读`).toBe("read")
    }
  })

  it("每个工具都有描述与参数声明（模型要靠它决定何时调用）", () => {
    for (const tool of registry().list()) {
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.parameters).toBeTypeOf("object")
    }
  })

  it("query_events 返回原话逐字内容，供报告引用", async () => {
    const text = await run("query_events")
    expect(text).toContain("我要走了。")
    expect(text).toContain("别拦我。")
    expect(text).toContain("城门开了。")
  })

  it("query_events 可按角色筛选", async () => {
    const text = await run("query_events", { characterName: "甲" })
    expect(text).toContain("我要走了。")
    expect(text).toContain("那你走吧。")
    expect(text).not.toContain("别拦我。")
  })

  it("query_events 按节点筛选，且序号口径为 1 基（与 list_nodes 的「节点1」一致）", async () => {
    const second = await run("query_events", { nodeIndex: 2 })
    expect(second).toContain("城门开了。")
    expect(second).not.toContain("我要走了。")

    // 第一个节点：只含 nodeIndex 0 的事件
    const first = await run("query_events", { nodeIndex: 1 })
    expect(first).toContain("我要走了。")
    expect(first).toContain("别拦我。")
    expect(first).not.toContain("城门开了。")
  })

  it("节点序号越界时明确说明没有记录，而不是回退成全部", async () => {
    const text = await run("query_events", { nodeIndex: 99 })
    expect(text).toContain("没有")
    expect(text).not.toContain("我要走了。")
  })

  it("query_events 可按关键词搜索", async () => {
    const text = await run("query_events", { keyword: "走吧" })
    expect(text).toContain("那你走吧。")
    expect(text).not.toContain("别拦我。")
  })

  it("query_events 遵守 limit，并且明确告知还有多少条未显示", async () => {
    const text = await run("query_events", { limit: 2 })
    // 4 条里显示 2 条
    expect(text).toContain("未显示")
    expect(text).toContain("2")
  })

  it("query_events 没有匹配时给出明确说明，而不是空字符串", async () => {
    const text = await run("query_events", { keyword: "根本不存在的词" })
    expect(text.length).toBeGreaterThan(0)
    expect(text).toContain("没有")
  })

  it("character_timeline 按顺序给出某角色的全部原话", async () => {
    const text = await run("character_timeline", { name: "甲" })
    expect(text).toContain("我要走了。")
    expect(text).toContain("那你走吧。")
    expect(text).not.toContain("城门开了。")
    // 顺序应当保持事件顺序
    expect(text.indexOf("我要走了。")).toBeLessThan(text.indexOf("那你走吧。"))
  })

  it("character_timeline 对不存在的角色给出明确说明", async () => {
    const text = await run("character_timeline", { name: "查无此人" })
    expect(text).toContain("没有")
  })

  it("report_stats 汇总每个角色与每个节点的事件数", async () => {
    const text = await run("report_stats")
    expect(text).toContain("甲")
    expect(text).toContain("丙")
    // 甲 2 条
    expect(text).toMatch(/甲[^\n]*2/)
  })

  it("list_nodes 列出节点标题、目标与预期结果", async () => {
    const text = await run("list_nodes")
    expect(text).toContain("开端")
    expect(text).toContain("引出冲突")
    expect(text).toContain("两人决裂")
    expect(text).toContain("发展")
  })

  it("没有任何事件时各工具仍可安全调用", async () => {
    const tools = createReportTools([], FRAMEWORK_NODES as never)
    for (const tool of tools.list()) {
      const text = await tool.execute({})
      expect(typeof text).toBe("string")
      expect(text.length).toBeGreaterThan(0)
    }
  })
})
