import { describe, expect, it } from "vitest"
import type { streamChat } from "@/lib/llm-client"
import {
  CHAPTER_DISCUSS_MARKER_CLOSE,
  CHAPTER_DISCUSS_MARKER_OPEN,
  parseChapterDiscussProtocol,
  validateChapterDiscussProtocol,
} from "./chapter-discuss-protocol"
import { repairChapterDiscussProtocolWithAi, resolveChapterDiscussProtocol } from "./chapter-discuss-repair"

type StreamFn = typeof streamChat

function validReply(): string {
  return [
    "关键判断：前三章已经把仇怨铺满，第三章需要一个爆发点。",
    CHAPTER_DISCUSS_MARKER_OPEN,
    JSON.stringify({
      status: "needs_choice",
      module: "第3章",
      judgment: "需要一个爆发点",
      directions: [
        { id: "d1", storyType: "复仇线", title: "血债血偿", summary: "前".repeat(200) },
        { id: "d2", storyType: "悬念反转", title: "真凶另有其人", summary: "前".repeat(200) },
        { id: "d3", storyType: "情感升温", title: "并肩之夜", summary: "前".repeat(200) },
      ],
      preferenceId: "d1",
      preferenceReason: "最贴合前文伏笔",
    }),
    CHAPTER_DISCUSS_MARKER_CLOSE,
  ].join("\n")
}

function makeStream(reply: string, failWith?: Error) {
  const calls: Array<{ overrides: unknown; messages: unknown }> = []
  const stream = (async (
    _config: unknown,
    messages: unknown,
    callbacks: { onToken: (t: string) => void; onDone: () => void; onError: (e: Error) => void },
    _signal: unknown,
    overrides: unknown,
  ) => {
    calls.push({ overrides, messages })
    if (failWith) {
      callbacks.onError(failWith)
      return
    }
    callbacks.onToken(reply)
    callbacks.onDone()
  }) as unknown as StreamFn
  return { stream, calls }
}

const llmConfig = {} as Parameters<StreamFn>[0]
const signal = new AbortController().signal

describe("repairChapterDiscussProtocolWithAi", () => {
  it("turns a prose-only reply into a usable protocol", async () => {
    const { stream } = makeStream(validReply())
    const repaired = await repairChapterDiscussProtocolWithAi({
      content: "一".repeat(200),
      module: "第3章",
      llmConfig,
      signal,
      stream,
    })
    const parsed = parseChapterDiscussProtocol(repaired)
    expect(parsed.kind).toBe("valid")
    if (parsed.kind !== "valid") return
    expect(validateChapterDiscussProtocol(parsed.protocol).kind).toBe("needs_choice")
  })

  it("uses deterministic overrides on the fifth stream argument", async () => {
    const { stream, calls } = makeStream(validReply())
    await repairChapterDiscussProtocolWithAi({
      content: "一".repeat(200),
      module: "第3章",
      llmConfig,
      signal,
      stream,
    })
    expect(calls[0].overrides).toEqual({ temperature: 0, max_tokens: 4000 })
  })

  it("rethrows the upstream error instead of faking an empty repair", async () => {
    const { stream } = makeStream("", new Error("boom"))
    await expect(repairChapterDiscussProtocolWithAi({
      content: "一".repeat(200),
      module: "第3章",
      llmConfig,
      signal,
      stream,
    })).rejects.toThrow("boom")
  })
})

// ---------------------------------------------------------------------------
// 「一次重试 + 降级放行」：用户实测「介绍不足 180 字 → 整轮共创作废、前面问答全丢」
// ---------------------------------------------------------------------------

/** 一份解析得通、但 d2 的介绍只有 10 个字（闸门会判 invalid）的协议。 */
function thinReply(): string {
  return [
    CHAPTER_DISCUSS_MARKER_OPEN,
    JSON.stringify({
      status: "needs_choice",
      module: "第3章",
      judgment: "需要一个爆发点",
      directions: [
        { id: "d1", storyType: "复仇线", title: "血债血偿", summary: "前".repeat(200) },
        { id: "d2", storyType: "悬念反转", title: "直接点出老礼官就是常不疑", summary: "短介绍" },
        { id: "d3", storyType: "情感升温", title: "并肩之夜", summary: "前".repeat(200) },
      ],
      preferenceId: "d1",
      preferenceReason: "最贴合前文伏笔",
    }),
    CHAPTER_DISCUSS_MARKER_CLOSE,
  ].join("\n")
}

