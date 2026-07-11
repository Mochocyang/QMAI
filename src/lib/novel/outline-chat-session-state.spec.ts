import { describe, expect, it } from "vitest"
import {
  canApplyOutlineRunEffect,
  shouldClearOutlineDraft,
  setOutlineSessionValue,
} from "./outline-chat-session-state"

describe("AI 大纲多会话副作用隔离", () => {
  it("旧 run 不能修改新 run 的消息或流内容", () => {
    const states = { a: { status: "running" as const, updatedAt: 2, runId: "new" } }
    expect(canApplyOutlineRunEffect(states, "a", "old")).toBe(false)
    expect(canApplyOutlineRunEffect(states, "a", "new")).toBe(true)
  })

  it("后台 follow-up 不清除用户当前 B 会话草稿", () => {
    expect(shouldClearOutlineDraft({ clearDraft: true, invocationConversationId: "a", activeConversationId: "b" })).toBe(false)
    expect(shouldClearOutlineDraft({ clearDraft: false, invocationConversationId: "b", activeConversationId: "b" })).toBe(false)
    expect(shouldClearOutlineDraft({ clearDraft: true, invocationConversationId: "b", activeConversationId: "b" })).toBe(true)
  })

  it("A/B 质量修复目标分别保存在各自会话", () => {
    const a = setOutlineSessionValue({}, "a", { repairPrompt: "修复 A" })
    const both = setOutlineSessionValue(a, "b", { repairPrompt: "修复 B" })
    expect(both.a?.repairPrompt).toBe("修复 A")
    expect(both.b?.repairPrompt).toBe("修复 B")
    expect(setOutlineSessionValue(both, "a", null)).toEqual({ b: { repairPrompt: "修复 B" } })
  })

  it("A/B 大纲意图上下文互不覆盖", () => {
    const a = setOutlineSessionValue({}, "a", { title: "章节细纲", hint: "第一卷", outputMode: "per_chapter" })
    const both = setOutlineSessionValue(a, "b", { title: "人物小传", hint: "主角", outputMode: "per_item" })
    expect(both.a).toEqual({ title: "章节细纲", hint: "第一卷", outputMode: "per_chapter" })
    expect(both.b).toEqual({ title: "人物小传", hint: "主角", outputMode: "per_item" })
  })
})
