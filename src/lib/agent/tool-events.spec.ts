import { describe, expect, it } from "vitest"
import {
  activityEventFromAgentToolEvent,
  applyAgentToolActivityEvent,
  applyAgentToolEvent,
  settleRunningAgentToolCalls,
} from "./tool-events"

describe("applyAgentToolEvent", () => {
  it("creates and updates tool call records from normalized events", () => {
    const started = applyAgentToolEvent(undefined, {
      type: "call_started",
      callId: "c1",
      name: "read_chapter",
      params: { name: "第1章" },
      timestamp: 100,
    })

    expect(started).toEqual([
      {
        id: "c1",
        name: "read_chapter",
        params: { name: "第1章" },
        result: "",
        status: "running",
        startedAt: 100,
        finishedAt: 0,
      },
    ])

    const finished = applyAgentToolEvent(started, {
      type: "result",
      callId: "c1",
      name: "read_chapter",
      params: { name: "第1章" },
      result: "章节内容",
      timestamp: 180,
    })

    expect(finished[0]).toMatchObject({
      result: "章节内容",
      status: "done",
      startedAt: 100,
      finishedAt: 180,
    })
  })

  it("marks write tools as approval_required without treating them as errors", () => {
    const records = applyAgentToolEvent(undefined, {
      type: "approval_required",
      callId: "w1",
      name: "write_chapter",
      params: { name: "第1章" },
      result: "需要用户确认",
      timestamp: 200,
    })

    expect(records[0].status).toBe("approval_required")
    expect(records[0].result).toContain("需要用户确认")
  })

  it("preserves parent call metadata for workflow child events", () => {
    const records = applyAgentToolEvent(undefined, {
      type: "call_started",
      callId: "chapter-context",
      parentCallId: "chapter-workflow",
      name: "chapter_context",
      params: { title: "读取上下文" },
      timestamp: 100,
    })

    expect(records[0]).toMatchObject({
      id: "chapter-context",
      name: "chapter_context",
      status: "running",
      parentCallId: "chapter-workflow",
    })
  })

  it("settles leftover running tool calls when an agent session finishes", () => {
    const records = settleRunningAgentToolCalls([
      {
        id: "c1",
        name: "read_chapter",
        params: { name: "第1章" },
        result: "",
        status: "running",
        startedAt: 100,
        finishedAt: 0,
      },
      {
        id: "c2",
        name: "write_chapter",
        params: { name: "第2章" },
        result: "等待确认",
        status: "approval_required",
        startedAt: 120,
        finishedAt: 130,
      },
    ], "done", 200)

    expect(records?.[0]).toMatchObject({
      status: "done",
      finishedAt: 200,
    })
    expect(records?.[1]).toMatchObject({
      status: "approval_required",
      finishedAt: 130,
    })
  })

  it("converts read tools into read_source activity events", () => {
    const event = activityEventFromAgentToolEvent({
      type: "result",
      callId: "read-1",
      name: "read_chapter",
      params: { chapter: "第13章" },
      result: "第13章结尾：主角发现铜铃线索。",
      timestamp: 100,
    })

    expect(event).toMatchObject({
      stageId: "read_context",
      kind: "read_source",
      title: "调用完成：read_chapter",
      toolCallId: "read-1",
    })
    expect(event.content).toContain("铜铃线索")
  })

  it("skips writing chapter_* child tool events into agent stages", () => {
    const event = activityEventFromAgentToolEvent({
      type: "result",
      callId: "workflow-1:chapter_task_brief",
      parentCallId: "workflow-1",
      name: "chapter_task_brief",
      params: { title: "生成写作任务书" },
      result: "写作任务书完成。",
      timestamp: 200,
    })

    expect(event).toBeNull()

    const stages = applyAgentToolActivityEvent(
      [
        {
          id: "read_context",
          title: "读取上下文",
          status: "done",
          summary: "已完成",
          events: [],
          startedAt: 100,
          finishedAt: 150,
        },
      ],
      {
        type: "result",
        callId: "workflow-1:chapter_task_brief",
        parentCallId: "workflow-1",
        name: "chapter_task_brief",
        params: { title: "生成写作任务书" },
        result: "写作任务书完成。",
        timestamp: 200,
      },
    )

    expect(stages).toHaveLength(1)
    expect(stages[0].id).toBe("read_context")
  })

  it("still maps orphan chapter_* events without parentCallId into chapter_workflow", () => {
    const event = activityEventFromAgentToolEvent({
      type: "result",
      callId: "orphan-chapter-context",
      name: "chapter_context",
      params: { title: "读取上下文" },
      result: "上下文完成。",
      timestamp: 200,
    })

    expect(event).toMatchObject({
      stageId: "chapter_workflow",
      kind: "stage_output",
      title: "读取上下文",
    })
  })

  it("applies tool activity events to stage traces", () => {
    const stages = applyAgentToolActivityEvent(undefined, {
      type: "call_started",
      callId: "w1",
      name: "write_chapter",
      params: { title: "第14章" },
      timestamp: 100,
    })

    expect(stages[0]).toMatchObject({
      id: "write_confirmation",
      title: "写入确认",
      status: "running",
    })
  })

  it("maps web_search and read_web_page into the external_search stage with sources", () => {
    const started = applyAgentToolActivityEvent(undefined, {
      type: "call_started",
      callId: "workflow-1:web_search",
      parentCallId: "workflow-1",
      name: "web_search",
      params: { query: "黄蓉", title: "联网搜索" },
      timestamp: 100,
    })
    expect(started[0]).toMatchObject({
      id: "external_search",
      title: "外部检索",
      status: "running",
    })
    expect(started[0].events[0].title).toContain("联网搜索「黄蓉」")

    const completed = applyAgentToolActivityEvent(started, {
      type: "result",
      callId: "workflow-1:web_search",
      parentCallId: "workflow-1",
      name: "web_search",
      params: { query: "黄蓉", sources: ["黄蓉简介 https://example.test/hr"] },
      result: JSON.stringify({
        status: "ok",
        query: "黄蓉",
        resultCount: 1,
        results: [{ title: "黄蓉简介", url: "https://example.test/hr", snippet: "摘要", source: "example.test" }],
      }),
      timestamp: 160,
    })
    expect(completed[0].events.at(-1)?.kind).toBe("web_search")
    expect(completed[0].events.at(-1)?.sourceRefs).toEqual([
      { title: "黄蓉简介", path: "https://example.test/hr", type: "web" },
    ])

    const page = activityEventFromAgentToolEvent({
      type: "error",
      callId: "read-page-1",
      name: "read_web_page",
      params: { url: "https://example.test/missing" },
      result: JSON.stringify({ status: "error", url: "https://example.test/missing", message: "HTTP 状态码：404" }),
      timestamp: 200,
    })
    expect(page).toMatchObject({
      stageId: "external_search",
      kind: "error",
    })
    expect(page?.title).toContain("读取网页")
    expect(page?.title).toContain("失败")
  })
})
