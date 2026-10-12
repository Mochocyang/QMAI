import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SimulationEvent, TimelineEvent } from "@/lib/novel/story-simulation/types"

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  streamChat: vi.fn(),
  functionCalling: vi.fn(() => true),
}))

vi.mock("@/lib/agent/runner", () => ({
  AgentRunner: class {
    run(...args: unknown[]) {
      return mocks.run(...args)
    }
  },
  ModelDoesNotSupportToolsError: class extends Error {
    constructor() {
      super("当前模型不支持工具调用")
      this.name = "ModelDoesNotSupportToolsError"
    }
  },
}))

vi.mock("@/lib/llm-client", () => ({
  streamChat: (...args: unknown[]) => mocks.streamChat(...args),
}))

vi.mock("@/lib/agent/config", () => ({
  isFunctionCallingEnabled: () => mocks.functionCalling(),
}))

import { generateSimulationReport } from "@/lib/novel/story-simulation/simulation-report-agent"
import { ModelDoesNotSupportToolsError } from "@/lib/agent/runner"

function timelineEvent(
  overrides: Partial<TimelineEvent> & { id: string },
): SimulationEvent {
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
  timelineEvent({ id: "e1", actorName: "甲", content: "我要走了。" }),
  timelineEvent({ id: "e2", actorName: "乙", content: "别拦我，我已经决定了。" }),
  timelineEvent({ id: "e3", nodeIndex: 1, actorName: "甲", content: "那你走吧。" }),
]

const FRAMEWORK = {
  id: "fw",
  title: "测试框架",
  premise: "测试前提",
  targetWords: 10000,
  simulationMode: "hybrid",
  sourceChapters: 1,
  createdAt: "2026-07-06T00:00:00.000Z",
  userIdea: "",
  nodes: [
    {
      index: 0,
      phase: "起",
      title: "开端",
      coreConflict: "冲突",
      involvedCharacters: ["甲"],
      goal: "引出冲突",
      causeFromPrev: "无",
      expectedOutcome: "两人决裂",
    },
    {
      index: 1,
      phase: "承",
      title: "发展",
      coreConflict: "升级",
      involvedCharacters: ["甲"],
      goal: "推动升级",
      causeFromPrev: "决裂",
      expectedOutcome: "冲突公开",
    },
  ],
} as never

function reportJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    characterAnalyses: [
      {
        characterId: "a1",
        name: "甲",
        behaviors: [{ node: "开端", action: "表态", motivation: "想走" }],
        stateChanges: ["关系破裂"],
        consistencyScore: 88,
        evidence: ["我要走了。"],
      },
    ],
    branches: [
      {
        title: "决裂线",
        summary: "两人分道扬镳",
        keyEvents: ["甲离开"],
        probability: "high",
        pros: "冲突明确",
        cons: "缺少缓冲",
        recommendation: true,
        evidence: ["那你走吧。"],
      },
    ],
    recommendation: "建议走决裂线",
    ...overrides,
  })
}

/** AgentRunner 成功返回时记录下的参数。 */
function lastRunnerConfig() {
  const args = mocks.run.mock.calls[mocks.run.mock.calls.length - 1]
  return args[0] as {
    maxRounds: number
    systemPrompt: string
    requiredToolsOnce?: string[]
    tools: { name: string }[]
  }
}

function options() {
  return {
    events: EVENTS,
    framework: FRAMEWORK,
    mode: "hybrid" as const,
    llmConfig: { provider: "openai" } as never,
  }
}

/**
 * 报告 Agent 的取证化改造（P1-7）。
 *
 * 改造前它只把整份事件记录塞进一次提示词，模型无从核对、也无从被追责 ——
 * 报告里出现没发生过的事没人能发现。改造后它必须先用只读工具查证，并且
 * 报告里的引文要逐字来自事件记录，否则会被审计记为 unverified。
 */
