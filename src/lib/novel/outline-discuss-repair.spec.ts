import { describe, expect, it, vi } from "vitest"
import {
  OUTLINE_DISCUSS_MARKER_CLOSE,
  OUTLINE_DISCUSS_MARKER_OPEN,
  buildOutlineDiscussRepairMessages,
  buildOutlineDiscussRepairRequestOverrides,
  hasOutlineDiscussRepairableContent,
  parseOutlineDiscussProtocol,
  validateOutlineDiscussProtocol,
} from "./outline-discuss-protocol"
import { repairOutlineDiscussProtocolWithAi } from "./outline-discuss-repair"

/** 用户实测那一轮：模型吐了整卷大纲和写回清单，一个协议标记都没有。 */
const GENERATION_LEAK_REPLY = [
  "## 写回清单",
  "楚白实体目标字段「修复丹田」作废，改为「寻找父亲、守护妻子」。",
  "第1章补写：丹田位置异变、剧烈灼烧，意识进入识海再遇「高人一等」令牌。",
  "```json",
  JSON.stringify({ volumeOutlineData: { title: "修真界卷级架构", scope: "修真界部分（共三卷）" } }),
  "```",
].join("\n")

const VALID_PROTOCOL_REPLY = [
  "关键判断：现有卷纲的代价阶梯与主角目标不一致。",
  OUTLINE_DISCUSS_MARKER_OPEN,
  JSON.stringify({
    status: "needs_decision",
    module: "卷纲",
    judgment: "代价阶梯需要重排",
    nextStep: "先定代价",
    decisions: [{
      id: "d1",
      question: "代价来源选哪个",
      options: [
        { id: "A", label: "令牌吞噬", description: "与金手指绑定" },
        { id: "B", label: "血脉反噬", description: "与身世绑定" },
      ],
      preferenceId: "A",
      preferenceReason: "与已建立的令牌机制一致",
    }],
    agreed: [],
  }),
  OUTLINE_DISCUSS_MARKER_CLOSE,
].join("\n")

describe("hasOutlineDiscussRepairableContent", () => {
  it("只有实质内容才值得补协议，空回复或一句客套不该白花一次调用", () => {
    expect(hasOutlineDiscussRepairableContent("")).toBe(false)
    expect(hasOutlineDiscussRepairableContent("好的，我明白了。")).toBe(false)
    expect(hasOutlineDiscussRepairableContent("AI大纲未返回内容。")).toBe(false)
    expect(hasOutlineDiscussRepairableContent(GENERATION_LEAK_REPLY)).toBe(true)
  })

  it("已经带了协议块的回复不需要补（让闸门去报更准确的原因）", () => {
    expect(hasOutlineDiscussRepairableContent(VALID_PROTOCOL_REPLY)).toBe(false)
  })
})

describe("buildOutlineDiscussRepairMessages", () => {
  it("只要求补协议，并明确禁止重写或扩写正文", () => {
    const messages = buildOutlineDiscussRepairMessages({ content: "正文", module: "卷纲" })
    const text = messages[0].content
    expect(text).toContain("只做一件事")
    expect(text).toContain("不要重写、扩写或继续生成大纲正文")
    expect(text).toContain("转写")
    // 必须给出完整协议模板，否则修复轮同样可能缺字段
    expect(text).toContain(OUTLINE_DISCUSS_MARKER_OPEN)
    expect(text).toContain(OUTLINE_DISCUSS_MARKER_CLOSE)
    expect(text).toContain("needs_decision|ready")
    // 待修复的原文必须带进去
    expect(text).toContain("正文")
  })

  it("模板本身能被协议解析器接受（避免给出一个合不了法的模板）", () => {
    const messages = buildOutlineDiscussRepairMessages({ content: "x", module: "卷纲" })
    // 取模板行并替换成真实取值，验证解析器认得这个 schema
    const template = messages[0].content
      .split("\n")
      .find((line) => line.startsWith('{"status":"needs_decision|ready"'))!
    const usable = template.replace("needs_decision|ready", "ready")
    expect(parseOutlineDiscussProtocol(
      `${OUTLINE_DISCUSS_MARKER_OPEN}\n${usable}\n${OUTLINE_DISCUSS_MARKER_CLOSE}`,
    ).kind).toBe("valid")
  })
})

describe("buildOutlineDiscussRepairRequestOverrides", () => {
  it("格式转写用确定性采样，且 token 上限够放下一个协议块", () => {
    expect(buildOutlineDiscussRepairRequestOverrides()).toEqual({ temperature: 0, max_tokens: 1_600 })
    expect(buildOutlineDiscussRepairRequestOverrides(300)).toEqual({ temperature: 0, max_tokens: 300 })
  })
})

describe("repairOutlineDiscussProtocolWithAi", () => {
  const llmConfig = {} as Parameters<typeof repairOutlineDiscussProtocolWithAi>[0]["llmConfig"]

  it("把「只有正文」的回复补成可用协议（本次故障的修复目标）", async () => {
    const stream = vi.fn(async (
      _config: unknown,
      _messages: unknown,
      handlers: { onToken: (t: string) => void; onDone: () => void },
      _signal: unknown,
      _overrides: unknown,
    ) => {
      handlers.onToken(GENERATION_LEAK_REPLY)
      handlers.onToken(`\n${VALID_PROTOCOL_REPLY}`)
      handlers.onDone()
    })
    const text = await repairOutlineDiscussProtocolWithAi({
      content: GENERATION_LEAK_REPLY,
      module: "卷纲",
      llmConfig,
      signal: new AbortController().signal,
      stream: stream as never,
    })
    // 修复结果必须能被解析成合法协议（否则补这一次调用没有意义）
    const outcome = parseOutlineDiscussProtocol(text)
    expect(outcome.kind).toBe("valid")
    if (outcome.kind === "valid") {
      expect(validateOutlineDiscussProtocol(outcome.protocol).kind).toBe("needs_decision")
    }
    // 修复轮必须走确定性采样（streamChat(config, messages, handlers, signal, overrides)）
    expect(stream.mock.calls[0][4]).toEqual({ temperature: 0, max_tokens: 1_600 })
  })

  it("上游报错时抛出来，交给调用方降级（不能把失败伪装成空修复）", async () => {
    const stream = vi.fn(async (
      _config: unknown,
      _messages: unknown,
      handlers: { onError: (e: Error) => void },
      _signal: unknown,
      _overrides: unknown,
    ) => {
      handlers.onError(new Error("模型不可用"))
    })
    await expect(repairOutlineDiscussProtocolWithAi({
      content: GENERATION_LEAK_REPLY,
      module: "卷纲",
      llmConfig,
      signal: new AbortController().signal,
      stream: stream as never,
    })).rejects.toThrow("模型不可用")
  })
})
