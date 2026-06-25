/**
 * extractSingleCharacter 单元测试（fix/character-reextract-and-loading-state）
 *
 * 覆盖关键修复：
 *   - simple 模式不再依赖外部 `_llmCall` 注入，
 *     内部用 `streamChat` 调用 LLM，避免走 `defaultLlmCall` 抛错。
 *   - 当 LLM 抛错时（mock streamChat reject），函数会 throw 让上层 toast 错误。
 */

import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(async () => ""),
  writeFile: vi.fn(async () => undefined),
}))

// mock streamChat：第一组调用 reject，第二组调用 resolve 一个有效 profile
const streamChatMock = vi.fn()
vi.mock("@/lib/llm-client", () => ({
  streamChat: (...args: unknown[]) => streamChatMock(...args),
}))

vi.mock("./simple-extraction-engine", () => ({
  extractSingleProfile: vi.fn(async ({ _llmCall }: any) => {
    // 模拟 simple-extraction-engine：调用 _llmCall 解析
    const raw = await _llmCall("test prompt")
    let profile
    try {
      const parsed = JSON.parse(raw)
      profile = {
        personality: parsed.personality || "",
        motivation: parsed.motivation || "",
        speechStyle: parsed.speechStyle || "",
        behaviorPatterns: parsed.behaviorPatterns || "",
        quotes: parsed.quotes || [],
      }
    } catch {
      profile = {
        personality: raw.slice(0, 200).trim(),
        motivation: "",
        speechStyle: "",
        behaviorPatterns: "",
        quotes: [],
      }
    }
    return { name: "林烬", profile, error: undefined, errorKind: undefined }
  }),
}))

import { extractSingleCharacter } from "./character-extraction-engine"
import type { ExtractedCharacter } from "./types"
import type { LlmConfig } from "@/stores/wiki-store"

const fakeLlmConfig: LlmConfig = {
  provider: "openai",
  apiKey: "test-key",
  model: "gpt-4o-mini",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 8000,
}

const fakeCharacter: ExtractedCharacter = {
  id: "char-linjing",
  name: "林烬",
  aliases: [],
  importance: 9,
  category: "protagonist",
  firstAppearance: 1,
  lastAppearance: 3,
  appearanceCount: 3,
  description: "旧城巡夜人",
  personality: "克制",
  speechStyle: "短句",
  relationships: [],
  keyEvents: [],
  corpus: "示例语料",
}

beforeEach(() => {
  streamChatMock.mockReset()
})

describe("extractSingleCharacter (fix/character-reextract-and-loading-state)", () => {
  it("simple 模式内部直接调用 LLM（不再依赖外部 _llmCall 注入）", async () => {
    streamChatMock.mockImplementationOnce(async (_cfg, _msgs, handlers: any) => {
      // 模拟流式：onToken 推一段 JSON
      handlers.onToken(
        JSON.stringify({
          name: "林烬",
          personality: "冷静",
          motivation: "守护",
          speechStyle: "简短",
          behaviorPatterns: "克制",
          quotes: ["台词1"],
        }),
      )
      handlers.onDone()
    })

    const result = await extractSingleCharacter({
      bookPath: "E:/Novel/book-analysis/book-1",
      bookId: "book-1",
      character: fakeCharacter,
      mode: "simple",
      llmConfig: fakeLlmConfig,
    })

    // 关键断言：streamChat 至少被调用一次（说明走了真实 LLM 路径，不是 defaultLlmCall 抛错）
    expect(streamChatMock).toHaveBeenCalled()
    expect(result.character.personalityProfile?.personality).toBe("冷静")
    // 清掉 6 维旧数据
    expect(result.character.sixDimensionResearch).toBeUndefined()
    expect(result.character.sixDimensionMeta).toBeUndefined()
  })

  it("simple 模式下 LLM 抛错时，extractSingleCharacter 抛出包含错误信息的 Error", async () => {
    // 模拟 simple-extraction-engine 内部 catch 返回 { error: "..." }
    const { extractSingleProfile } = await import("./simple-extraction-engine")
    ;(extractSingleProfile as any).mockImplementationOnce(async () => ({
      name: "林烬",
      profile: {
        personality: "",
        motivation: "",
        speechStyle: "",
        behaviorPatterns: "",
        quotes: [],
      },
      error: "defaultLlmCall not implemented in this context",
      errorKind: "unknown",
    }))

    await expect(
      extractSingleCharacter({
        bookPath: "E:/Novel/book-analysis/book-1",
        bookId: "book-1",
        character: fakeCharacter,
        mode: "simple",
        llmConfig: fakeLlmConfig,
      }),
    ).rejects.toThrow(/简单提取失败/)
  })
})
