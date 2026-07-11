import { describe, expect, it } from "vitest"
import {
  canStartConversationRun,
  failConversationRun,
  finishConversationRun,
  normalizeLoadedRunStates,
  stopConversationRun,
  type ConversationRunState,
} from "./conversation-run-state"

const running = (updatedAt: number): ConversationRunState => ({ status: "running", updatedAt })

describe("conversation run state", () => {
  it("marks background completion unread", () => {
    expect(finishConversationRun("b", "a", 20)).toEqual({ status: "completed_unread", updatedAt: 20 })
  })

  it("returns active completion to idle", () => {
    expect(finishConversationRun("a", "a", 20)).toEqual({ status: "idle", updatedAt: 20 })
  })

  it("returns manual stop to idle", () => {
    expect(stopConversationRun(30)).toEqual({ status: "idle", updatedAt: 30 })
  })

  it("records a failed run with its error", () => {
    expect(failConversationRun("网络错误", 35)).toEqual({
      status: "failed",
      error: "网络错误",
      updatedAt: 35,
    })
  })

  it("turns loaded running tasks into interrupted tasks", () => {
    expect(normalizeLoadedRunStates({ a: running(10) }, 40)).toEqual({
      a: { status: "interrupted", updatedAt: 40, error: "任务在软件关闭前未完成。" },
    })
  })

  it("rejects starting an already running conversation", () => {
    expect(canStartConversationRun({ a: running(1) }, "a")).toBe(false)
  })

  it("rejects a fourth run at the default concurrency limit", () => {
    const states = { a: running(1), b: running(2), c: running(3) }
    expect(canStartConversationRun(states, "d")).toBe(false)
  })
})
