import { describe, expect, it } from "vitest"
import {
  CONTINUATION_EMPTY_INSTRUCTION,
  CONTINUATION_SOURCE_HEAD_CHARS,
  CONTINUATION_SOURCE_LIMIT_CHARS,
  CONTINUATION_SOURCE_TAIL_CHARS,
  CONTINUATION_TARGET_MAX_CHARS,
  CONTINUATION_TARGET_MIN_CHARS,
  buildContinuationMessages,
  buildContinuationSource,
} from "./continuation"

describe("buildContinuationSource", () => {
  it("不超过上限时原样送模", () => {
    const body = "　　他推开门。"
    expect(buildContinuationSource(body)).toBe(body)
  })

  it("恰好等于上限时不截断", () => {
    const body = "乙".repeat(CONTINUATION_SOURCE_LIMIT_CHARS)
    expect(buildContinuationSource(body)).toBe(body)
  })

  it("超过上限只送开头 + 省略标记 + 结尾", () => {
    const body = "甲".repeat(CONTINUATION_SOURCE_LIMIT_CHARS + 100)
    const source = buildContinuationSource(body)
    expect(source.startsWith("甲".repeat(CONTINUATION_SOURCE_HEAD_CHARS))).toBe(true)
    expect(source.endsWith("甲".repeat(CONTINUATION_SOURCE_TAIL_CHARS))).toBe(true)
    expect(source).toContain("省略")
    expect(source.length).toBeLessThan(body.length)
  })
})

describe("buildContinuationMessages", () => {
  it("两条消息，system 写清目标字数与「只输出续写的正文」", () => {
    const messages = buildContinuationMessages("　　他推开门。", "")
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe("system")
    expect(messages[0].content).toContain(String(CONTINUATION_TARGET_MIN_CHARS))
    expect(messages[0].content).toContain(String(CONTINUATION_TARGET_MAX_CHARS))
    expect(messages[0].content).toContain("只输出续写的正文")
    expect(messages[1].role).toBe("user")
  })

  it("正文进 user 消息", () => {
    const messages = buildContinuationMessages("　　雨还在下。", "")
    expect(messages[1].content).toContain("　　雨还在下。")
  })

  it("指令为空时用「自行判断」，不留空白", () => {
    const messages = buildContinuationMessages("正文", "   ")
    expect(messages[1].content).toContain(CONTINUATION_EMPTY_INSTRUCTION)
  })

  it("指令非空时原样进 user 消息，且不出现「自行判断」", () => {
    const messages = buildContinuationMessages("正文", "让他发现门没锁")
    expect(messages[1].content).toContain("让他发现门没锁")
    expect(messages[1].content).not.toContain(CONTINUATION_EMPTY_INSTRUCTION)
  })

  it("正文为空时改成「从章首开始写」", () => {
    const messages = buildContinuationMessages("", "开场")
    expect(messages[1].content).toContain("本章正文为空")
  })
})
