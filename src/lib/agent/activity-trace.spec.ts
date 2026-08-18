import { describe, expect, it } from "vitest"
import {
  activityEventFromToolEvent,
  appendAgentActivityEvent,
  applyAgentActivityEvent,
  createAgentActivityEvent,
  createStageStartedEvent,
  getDefaultOpenAgentStageId,
  prepareAgentStagesForDisplay,
  resolveAgentStageTitle,
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

  it("sorts stages by canonical display order and hides redundant chapter_workflow", () => {
    const stages: AgentStageTrace[] = [
      {
        id: "final_output",
        title: "最终输出",
        status: "done",
        summary: "完成",
        events: [],
        startedAt: 400,
      },
      {
        id: "chapter_workflow",
        title: "多任务写作循环",
        status: "running",
        summary: "聚合",
        events: [],
        startedAt: 50,
      },
      {
        id: "generate_draft",
        title: "生成章节草稿",
        status: "done",
        summary: "草稿",
        events: [],
        startedAt: 200,
      },
      {
        id: "read_context",
        title: "读取上下文",
        status: "done",
        summary: "上下文",
        events: [],
        startedAt: 100,
      },
      {
        id: "write_confirmation",
        title: "写入确认",
        status: "approval_required",
        summary: "待确认",
        events: [],
        startedAt: 500,
      },
    ]

    const prepared = prepareAgentStagesForDisplay(stages)
    expect(prepared.map((stage) => stage.id)).toEqual([
      "read_context",
      "generate_draft",
      "final_output",
      "write_confirmation",
    ])
  })

  it("keeps chapter_workflow when no detailed chapter stages exist", () => {
    const stages: AgentStageTrace[] = [
      {
        id: "chapter_workflow",
        title: "多任务写作循环",
        status: "running",
        summary: "运行中",
        events: [],
        startedAt: 100,
      },
      {
        id: "write_confirmation",
        title: "写入确认",
        status: "approval_required",
        summary: "待确认",
        events: [],
        startedAt: 200,
      },
    ]

    expect(prepareAgentStagesForDisplay(stages).map((stage) => stage.id)).toEqual([
      "write_confirmation",
      "chapter_workflow",
    ])
  })

  it("resolves titles for post-draft strict stages", () => {
    expect(resolveAgentStageTitle("final_polish")).toBe("去AI味")
    expect(resolveAgentStageTitle("execution_report")).toBe("执行报告")
    expect(resolveAgentStageTitle("execution_recheck")).toBe("执行复检")
    expect(resolveAgentStageTitle("plan_compliance")).toBe("计划履约")
    expect(resolveAgentStageTitle("plan_deviation_repair")).toBe("计划偏离返修")
    expect(resolveAgentStageTitle("plan_deviation_recheck")).toBe("计划偏离复检")
  })

  it("places 去AI味 between 校验与修正 and 最终输出", () => {
    const stages: AgentStageTrace[] = [
      { id: "final_output", title: "最终输出", status: "done", summary: "完成", events: [], startedAt: 400 },
      { id: "final_polish", title: "去AI味", status: "running", summary: "去AI味中", events: [], startedAt: 300 },
      { id: "validate_revision", title: "校验与修正", status: "done", summary: "校验", events: [], startedAt: 200 },
    ]

    expect(prepareAgentStagesForDisplay(stages).map((stage) => stage.id)).toEqual([
      "validate_revision",
      "final_polish",
      "final_output",
    ])
    expect(getDefaultOpenAgentStageId(stages)).toBe("final_polish")
  })

  it("places read_web_page and web_search on the external_search stage", () => {
    const page = activityEventFromToolEvent({
      type: "call_started",
      callId: "page-1",
      name: "read_web_page",
      params: { url: "https://example.test/hr" },
      timestamp: 100,
    })
    expect(page).toMatchObject({
      stageId: "external_search",
      kind: "web_search",
    })

    const search = activityEventFromToolEvent({
      type: "result",
      callId: "search-1",
      name: "web_search",
      params: { query: "黄蓉" },
      result: JSON.stringify({
        status: "ok",
        resultCount: 1,
        results: [{ title: "黄蓉", url: "https://example.test/hr", snippet: "", source: "example.test" }],
      }),
      timestamp: 120,
    })
    expect(search.stageId).toBe("external_search")
    expect(search.sourceRefs).toEqual([
      { title: "黄蓉", path: "https://example.test/hr", type: "web" },
    ])
  })

  it("uses the grouped writing search summary as activity content and keeps item URLs in sourceRefs", () => {
    const search = activityEventFromToolEvent({
      type: "result",
      callId: "search-grouped",
      name: "web_search",
      params: { query: "鲁茨科伊" },
      result: JSON.stringify({
        content: "已搜索：鲁茨科伊\n\n鲁茨科伊\n- 简介 · baike.com\n  摘要",
        searchedNames: ["鲁茨科伊"],
        notes: [],
        items: [{
          name: "鲁茨科伊",
          results: [{
            title: "简介",
            url: "https://m.baike.com/wikiid/123",
            snippet: "摘要",
            source: "baike.com",
          }],
        }],
      }),
      timestamp: 120,
    })
    expect(search.content).toContain("已搜索：鲁茨科伊")
    expect(search.content).toContain("摘要")
    expect(search.content).not.toContain("https://m.baike.com/wikiid/123")
    expect(search.sourceRefs).toEqual([
      { title: "简介", path: "https://m.baike.com/wikiid/123", type: "web" },
    ])
  })
})