describe("generateSimulationReport 取证化", () => {
  beforeEach(() => {
    mocks.run.mockReset()
    mocks.streamChat.mockReset()
    mocks.functionCalling.mockReturnValue(true)
    mocks.run.mockResolvedValue({
      toolCalls: [
        { name: "query_events", arguments: "{}", result: "" },
        { name: "character_timeline", arguments: "{}", result: "" },
        { name: "query_events", arguments: "{}", result: "" },
      ],
      roundsUsed: 3,
      finalText: reportJson(),
    })
  })

  it("走工具取证路径：把报告工具交给 AgentRunner", async () => {
    await generateSimulationReport(options())

    const config = lastRunnerConfig()
    expect(config.tools.map((t) => t.name).sort()).toEqual([
      "character_timeline",
      "list_nodes",
      "query_events",
      "report_stats",
    ])
    expect(config.maxRounds).toBeGreaterThanOrEqual(3)
  })

  it("用 requiredToolsOnce 强制至少查一次事件与角色，而不是只靠提示词自觉", async () => {
    await generateSimulationReport(options())

    const required = lastRunnerConfig().requiredToolsOnce ?? []
    expect(required).toContain("query_events")
    expect(required).toContain("character_timeline")
  })

  it("提示词把「逐字引用原话」写成硬性要求并声明 evidence 字段", async () => {
    await generateSimulationReport(options())

    const prompt = lastRunnerConfig().systemPrompt
    expect(prompt).toContain("逐字")
    expect(prompt).toContain("evidence")
    expect(prompt).toContain("query_events")
  })

  it("报告的引文被保留，并附带取证审计", async () => {
    const report = await generateSimulationReport(options())

    expect(report.characterAnalyses[0].evidence).toEqual(["我要走了。"])
    expect(report.branches[0].evidence).toEqual(["那你走吧。"])
    expect(report.evidenceAudit).toBeDefined()
    expect(report.evidenceAudit!.total).toBe(2)
    expect(report.evidenceAudit!.verified).toBe(2)
    expect(report.evidenceAudit!.unverified).toEqual([])
    expect(report.evidenceAudit!.toolCalls).toBe(3)
  })

  it("编造的引文会被记进 unverified，不会被当成证据", async () => {
    mocks.run.mockResolvedValue({
      toolCalls: [{ name: "query_events", arguments: "{}", result: "" }],
      roundsUsed: 1,
      finalText: reportJson({
        characterAnalyses: [
          {
            characterId: "a1",
            name: "甲",
            behaviors: [],
            stateChanges: [],
            consistencyScore: 80,
            evidence: ["我要走了。", "我从来没有爱过你。"],
          },
        ],
      }),
    })

    const report = await generateSimulationReport(options())

    expect(report.evidenceAudit!.total).toBe(3)
    expect(report.evidenceAudit!.verified).toBe(2)
    expect(report.evidenceAudit!.unverified).toEqual(["我从来没有爱过你。"])
  })

  it("模型不支持工具时回退单次调用，报告仍然可用", async () => {
    mocks.run.mockRejectedValue(new ModelDoesNotSupportToolsError())
    mocks.streamChat.mockImplementation(async (_c, _m, callbacks: { onToken: (t: string) => void }) => {
      callbacks.onToken(reportJson())
    })

    const report = await generateSimulationReport(options())

    expect(mocks.streamChat).toHaveBeenCalledTimes(1)
    expect(report.characterAnalyses).toHaveLength(1)
    expect(report.evidenceAudit!.toolCalls).toBe(0)
    // 回退路径同样要审计引文
    expect(report.evidenceAudit!.verified).toBe(2)
  })

  it("功能开关关闭时直接走单次调用，不做无谓的工具轮次", async () => {
    mocks.functionCalling.mockReturnValue(false)
    mocks.streamChat.mockImplementation(async (_c, _m, callbacks: { onToken: (t: string) => void }) => {
      callbacks.onToken(reportJson())
    })

    const report = await generateSimulationReport(options())

    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.streamChat).toHaveBeenCalledTimes(1)
    expect(report.characterAnalyses).toHaveLength(1)
  })

  it("工具路径没产出文本时回退单次调用", async () => {
    mocks.run.mockResolvedValue({ toolCalls: [], roundsUsed: 1, finalText: "   " })
    mocks.streamChat.mockImplementation(async (_c, _m, callbacks: { onToken: (t: string) => void }) => {
      callbacks.onToken(reportJson())
    })

    const report = await generateSimulationReport(options())

    expect(mocks.streamChat).toHaveBeenCalledTimes(1)
    expect(report.evidenceAudit!.verified).toBe(2)
  })

  it("两条路径都拿不到可解析 JSON 时仍降级返回，不抛异常", async () => {
    mocks.run.mockResolvedValue({
      toolCalls: [],
      roundsUsed: 1,
      finalText: "模型说了些别的",
    })
    mocks.streamChat.mockImplementation(async (_c, _m, callbacks: { onToken: (t: string) => void }) => {
      callbacks.onToken("模型说了些别的")
    })

    const report = await generateSimulationReport(options())

    expect(report.characterAnalyses).toEqual([])
    expect(report.recommendation).toContain("模型说了些别的")
    expect(report.evidenceAudit!.total).toBe(0)
  })

  it("没有事件记录时审计为空而不是报错", async () => {
    mocks.run.mockResolvedValue({
      toolCalls: [],
      roundsUsed: 1,
      finalText: reportJson(),
    })

    const report = await generateSimulationReport({ ...options(), events: [] })

    expect(report.evidenceAudit!.total).toBe(2)
    expect(report.evidenceAudit!.verified).toBe(0)
    expect(report.evidenceAudit!.unverified).toHaveLength(2)
  })

  it("通过 onProgress 汇报取证阶段", async () => {
    const onProgress = vi.fn()
    await generateSimulationReport({ ...options(), onProgress })

    const labels = onProgress.mock.calls.map((c) => String(c[0]))
    expect(labels.some((l) => l.includes("取证"))).toBe(true)
  })
})
