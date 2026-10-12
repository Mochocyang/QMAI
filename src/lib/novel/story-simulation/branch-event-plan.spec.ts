import { beforeEach, describe, expect, it, vi } from "vitest"
import { fileExists, writeFileAtomic } from "@/commands/fs"
import {
  buildBranchEventPlanMarkdown,
  exportBranchEventPlan,
  generateBranchEventPlan,
  parseEventPlanReply,
  resolvePlanTargetNode,
  validateEventPlan,
  type PlannedEvent,
} from "./branch-event-plan"
import type {
  SimulationReport,
  StoryBranch,
  StoryFramework,
  StoryNode,
} from "./types"

const mocks = vi.hoisted(() => ({
  streamChat: vi.fn(),
}))

vi.mock("@/lib/llm-client", () => ({
  streamChat: (...args: unknown[]) => mocks.streamChat(...args),
}))

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(async () => {}),
  writeFileAtomic: vi.fn(async () => {}),
  fileExists: vi.fn(async () => false),
  readFile: vi.fn(async () => ""),
}))

const mockWrite = vi.mocked(writeFileAtomic)
const mockExists = vi.mocked(fileExists)

// ── 夹具 ──

function node(over: Partial<StoryNode> = {}): StoryNode {
  return {
    index: 2,
    phase: "承",
    title: "第一次摊牌",
    coreConflict: "主角与挚友的立场对立",
    involvedCharacters: ["甲", "乙"],
    goal: "让对立浮上台面",
    causeFromPrev: "上一章的误会未解",
    expectedOutcome: "两人彻底决裂",
    ...over,
  }
}

function branch(over: Partial<StoryBranch> = {}): StoryBranch {
  return {
    title: "决裂线",
    summary: "主角在证据面前不再退让，挚友选择转身离开。",
    keyEvents: ["当面对质", "证据被摔在桌上", "挚友沉默离开"],
    probability: "high",
    pros: "冲突强度高",
    cons: "失去一条和解退路",
    recommendation: true,
    ...over,
  }
}

function framework(): StoryFramework {
  return {
    id: "fw-1",
    title: "测试框架",
    premise: "前提",
    targetWords: 30000,
    simulationMode: "hybrid",
    sourceChapters: 1,
    createdAt: "2026-07-06T00:00:00.000Z",
    nodes: [node({ index: 0, title: "开端", phase: "起" }), node()],
  }
}

function report(): SimulationReport {
  return {
    frameworkId: "fw-1",
    mode: "hybrid",
    characterAnalyses: [
      {
        characterId: "a",
        name: "甲",
        behaviors: [{ node: "第一次摊牌", action: "摔下证据", motivation: "逼对方表态" }],
        stateChanges: ["与乙关系破裂"],
        consistencyScore: 85,
      },
    ],
    branches: [branch()],
    recommendation: "推荐决裂线",
    createdAt: "2026-07-06T00:00:00.000Z",
  }
}

function events(count: number): PlannedEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    what: `事件${i + 1}`,
    cause: `起因${i + 1}`,
    action: `行动${i + 1}`,
    result: `结果${i + 1}`,
    use: `作用${i + 1}`,
  }))
}

/** 把 streamChat 的返回安排成一个「一次性吐完整段文本」的流。 */
function mockReply(text: string) {
  mocks.streamChat.mockImplementation(
    async (
      _config: unknown,
      _messages: unknown,
      callbacks: { onToken?: (t: string) => void; onDone?: () => void; onError?: (e: Error) => void },
    ) => {
      callbacks.onToken?.(text)
      callbacks.onDone?.()
    },
  )
}

function validReply(): string {
  return [
    "好的，以下事件计划：",
    "```json",
    JSON.stringify({ events: events(6) }),
    "```",
  ].join("\n")
}

// ── 解析 ──

