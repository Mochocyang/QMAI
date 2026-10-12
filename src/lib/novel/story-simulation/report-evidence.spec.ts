import { describe, expect, it } from "vitest"
import type { SimulationEvent, TimelineEvent } from "@/lib/novel/story-simulation/types"
import {
  normalizeQuote,
  toReportRecords,
  verifyEvidence,
} from "@/lib/novel/story-simulation/report-evidence"

function event(overrides: Partial<TimelineEvent> = {}): SimulationEvent {
  const timelineEvent: TimelineEvent = {
    id: overrides.id ?? "e1",
    round: overrides.round ?? 0,
    nodeIndex: overrides.nodeIndex ?? 0,
    actorId: overrides.actorId ?? "a1",
    actorName: overrides.actorName ?? "甲",
    actionType: overrides.actionType ?? "speak",
    content: overrides.content ?? "内容",
    observableBy: overrides.observableBy ?? [],
    impacts: overrides.impacts ?? [],
    timestamp: overrides.timestamp ?? "2026-07-06T00:00:00.000Z",
  }
  return { type: "agent-action", timelineEvent, timestamp: timelineEvent.timestamp }
}

describe("toReportRecords", () => {
  it("优先用 timelineEvent 提取记录", () => {
    const records = toReportRecords([
      event({ nodeIndex: 2, round: 3, actorName: "甲", content: "我要走了。" }),
    ])

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      nodeIndex: 2,
      round: 3,
      actorName: "甲",
      content: "我要走了。",
    })
  })

  it("没有 timelineEvent 时退回 agent + action", () => {
    const records = toReportRecords([
      {
        type: "agent-action",
        timestamp: "2026-07-06T00:00:00.000Z",
        round: 1,
        node: { index: 1 } as never,
        agent: { characterId: "a2", name: "乙" } as never,
        action: { type: "speak", content: "别拦我。" },
      },
    ])

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      nodeIndex: 1,
      round: 1,
      actorName: "乙",
      content: "别拦我。",
    })
  })

  it("node-start / info 这类没有角色台词的记录不进入证据池", () => {
    const records = toReportRecords([
      { type: "node-start", timestamp: "t", node: { index: 0 } as never },
      { type: "info", timestamp: "t", message: "引擎提示" },
      { type: "node-complete", timestamp: "t", node: { index: 0 } as never },
    ])

    expect(records).toHaveLength(0)
  })

  it("内容为空白的记录一并丢掉，避免拿空串当证据", () => {
    const records = toReportRecords([
      event({ content: "   " }),
      event({ id: "e2", content: "" }),
    ])

    expect(records).toHaveLength(0)
  })
})

describe("normalizeQuote", () => {
  it("折叠空白并去掉首尾包裹的引号", () => {
    expect(normalizeQuote("  「我要\n走了。」  ")).toBe("我要 走了。")
    expect(normalizeQuote("“别拦我。”")).toBe("别拦我。")
  })

  it("不动内部的引号与标点", () => {
    expect(normalizeQuote("他说「不」")).toBe("他说「不」")
  })
})

/**
 * 报告必须逐字引用 agent 原话作为证据（P1-7 硬要求）。这个函数就是那条
 * 「不许编造」的底线：编出来的引文会被判为 unverified 并计入审计。
 */
describe("verifyEvidence", () => {
  const events = [
    event({ id: "e1", actorName: "甲", content: "我要走了。", nodeIndex: 0 }),
    event({ id: "e2", actorName: "乙", content: "别拦我，我已经决定了。", nodeIndex: 0 }),
    event({ id: "e3", actorName: "甲", content: "那你走吧。", nodeIndex: 1 }),
  ]

  it("原文照抄算通过", () => {
    const audit = verifyEvidence(["我要走了。"], events)
    expect(audit.total).toBe(1)
    expect(audit.verified).toBe(1)
    expect(audit.unverified).toEqual([])
  })

  it("带角色名前缀也算通过（引文常见写法）", () => {
    expect(verifyEvidence(["甲：我要走了。"], events).verified).toBe(1)
    expect(verifyEvidence(["甲: 我要走了。"], events).verified).toBe(1)
  })

  it("空白与换行差异不影响判定", () => {
    expect(verifyEvidence(["我要\n  走了。"], events).verified).toBe(1)
  })

  it("被引号包裹不影响判定", () => {
    expect(verifyEvidence(["「别拦我，我已经决定了。」"], events).verified).toBe(1)
  })

  it("引文是原话的子串也算通过（截取片段）", () => {
    expect(verifyEvidence(["我已经决定了"], events).verified).toBe(1)
  })

  it("编造的引文被判为 unverified", () => {
    const audit = verifyEvidence(["我从来没有爱过你。"], events)
    expect(audit.total).toBe(1)
    expect(audit.verified).toBe(0)
    expect(audit.unverified).toEqual(["我从来没有爱过你。"])
  })

  it("把两个角色的话拼起来也不算通过", () => {
    const audit = verifyEvidence(["我要走了。别拦我，我已经决定了。"], events)
    expect(audit.verified).toBe(0)
  })

  it("空白引文被忽略，不计入总数", () => {
    const audit = verifyEvidence(["", "   ", "我要走了。"], events)
    expect(audit.total).toBe(1)
    expect(audit.verified).toBe(1)
  })

  it("混合场景下逐条判定并保留未通过原文", () => {
    const audit = verifyEvidence(
      ["我要走了。", "这是编的。", "那你走吧。"],
      events,
    )
    expect(audit.total).toBe(3)
    expect(audit.verified).toBe(2)
    expect(audit.unverified).toEqual(["这是编的。"])
  })

  it("没有任何事件时一切都无法验证", () => {
    const audit = verifyEvidence(["我要走了。"], [])
    expect(audit.total).toBe(1)
    expect(audit.verified).toBe(0)
  })

  it("重复引文按条计数，不去重", () => {
    const audit = verifyEvidence(["我要走了。", "我要走了。"], events)
    expect(audit.total).toBe(2)
    expect(audit.verified).toBe(2)
  })
})
