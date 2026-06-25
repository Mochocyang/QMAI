import { describe, expect, it } from "vitest"
import { countReasoningCharsInLine, extractReasoningTextFromLine } from "./reasoning-detector"

describe("reasoning detector", () => {
  it("extracts OpenAI Responses reasoning summary deltas", () => {
    const line = 'data: {"type":"response.reasoning_summary_text.delta","delta":"正在分析章节上下文"}'

    expect(extractReasoningTextFromLine(line)).toEqual(["正在分析章节上下文"])
    expect(countReasoningCharsInLine(line)).toBe("正在分析章节上下文".length)
  })

  it("extracts OpenAI Responses reasoning text deltas", () => {
    const line = 'data: {"type":"response.reasoning_text.delta","delta":"先确认用户意图"}'

    expect(extractReasoningTextFromLine(line)).toEqual(["先确认用户意图"])
    expect(countReasoningCharsInLine(line)).toBe("先确认用户意图".length)
  })
})
