import { describe, expect, it } from "vitest"
import {
  appendAgentActivityEvent,
  applyAgentActivityEvent,
  createAgentActivityEvent,
  createStageStartedEvent,
  getDefaultOpenAgentStageId,
  settleRunningAgentStages,
  summarizeAgentStage,
} from "./activity-trace"
import type { AgentStageTrace } from "./types"

describe("activity trace", () => {
  it("creates a running stage and appends activity in order", () => {
    let stages: AgentStageTrace[] = []

    stages = applyAgentActivityEvent(stages, createStageStartedEvent({
      stageId: "read_context",
      title: "读取上下文",
      summary: "读取章节、大纲和记忆",
      timestamp: 100,
    }))

    stages = appendAgentActivityEvent(stages, createAgentActivityEvent({
      id: "ev-1",
      stageId: "read_context",
      kind: "read_source",
      title: "读取上一章",
      content: "读取章节《第13章》",
      timestamp: 120,
    }))

    expect(stages).toHaveLength(1)
    expect(stages[0]).toMatchObject({
      id: "read_context",
      title: "读取上下文",
      status: "running",
      summary: "读取章节、大纲和记忆",
      startedAt: 100,
    })
    expect(stages[0].events.map((event) => event.title)).toEqual(["进入阶段", "读取上一章"])
  })

  it("marks a stage done when stage_output is appended", () => {
    const stages = applyAgentActivityEvent([], createStageStartedEvent({
      stageId: "plot_analysis",
      title: "分析剧情走向",
      summary: "分析本章承接关系",
      timestamp: 100,
    }))

    const next = appendAgentActivityEvent(stages, createAgentActivityEvent({
      id: "ev-2",
      stageId: "plot_analysis",
      kind: "stage_output",
      title: "阶段产物",
      content: "本章以铜铃线索开场，以身份疑点结尾。",
      timestamp: 180,
    }))

    expect(next[0].status).toBe("done")
    expect(next[0].finishedAt).toBe(180)
    expect(summarizeAgentStage(next[0])).toContain("本章以铜铃线索开场")
  })

  it("keeps running or approval stages open by default", () => {
    const stages: AgentStageTrace[] = [
      { id: "done", title: "已完成", status: "done", summary: "完成", events: [], startedAt: 1, finishedAt: 2 },
      { id: "running", title: "进行中", status: "running", summary: "生成中", events: [], startedAt: 3 },
    ]

    expect(getDefaultOpenAgentStageId(stages)).toBe("running")
  })

  it("moves the active stage forward when a later stage starts", () => {
    let stages: AgentStageTrace[] = []

    stages = applyAgentActivityEvent(stages, createAgentActivityEvent({
      id: "read-start",
      stageId: "read_context",
      kind: "read_source",
      title: "调用完成：read_chapter",
      content: "已读取第1章。",
      timestamp: 100,
    }))
    stages = applyAgentActivityEvent(stages, createStageStartedEvent({
      stageId: "generate_draft",
      title: "生成章节草稿",
      summary: "开始生成正文。",
      timestamp: 200,
    }))

    expect(stages.find((stage) => stage.id === "read_context")?.status).toBe("done")
    expect(stages.find((stage) => stage.id === "generate_draft")?.status).toBe("running")
    expect(getDefaultOpenAgentStageId(stages)).toBe("generate_draft")
  })

  it("opens the most recent running stage when aggregate and detailed stages overlap", () => {
    const stages: AgentStageTrace[] = [
      {
        id: "chapter_workflow",
        title: "多任务写作循环",
        status: "running",
        summary: "运行章节工作流",
        events: [],
        startedAt: 100,
      },
      {
        id: "generate_draft",
        title: "生成章节草稿",
        status: "running",
        summary: "生成正文初稿",
        events: [],
        startedAt: 300,
      },
    ]

    expect(getDefaultOpenAgentStageId(stages)).toBe("generate_draft")
  })

  it("does not render undefined-like empty content", () => {
    const event = createAgentActivityEvent({
      id: "ev-empty",
      stageId: "read_context",
      kind: "analysis",
      title: "软件分析",
      content: "",
      timestamp: 100,
    })

    expect(event.content).toBe("本阶段未返回可展示内容。")
  })

  it("settles leftover running stages when an agent session finishes", () => {
    const stages: AgentStageTrace[] = [
      {
        id: "external_search",
        title: "外部检索",
        status: "running",
        summary: "keyword: 兄弟",
        startedAt: 100,
        events: [{
          id: "search-1",
          stageId: "external_search",
          kind: "web_search",
          title: "调用完成：search_chapters",
          content: "已搜索 18 个章节文件。",
          timestamp: 150,
        }],
      },
      {
        id: "final_output",
        title: "最终输出",
        status: "done",
        summary: "第21章已生成。",
        startedAt: 200,
        finishedAt: 260,
        events: [],
      },
      {
        id: "write_confirmation",
        title: "写入确认",
        status: "approval_required",
        summary: "等待用户确认写入。",
        startedAt: 300,
        finishedAt: 320,
        events: [],
      },
    ]

    const settled = settleRunningAgentStages(stages, "done", 400)
    expect(settled).toBeDefined()
    const settledStages = settled ?? []

    expect(settledStages[0]).toMatchObject({
      status: "done",
      finishedAt: 400,
    })
    expect(settledStages[0].summary).toBe("keyword: 兄弟")
    expect(settledStages[1]).toMatchObject({
      status: "done",
      finishedAt: 260,
    })
    expect(settledStages[2]).toMatchObject({
      status: "approval_required",
      finishedAt: 320,
    })
  })
})
