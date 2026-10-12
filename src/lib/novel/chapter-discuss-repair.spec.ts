import { describe, expect, it } from "vitest"
import type { streamChat } from "@/lib/llm-client"
import {
  CHAPTER_DISCUSS_MARKER_CLOSE,
  CHAPTER_DISCUSS_MARKER_OPEN,
  parseChapterDiscussProtocol,
  validateChapterDiscussProtocol,
} from "./chapter-discuss-protocol"
import { repairChapterDiscussProtocolWithAi } from "./chapter-discuss-repair"

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