describe("resolveChapterDiscussProtocol", () => {
  const base = { module: "第3章", llmConfig, signal }

  it("协议本来就合格时不做任何额外调用", async () => {
    let repairCalls = 0
    let topUpCalls = 0
    const gate = await resolveChapterDiscussProtocol({
      ...base,
      text: validReply(),
      repair: async () => { repairCalls += 1; return "" },
      topUp: async () => { topUpCalls += 1; return "" },
    })
    expect(gate.protocol?.directions).toHaveLength(3)
    expect(gate.notice).toBe("")
    expect(gate.error).toBe("")
    expect([repairCalls, topUpCalls]).toEqual([0, 0])
  })

  it("介绍过短时先补齐一轮：补齐成功就用补齐后的协议", async () => {
    let topUpCalls = 0
    const gate = await resolveChapterDiscussProtocol({
      ...base,
      text: thinReply(),
      repair: async () => "",
      topUp: async ({ protocol, error }) => {
        topUpCalls += 1
        expect(error).toContain("后续介绍过短")
        expect(protocol?.directions[1].title).toBe("直接点出老礼官就是常不疑")
        return validReply()
      },
    })
    expect(topUpCalls).toBe(1)
    expect(gate.notice).toBe("")
    expect(gate.protocol?.directions.map((d) => d.title)).toEqual(["血债血偿", "真凶另有其人", "并肩之夜"])
  })

  it("补齐后仍不合格就降级放行：卡片照给、只留一句说明，绝不报错丢内容", async () => {
    const gate = await resolveChapterDiscussProtocol({
      ...base,
      text: thinReply(),
      repair: async () => "",
      topUp: async () => thinReply(),
    })
    expect(gate.error).toBe("")
    expect(gate.protocol?.directions).toHaveLength(3)
    expect(gate.protocol?.directions[1].summary).toBe("短介绍")
    expect(gate.notice).toContain("已按现有内容展示")
    expect(gate.notice).toContain("后续介绍过短")
  })

  it("补齐调用自己抛错时同样降级放行（不把异常抛给调用方）", async () => {
    const gate = await resolveChapterDiscussProtocol({
      ...base,
      text: thinReply(),
      repair: async () => "",
      topUp: async () => { throw new Error("network down") },
    })
    expect(gate.error).toBe("")
    expect(gate.protocol?.directions).toHaveLength(3)
    expect(gate.notice).toContain("已按现有内容展示")
  })

  it("完全没有协议块时先补协议；补出来的合格就用它", async () => {
    let repairCalls = 0
    const gate = await resolveChapterDiscussProtocol({
      ...base,
      text: "一".repeat(200),
      repair: async () => { repairCalls += 1; return validReply() },
      topUp: async () => "",
    })
    expect(repairCalls).toBe(1)
    expect(gate.protocol?.directions).toHaveLength(3)
    expect(gate.error).toBe("")
  })

  it("补协议也拿不到内容时才返回 error，由调用方保留正文", async () => {
    const gate = await resolveChapterDiscussProtocol({
      ...base,
      text: "一".repeat(200),
      repair: async () => "",
      topUp: async () => "",
    })
    expect(gate.protocol).toBeNull()
    expect(gate.notice).toBe("")
    expect(gate.error).toContain("未返回 chapter_discuss 协议块")
  })

  it("协议块存在但 JSON 坏了：再重建一次，成功就用重建的协议", async () => {
    const broken = [CHAPTER_DISCUSS_MARKER_OPEN, '{"status":"needs_choice","directions":[{"id":"d1"', CHAPTER_DISCUSS_MARKER_CLOSE].join("\n")
    let topUpCalls = 0
    const gate = await resolveChapterDiscussProtocol({
      ...base,
      text: broken,
      repair: async () => "",
      topUp: async ({ protocol, content }) => {
        topUpCalls += 1
        expect(protocol).toBeNull()
        expect(content).toContain("chapter_discuss")
        return validReply()
      },
    })
    expect(topUpCalls).toBe(1)
    expect(gate.error).toBe("")
    expect(gate.protocol?.directions).toHaveLength(3)
  })

  it("回复太短（没什么可补）时不浪费一次调用", async () => {
    let repairCalls = 0
    const gate = await resolveChapterDiscussProtocol({
      ...base,
      text: "好的",
      repair: async () => { repairCalls += 1; return "" },
      topUp: async () => "",
    })
    expect(repairCalls).toBe(0)
    expect(gate.protocol).toBeNull()
    expect(gate.error).toContain("未返回")
  })
})
