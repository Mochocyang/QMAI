import { describe, expect, it, vi } from "vitest"
import {
  buildIntentClarityRepairMessages,
  resolveIntentClarityProtocol,
} from "./outline-intent-repair"

const VALID = [
  "<!-- intent_clarity -->",
  JSON.stringify({ clarity: "clear", module: "卷纲", analysis: "需求已经明确", detectedScope: "第一卷" }),
  "<!-- /intent_clarity -->",
].join("\n")

const base = { module: "卷纲", llmConfig: {} as never, signal: new AbortController().signal }

describe("resolveIntentClarityProtocol", () => {
  it("协议合格时不做额外调用", async () => {
    const repair = vi.fn(async () => "")
    const gate = await resolveIntentClarityProtocol({ ...base, text: VALID, repair })
    expect(gate.outcome.kind).toBe("valid")
    expect(gate.repaired).toBe(false)
    expect(repair).not.toHaveBeenCalled()
  })

  it("只有正文没有协议时补一轮，补出来的合格就用它", async () => {
    const repair = vi.fn(async () => VALID)
    const gate = await resolveIntentClarityProtocol({ ...base, text: "一".repeat(200), repair })
    expect(repair).toHaveBeenCalledTimes(1)
    expect(gate.outcome.kind).toBe("valid")
    expect(gate.repaired).toBe(true)
  })

  it("补出来的还是垃圾就按原结果报错（正文仍由调用方保留）", async () => {
    const gate = await resolveIntentClarityProtocol({
      ...base,
      text: "一".repeat(200),
      repair: async () => "随便说两句",
    })
    expect(gate.outcome.kind).toBe("none")
    expect(gate.repaired).toBe(true)
  })

  it("补协议本身抛错时不把异常抛给调用方", async () => {
    const gate = await resolveIntentClarityProtocol({
      ...base,
      text: "一".repeat(200),
      repair: async () => { throw new Error("network down") },
    })
    expect(gate.outcome.kind).toBe("none")
    expect(gate.repaired).toBe(true)
  })

  it("回复太短时不发起修复", async () => {
    const repair = vi.fn(async () => VALID)
    const gate = await resolveIntentClarityProtocol({ ...base, text: "好的", repair })
    expect(repair).not.toHaveBeenCalled()
    expect(gate.outcome.kind).toBe("none")
  })
})

describe("buildIntentClarityRepairMessages", () => {
  it("要求只转写、不重写，并且拿不准就选 needs_input", () => {
    const [message] = buildIntentClarityRepairMessages({ content: "正文", module: "卷纲" })
    expect(message.content).toContain("不要重写")
    expect(message.content).toContain("needs_input")
    expect(message.content).toContain("<!-- intent_clarity -->")
  })
})
