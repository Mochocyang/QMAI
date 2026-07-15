import { describe, expect, it } from "vitest"
import {
  buildSessionContextSummary,
  isSessionSummaryFresh,
  selectContextHistoryMessages,
} from "./session-summary"

describe("session context summary", () => {
  it("builds a deterministic local summary without an LLM", () => {
    const input = {
      messages: [
        { role: "user", content: "主角不能提前知道真相。请继续第二章。" },
        { role: "assistant", content: "第二章将保留悬念，并让线索出现在旧车站。" },
      ],
      dependencies: { "E:/Novel/wiki/outlines/main.md": 2 },
    }

    const first = buildSessionContextSummary(input)
    const second = buildSessionContextSummary(input)

    expect(first.text).toContain("用户：主角不能提前知道真相")
    expect(first.text).toContain("助手：第二章将保留悬念")
    expect(first.text).toBe(second.text)
    expect(first.dependencies).toEqual(input.dependencies)
  })

  it("bounds long summaries deterministically", () => {
    const summary = buildSessionContextSummary({
      messages: [{ role: "user", content: "约束。".repeat(100) }],
      dependencies: {},
      maxChars: 80,
    })

    expect(summary.text.length).toBeLessThanOrEqual(80)
  })

  it("invalidates only when a recorded dependency revision changes", () => {
    const summary = buildSessionContextSummary({
      messages: [],
      dependencies: { outline: 2 },
    })

    expect(isSessionSummaryFresh(summary, { outline: 2, unrelated: 9 })).toBe(true)
    expect(isSessionSummaryFresh(summary, { outline: 3 })).toBe(false)
    expect(isSessionSummaryFresh(undefined, { outline: 2 })).toBe(false)
  })

  it("keeps only the latest two messages when a summary is already in system context", () => {
    const messages = [
      { role: "user", content: "第一问" },
      { role: "assistant", content: "第一答" },
      { role: "user", content: "第二问" },
      { role: "assistant", content: "第二答" },
    ]

    expect(selectContextHistoryMessages(messages, "会话摘要")).toEqual(messages.slice(-2))
    expect(selectContextHistoryMessages(messages, "")).toEqual(messages)
    expect(selectContextHistoryMessages(messages, undefined)).toEqual(messages)
  })
})