describe("parseEventPlanReply", () => {
  it("从 ```json 代码块里取出事件链", () => {
    expect(parseEventPlanReply(validReply())).toHaveLength(6)
  })

  it("裸 JSON 也能解析", () => {
    const parsed = parseEventPlanReply(JSON.stringify({ events: events(6) }))

    expect(parsed).toHaveLength(6)
    expect(parsed[0].what).toBe("事件1")
  })

  it("字段两侧空白被裁掉（模型常带缩进换行）", () => {
    const raw = JSON.stringify({
      events: [{ what: "  事  ", cause: "\n因\n", action: " 行 ", result: " 果 ", use: " 用 " }],
    })

    const parsed = parseEventPlanReply(raw)

    expect(parsed[0]).toEqual({
      what: "事",
      cause: "因",
      action: "行",
      result: "果",
      use: "用",
    })
  })

  it("字段缺失时补空串，交由校验环节统一报错（不在这里抛）", () => {
    const parsed = parseEventPlanReply(JSON.stringify({ events: [{ what: "只有这个" }] }))

    expect(parsed).toHaveLength(1)
    expect(parsed[0].cause).toBe("")
  })

  it("非对象项被丢弃，而不是变成一串空事件", () => {
    const parsed = parseEventPlanReply(
      JSON.stringify({ events: ["字符串", 42, null, { what: "真事件" }] }),
    )

    expect(parsed).toHaveLength(1)
    expect(parsed[0].what).toBe("真事件")
  })

  it("完全没有 JSON 时返回空数组，由调用方按校验结果处理", () => {
    expect(parseEventPlanReply("模型今天不想干活")).toEqual([])
  })

  it("events 不是数组时返回空数组", () => {
    expect(parseEventPlanReply(JSON.stringify({ events: "六条" }))).toEqual([])
  })
})

// ── 校验 ──

describe("validateEventPlan", () => {
  it("齐全的 6 条没有意见", () => {
    expect(validateEventPlan(events(6))).toEqual([])
  })

  it("不足 6 条要指出条数（与章纲 §5 同一约束）", () => {
    const problems = validateEventPlan(events(4))

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("不足 6 条")
    expect(problems[0]).toContain("当前 4 条")
  })

  it("缺起因的事件不构成因果链，逐条点名", () => {
    const list = events(6)
    list[2] = { ...list[2], cause: "" }

    const problems = validateEventPlan(list)

    expect(problems).toEqual(["第 3 个事件缺少起因，不构成因果链。"])
  })

  it("缺结果同样逐条点名", () => {
    const list = events(6)
    list[0] = { ...list[0], result: "" }

    expect(validateEventPlan(list)).toEqual(["第 1 个事件缺少结果，不构成因果链。"])
  })

  it("缺「作用」也要报（§5 要求每条含 use）", () => {
    const list = events(6)
    list[5] = { ...list[5], use: "" }

    expect(validateEventPlan(list)).toEqual(["第 6 个事件缺少作用（这条事件对本章的用处）。"])
  })

  it("条数不足与字段缺失可以同时报出（调用方能一次看全所有问题）", () => {
    const list = events(2)
    list[1] = { ...list[1], cause: "", use: "" }

    const problems = validateEventPlan(list)

    expect(problems).toHaveLength(3)
    expect(problems[0]).toContain("不足 6 条")
    expect(problems[1]).toContain("第 2 个事件缺少起因")
    expect(problems[2]).toContain("第 2 个事件缺少作用")
  })
})

// ── 渲染 ──

describe("buildBranchEventPlanMarkdown", () => {
  const markdown = buildBranchEventPlanMarkdown({
    framework: framework(),
    node: node(),
    branch: branch(),
    events: events(6),
    now: new Date("2026-07-06T12:00:00.000Z"),
  })

  it("逐条列出 5 个必需字段", () => {
    expect(markdown).toContain("发生什么")
    expect(markdown).toContain("起因")
    expect(markdown).toContain("行动")
    expect(markdown).toContain("结果")
    expect(markdown).toContain("作用")
    expect(markdown).toContain("事件1")
    expect(markdown).toContain("作用6")
  })

  it("标明这是事件计划而不是完整章纲（避免被 17 节章纲校验当成残缺章纲）", () => {
    expect(markdown).toContain("type: chapter-event-plan")
    expect(markdown).not.toContain("type: chapter-outline")
  })

  it("带上溯源信息：框架、节点、分支、章节号", () => {
    expect(markdown).toContain('framework_id: "fw-1"')
    expect(markdown).toContain("第一次摊牌")
    expect(markdown).toContain("决裂线")
    expect(markdown).toContain("第 3 章")
  })

  it("带上分支的概要与关键事件，便于回看这份计划从哪来", () => {
    expect(markdown).toContain("主角在证据面前不再退让")
    expect(markdown).toContain("当面对质")
  })
})

// ── 生成 ──

