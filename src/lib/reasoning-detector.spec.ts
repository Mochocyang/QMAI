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

  it("extracts DeepSeek delta.reasoning_content", () => {
    const line = 'data: {"choices":[{"delta":{"reasoning_content":"先读大纲再写"}}]}'

    expect(extractReasoningTextFromLine(line)).toEqual(["先读大纲再写"])
    expect(countReasoningCharsInLine(line)).toBe("先读大纲再写".length)
  })

  it("extracts message.reasoning_content from final non-delta chunks", () => {
    const line = 'data: {"choices":[{"message":{"role":"assistant","content":"正文","reasoning_content":"整包思考"}}]}'

    expect(extractReasoningTextFromLine(line)).toEqual(["整包思考"])
  })

  it("extracts reasoning_content even when the same line also has tool_calls", () => {
    const line = 'data: {"choices":[{"delta":{"reasoning_content":"调用工具","tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_chapter","arguments":"{}"}}]}}]}'

    expect(extractReasoningTextFromLine(line)).toEqual(["调用工具"])
  })
})
