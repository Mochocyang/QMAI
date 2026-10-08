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

const { analyzeSixDimensionsMock } = vi.hoisted(() => ({
  analyzeSixDimensionsMock: vi.fn(async ({ character }: any) => ({ character })),
}))
vi.mock("./six-dimension-engine", () => ({
  analyzeSixDimensions: (input: unknown) => analyzeSixDimensionsMock(input),
  DEPTH_DESCRIPTIONS: {
    fast: { label: "快速" },
    standard: { label: "标准" },
    deep: { label: "深入" },
  },
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

import { readFile } from "@/commands/fs"
import { extractCharactersFromChapters, extractSingleCharacter } from "./character-extraction-engine"
import type { ExtractedCharacter, RecognizedCharacter } from "./types"
import type { ChatMessage, ContentBlock } from "@/lib/llm-providers"
import type { LlmConfig } from "@/stores/wiki-store"

/**
 * 收窄消息 content 为内容块数组。`ChatMessage["content"]` 是
 * `string | ContentBlock[]` 的联合，直接取下标读 `.text` 不合法；
 * 调用方先断言数组形态，这里只做收窄，遇到字符串会让用例失败而不是静默跳过。
 */
function asContentBlocks(content: ChatMessage["content"]): ContentBlock[] {
  if (!Array.isArray(content)) throw new Error("expected ContentBlock[] content")
  return content
}

/**
 * 断言并收窄为文本块。ContentBlock 是 text | image 的可辨识联合，
 * 直接读 .text 不合法；这里先断言再收窄，遇到图片块会让用例失败而不是静默跳过。
 */
function expectTextBlock(block: ContentBlock): Extract<ContentBlock, { type: "text" }> {
  expect(block.type).toBe("text")
  if (block.type !== "text") throw new Error("expected a text content block")
  return block
}

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
  analyzeSixDimensionsMock.mockClear()
})

describe("extractCharactersFromChapters 目标角色约束", () => {
  it("只深度分析并执行六维分析用户勾选的角色", async () => {
    vi.mocked(readFile).mockImplementation(async (path: string) => {
      const order = path.includes("chapter-2") ? 2 : 1
      return `---\ntitle: 第${order}章\norder: ${order}\n---\n林烬与乌鸦同时出现。`
    })
    streamChatMock.mockImplementation(async (_cfg, messages: ChatMessage[], handlers: any) => {
      const content = messages[0].content
      const text = typeof content === "string"
        ? content
        : content.map((block) => (block.type === "text" ? block.text : "")).join("")
      expect(text).toContain('角色"林烬"')
      expect(Array.isArray(content)).toBe(true)
      const firstBlock = expectTextBlock(asContentBlocks(content)[0])
      expect(firstBlock).toMatchObject({ cacheControl: true })
      expect(firstBlock.text).not.toContain('角色"林烬"')
      handlers.onRequestTrace?.({ requestId: "details" })
      handlers.onToken(JSON.stringify({
        name: "林烬",
        category: "protagonist",
        personality: "冷静",
      }))
      handlers.onDone()
    })
    const selected: RecognizedCharacter = {
      id: "char-linjing",
      name: "林烬",
      aliases: [],
      appearances: 2,
      chapterIndices: [0, 1],
      importanceScore: 90,
      category: "主角",
      sourceBook: "book-1",
    }

    const onRequestTrace = vi.fn()
    const result = await extractCharactersFromChapters({
      onRequestTrace,
      bookPath: "E:/Novel/book-analysis/book-1",
      selectedChapterIds: ["chapter-1", "chapter-2"],
      llmConfig: fakeLlmConfig,
      depth: "standard",
      targetCharacters: [selected],
    })

    expect(onRequestTrace).toHaveBeenCalledWith({ requestId: "details" })
    expect(analyzeSixDimensionsMock.mock.calls[0][0].onRequestTrace).toBe(onRequestTrace)
    expect(streamChatMock).toHaveBeenCalledTimes(1)
    expect(analyzeSixDimensionsMock).toHaveBeenCalledTimes(1)
    expect(analyzeSixDimensionsMock.mock.calls[0][0].character.name).toBe("林烬")
    expect(result.characters.map((character) => character.name)).toEqual(["林烬"])
  })
})

describe("extractCharactersFromChapters 角色识别失败处理", () => {
  it("模型未返回重要度时仍按默认重要角色继续提取", async () => {
    vi.mocked(readFile).mockResolvedValue("---\ntitle: 第一章\norder: 1\n---\n林烬推门而入。")
    streamChatMock
      .mockImplementationOnce(async (_cfg, _messages, handlers: any) => {
        handlers.onToken(JSON.stringify({ characters: [{ name: "林烬", aliases: [] }] }))
        handlers.onDone()
      })
      .mockImplementationOnce(async (_cfg, _messages, handlers: any) => {
        handlers.onToken(JSON.stringify({ name: "林烬", category: "protagonist", personality: "冷静" }))
        handlers.onDone()
      })

    const result = await extractCharactersFromChapters({
      bookPath: "E:/Novel/book-analysis/book-1",
      selectedChapterIds: ["chapter-1"],
      llmConfig: fakeLlmConfig,
      depth: "fast",
      persistResults: false,
    })

    expect(result.characters.map((item) => item.name)).toEqual(["林烬"])
  })

  it("角色识别请求失败时跳过该章并仍返回成功（空结果）", async () => {
    vi.mocked(readFile).mockResolvedValue("---\ntitle: 第一章\norder: 1\n---\n林烬推门而入。")
    streamChatMock.mockImplementationOnce(async (_cfg, _messages, handlers: any) => {
      handlers.onError(new Error("模型连接失败"))
    })

    const result = await extractCharactersFromChapters({
      bookPath: "E:/Novel/book-analysis/book-1",
      selectedChapterIds: ["chapter-1"],
      llmConfig: fakeLlmConfig,
      depth: "fast",
      persistResults: false,
    })

    expect(result.success).toBe(true)
    expect(result.characters).toEqual([])
    expect(result.warnings?.some((item) => item.includes("角色识别失败"))).toBe(true)
  })

  it("单个角色详情失败时跳过该角色并保留其他成功结果", async () => {
    vi.mocked(readFile).mockResolvedValue("---\ntitle: 第一章\norder: 1\n---\n林烬与顾司玥同行。")
    streamChatMock.mockImplementation(async (_cfg, messages: ChatMessage[], handlers: any) => {
      const content = messages[0]?.content ?? ""
      const prompt = typeof content === "string"
        ? content
        : content.map((block) => (block.type === "text" ? block.text : "")).join("")
      if (prompt.includes('角色"顾司玥"')) {
        handlers.onError(new Error("JSON Parse error: Unterminated string"))
        return
      }
      handlers.onToken(JSON.stringify({
        name: "林烬",
        category: "protagonist",
        personality: "冷静",
      }))
      handlers.onDone()
    })

    const result = await extractCharactersFromChapters({
      bookPath: "E:/Novel/book-analysis/book-1",
      selectedChapterIds: ["chapter-1"],
      llmConfig: fakeLlmConfig,
      depth: "fast",
      persistResults: false,
      targetCharacters: [
        {
          id: "char-linjing",
          name: "林烬",
          aliases: [],
          appearances: 1,
          chapterIndices: [0],
          importanceScore: 90,
          category: "主角",
          sourceBook: "book-1",
        },
        {
          id: "char-guyue",
          name: "顾司玥",
          aliases: [],
          appearances: 1,
          chapterIndices: [0],
          importanceScore: 80,
          category: "主角",
          sourceBook: "book-1",
        },
      ],
    })

    expect(result.success).toBe(true)
    expect(result.characters.map((item) => item.name)).toEqual(["林烬"])
    expect(result.warnings?.some((item) => item.includes("顾司玥"))).toBe(true)
  })
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
    expect(streamChatMock.mock.calls[0][1]).toEqual([{ role: "user", content: "test prompt" }])
    expect(result.character.personalityProfile?.personality).toBe("冷静")
    // 清掉 6 维旧数据
    expect(result.character.sixDimensionResearch).toBeUndefined()
    expect(result.character.sixDimensionMeta).toBeUndefined()
  })

  it("simple 模式下 LLM 抛错时，extractSingleCharacter 抛出包含错误信息的 Error", async () => {
    // 模拟 simple-extraction-engine 内部 catch 返回 { error: "..." }
    const { extractSingleProfile } = await import("./simple-extraction-engine")
    vi.mocked(extractSingleProfile).mockImplementationOnce(async () => ({
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


describe("simple 模式实际缓存消息", () => {
  it("真实单人引擎经包装调用 streamChat，两个角色共享完整缓存块且只在末块换人", async () => {
    const { extractSingleProfile } = await import("./simple-extraction-engine")
    const actual = await vi.importActual<typeof import("./simple-extraction-engine")>("./simple-extraction-engine")
    const chapterSamples = "共同章节材料。".repeat(3000)
    const signal = new AbortController().signal

    for (const name of ["Actor_A", "Actor_B"]) {
      vi.mocked(extractSingleProfile).mockImplementationOnce(actual.extractSingleProfile)
      streamChatMock.mockImplementationOnce(async (_cfg, _messages, handlers) => {
        handlers.onToken(JSON.stringify([{
          name, personality: "冷静", motivation: "守护", speechStyle: "简短",
          behaviorPatterns: "克制", quotes: ["台词1", "台词2", "台词3"],
        }]))
        handlers.onDone()
      })
      const result = await extractSingleCharacter({
        bookPath: "E:/Novel/book-analysis/book-1", bookId: "book-1",
        character: { ...fakeCharacter, name, corpus: chapterSamples },
        mode: "simple", llmConfig: fakeLlmConfig, signal,
      })
      expect(result.character.personalityProfile?.quotes).toHaveLength(3)
    }

    expect(streamChatMock).toHaveBeenCalledTimes(2)
    const firstMessages = streamChatMock.mock.calls[0][1]
    const secondMessages = streamChatMock.mock.calls[1][1]
    expect(firstMessages).toHaveLength(1)
    expect(firstMessages[0].role).toBe("user")
    expect(Array.isArray(firstMessages[0].content)).toBe(true)
    const [prefix, suffix] = firstMessages[0].content
    expect(firstMessages[0].content).toHaveLength(2)
    expect(prefix.type).toBe("text")
    expect(prefix.cacheControl).toBe(true)
    expect(prefix).not.toHaveProperty("cache_control")
    expect(prefix.text.includes(chapterSamples)).toBe(true)
    expect(prefix.text).not.toContain("# 角色列表")
    expect(prefix.text).not.toContain("Actor_A")
    expect(prefix.text).not.toContain("Actor_B")
    expect(prefix).toEqual(secondMessages[0].content[0])
    expect(suffix).toEqual({ type: "text", text: "\n\n# 角色列表\n- Actor_A" })
    expect(secondMessages[0].content[1]).toEqual({ type: "text", text: "\n\n# 角色列表\n- Actor_B" })
    for (const call of streamChatMock.mock.calls) {
      expect(call).toHaveLength(4)
      expect(call[0]).toBe(fakeLlmConfig)
      expect(call[3]).toBe(signal)
    }
  })

  it("章节原文包含同名角色列表分隔符时不误切缓存材料", async () => {
    const { extractSingleProfile } = await import("./simple-extraction-engine")
    const actual = await vi.importActual<typeof import("./simple-extraction-engine")>("./simple-extraction-engine")
    vi.mocked(extractSingleProfile).mockImplementationOnce(actual.extractSingleProfile)
    const chapterSamples = "原文开头\n\n# 角色列表\n- 原文人物\n😀原文结尾\n"
    streamChatMock.mockImplementationOnce(async (_cfg, _messages, handlers) => {
      handlers.onToken(JSON.stringify([{ name: fakeCharacter.name, personality: "冷静", quotes: [] }]))
      handlers.onDone()
    })

    await extractSingleCharacter({
      bookPath: "E:/Novel/book-analysis/book-1", bookId: "book-1",
      character: { ...fakeCharacter, corpus: chapterSamples }, mode: "simple", llmConfig: fakeLlmConfig,
    })

    const content = streamChatMock.mock.calls[0][1][0].content
    expect(Array.isArray(content)).toBe(true)
    expect(content[0].text.endsWith(chapterSamples)).toBe(true)
    expect(content[0].cacheControl).toBe(true)
    expect(content[1]).toEqual({ type: "text", text: `\n\n# 角色列表\n- ${fakeCharacter.name}` })
  })
})