describe("generateBranchEventPlan", () => {
  beforeEach(() => {
    mocks.streamChat.mockReset()
  })

  it("模型给出合规计划时返回事件链", async () => {
    mockReply(validReply())

    const result = await generateBranchEventPlan({
      framework: framework(),
      node: node(),
      branch: branch(),
      report: report(),
      llmConfig: { provider: "openai", apiKey: "k", model: "m" } as never,
    })

    expect(result).toHaveLength(6)
  })

  it("模型只给 4 条时直接报错，不静默交出一份残缺计划", async () => {
    mockReply(JSON.stringify({ events: events(4) }))

    await expect(
      generateBranchEventPlan({
        framework: framework(),
        node: node(),
        branch: branch(),
        report: report(),
        llmConfig: { provider: "openai", apiKey: "k", model: "m" } as never,
      }),
    ).rejects.toThrow(/不足 6 条/)
  })

  it("把节点目标、分支关键事件与角色行为一并写进提示词（否则模型只能编）", async () => {
    mockReply(validReply())

    await generateBranchEventPlan({
      framework: framework(),
      node: node(),
      branch: branch(),
      report: report(),
      llmConfig: { provider: "openai", apiKey: "k", model: "m" } as never,
    })

    const messages = mocks.streamChat.mock.calls[0][1] as Array<{ content: string }>
    const prompt = messages.map((m) => m.content).join("\n")

    expect(prompt).toContain("让对立浮上台面")
    expect(prompt).toContain("当面对质")
    expect(prompt).toContain("摔下证据")
    expect(prompt).toContain("不足 6 条")
  })

  it("模型报错时把错误抛出去，不返回一份空计划", async () => {
    mocks.streamChat.mockImplementation(
      async (_c: unknown, _m: unknown, cb: { onError?: (e: Error) => void }) => {
        cb.onError?.(new Error("网络中断"))
      },
    )

    await expect(
      generateBranchEventPlan({
        framework: framework(),
        node: node(),
        branch: branch(),
        report: report(),
        llmConfig: { provider: "openai", apiKey: "k", model: "m" } as never,
      }),
    ).rejects.toThrow("网络中断")
  })
})

// ── 落点节点 ──

describe("resolvePlanTargetNode", () => {
  it("优先取与分支同名的节点（分支名通常就是它推进到的那一步）", () => {
    const fw = framework()
    const target = resolvePlanTargetNode(fw, branch({ title: "第一次摊牌" }))

    expect(target?.node.title).toBe("第一次摊牌")
    expect(target?.node.index).toBe(2)
  })

  it("没有同名节点时退回第一个节点，并标记这是兜底而不是命中", () => {
    const result = resolvePlanTargetNode(framework(), branch({ title: "随便什么名字" }))

    expect(result?.node.title).toBe("开端")
    // 必须能区分「命中」与「兜底」，否则界面会谎称落到了用户以为的那一章
    expect(result?.matchedByTitle).toBe(false)
  })

  it("同名命中时标记为命中", () => {
    const result = resolvePlanTargetNode(framework(), branch({ title: "第一次摊牌" }))

    expect(result?.matchedByTitle).toBe(true)
  })

  it("框架没有任何节点时返回 null，由调用方明确报错", () => {
    expect(resolvePlanTargetNode({ ...framework(), nodes: [] }, branch())).toBeNull()
  })
})

// ── 落盘 ──

describe("exportBranchEventPlan", () => {
  beforeEach(() => {
    mockWrite.mockClear()
    mockExists.mockReset()
    mockExists.mockResolvedValue(false)
  })

  it("写到 wiki/outlines/事件计划/ 下、文件名带章节号与分支名", async () => {
    await exportBranchEventPlan({
      projectPath: "/proj",
      chapterNumber: 3,
      branchTitle: "决裂线",
      markdown: "# 计划",
    })

    const [path] = mockWrite.mock.calls[0]
    expect(String(path).replace(/\\/g, "/")).toBe(
      "/proj/wiki/outlines/事件计划/事件计划-第003章-决裂线.md",
    )
  })

  it("同名文件已存在时加时间戳，绝不覆盖用户已有文件", async () => {
    mockExists.mockResolvedValue(true)

    await exportBranchEventPlan({
      projectPath: "/proj",
      chapterNumber: 3,
      branchTitle: "决裂线",
      markdown: "# 计划",
    })

    const [path] = mockWrite.mock.calls[0]
    const normalized = String(path).replace(/\\/g, "/")
    expect(normalized).toMatch(/事件计划-第003章-决裂线-\d+\.md$/)
  })

  it("分支名里的路径分隔符与非法字符被替换，不能逃出目标目录", async () => {
    await exportBranchEventPlan({
      projectPath: "/proj",
      chapterNumber: 3,
      branchTitle: "../../外面/斜杠:冒号",
      markdown: "# 计划",
    })

    const [path] = mockWrite.mock.calls[0]
    const normalized = String(path).replace(/\\/g, "/")
    expect(normalized).not.toContain("..")
    expect(normalized).toContain("/proj/wiki/outlines/事件计划/")
  })
})
