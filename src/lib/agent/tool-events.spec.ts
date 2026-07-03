import { describe, expect, it } from "vitest"
import { applyAgentToolEvent, settleRunningAgentToolCalls } from "./tool-events"

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
})
