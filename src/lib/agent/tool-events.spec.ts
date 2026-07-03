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

  it("converts workflow child events into chapter workflow activities", () => {
    const event = activityEventFromAgentToolEvent({
      type: "result",
      callId: "workflow-1:chapter_task_brief",
      parentCallId: "workflow-1",
      name: "chapter_task_brief",
      params: { title: "生成写作任务书" },
      result: "写作任务书完成。",
      timestamp: 200,
    })

    expect(event).toMatchObject({
      stageId: "chapter_workflow",
      kind: "stage_output",
      title: "生成写作任务书",
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
})
