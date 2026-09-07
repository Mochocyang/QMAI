import { describe, it, expect, vi } from "vitest"
import { extractSimpleProfiles, extractSingleProfile } from "./simple-extraction-engine"
import type { RecognizedCharacter } from "./types"
import type { LlmConfig } from "@/stores/wiki-store"

const stubLlmConfig: LlmConfig = {
  provider: "openai",
  apiKey: "x",
  model: "x",
  ollamaUrl: "http://127.0.0.1:1",
  customEndpoint: "http://127.0.0.1:1",
  maxContextSize: 8000,
}

describe("extractSimpleProfiles", () => {
  const candidates: RecognizedCharacter[] = [
    { id: "1", name: "许七安", aliases: [], appearances: 3, chapterIndices: [0, 1, 2], importanceScore: 95, category: "主角", sourceBook: "test" },
    { id: "2", name: "临安公主", aliases: [], appearances: 2, chapterIndices: [0, 1], importanceScore: 60, category: "配角", sourceBook: "test" },
  ]

  it("1 次 LLM 调用 + 输出每个角色的 profile", async () => {
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify([
      { name: "许七安", personality: "机智", motivation: "上位", speechStyle: "犀利", behaviorPatterns: "果断", quotes: ["q1", "q2", "q3"] },
      { name: "临安公主", personality: "温柔", motivation: "自由", speechStyle: "婉约", behaviorPatterns: "隐忍", quotes: ["q1", "q2", "q3"] },
    ]))

    const result = await extractSimpleProfiles({
      candidates,
      chapterSamples: "x",
      llmConfig: stubLlmConfig,
      _llmCall: llmCall,
    })

    expect(llmCall).toHaveBeenCalledTimes(1)
    expect(result.profiles).toHaveLength(2)
    expect(result.profiles[0].name).toBe("许七安")
    expect(result.profiles[0].profile.quotes).toHaveLength(3)
  })

  it("LLM 失败时每个角色返回空 profile + 标记 error", async () => {
    const llmCall = vi.fn().mockRejectedValue(new Error("fail"))
    const result = await extractSimpleProfiles({
      candidates,
      chapterSamples: "x",
      llmConfig: stubLlmConfig,
      _llmCall: llmCall,
    })
    expect(result.error).toBeDefined()
    expect(result.profiles[0].profile).toEqual({
      personality: "", motivation: "", speechStyle: "", behaviorPatterns: "", quotes: [],
    })
  })
})


describe("简单提取缓存参数与兼容性", () => {
  const chapterSamples = "共同章节材料。".repeat(3000)
  const character: RecognizedCharacter = {
    id: "actor-a", name: "Actor_A", aliases: [], appearances: 2,
    chapterIndices: [0, 1], importanceScore: 90, category: "主角", sourceBook: "测试作品",
  }
  const profile = {
    personality: "冷静但固执", motivation: "守护同伴", speechStyle: "简洁",
    behaviorPatterns: "先观察再行动", quotes: ["台词1", "台词2", "台词3", "台词4", "台词5", "台词6"],
  }

  it("批量调用通过第二参数传递完整公共材料而不缓存目标人物列表", async () => {
    const llmCall = vi.fn<(prompt: string, cachePrefix?: string) => Promise<string>>()
      .mockResolvedValue("[]")
    const candidates = [character, { ...character, id: "actor-b", name: "Actor_B" }]

    await extractSimpleProfiles({ candidates, chapterSamples, llmConfig: stubLlmConfig, _llmCall: llmCall })

    const [prompt, cachePrefix] = llmCall.mock.calls[0]
    expect(cachePrefix).toEqual(expect.any(String))
    expect(cachePrefix!.includes(chapterSamples)).toBe(true)
    expect(cachePrefix).not.toContain("# 角色列表")
    expect(cachePrefix).not.toContain("Actor_A")
    expect(cachePrefix).not.toContain("Actor_B")
    expect(prompt.startsWith(cachePrefix!)).toBe(true)
    expect(prompt.slice(cachePrefix!.length)).toContain("- Actor_A\n- Actor_B")
  })

  it("单人调用换人物不改变公共前缀，换材料则改变公共前缀", async () => {
    const llmCall = vi.fn<(prompt: string, cachePrefix?: string) => Promise<string>>()
      .mockResolvedValue("[]")
    for (const [name, samples] of [
      ["Actor_A", chapterSamples],
      ["Actor_B", chapterSamples],
      ["Actor_A", `${chapterSamples}新材料`],
    ]) {
      await extractSingleProfile({
        character: { ...character, name }, chapterSamples: samples,
        llmConfig: stubLlmConfig, _llmCall: llmCall,
      })
    }

    const firstPrefix = llmCall.mock.calls[0][1]
    expect(firstPrefix).toEqual(expect.any(String))
    expect(firstPrefix!.includes(chapterSamples)).toBe(true)
    expect(firstPrefix).toBe(llmCall.mock.calls[1][1])
    expect(firstPrefix).not.toBe(llmCall.mock.calls[2][1])
    expect(llmCall.mock.calls[2][1]!.endsWith(`${chapterSamples}新材料`)).toBe(true)
    expect(firstPrefix).not.toContain("# 角色列表")
    expect(firstPrefix).not.toContain("Actor_A")
    expect(firstPrefix).not.toContain("Actor_B")
    for (const field of ["name", "personality", "motivation", "speechStyle", "behaviorPatterns", "quotes"]) {
      expect(firstPrefix).toContain(`"${field}"`)
    }
  })

  it("单人物网络失败后显式重试复用同一前缀，保留错误分类和台词上限", async () => {
    const llmCall = vi.fn<(prompt: string, cachePrefix?: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValueOnce(JSON.stringify([{ name: character.name, ...profile }]))
    const input = { character, chapterSamples, llmConfig: stubLlmConfig, _llmCall: llmCall }

    const failed = await extractSingleProfile(input)
    expect(failed.errorKind).toBe("network")
    expect(failed.profile.quotes).toEqual([])
    expect(llmCall).toHaveBeenCalledTimes(1)

    const retried = await extractSingleProfile(input)
    expect(retried.error).toBeUndefined()
    expect(retried.profile).toEqual({ ...profile, quotes: profile.quotes.slice(0, 5) })
    expect(llmCall).toHaveBeenCalledTimes(2)
    expect(llmCall.mock.calls[0][1]).toEqual(expect.any(String))
    expect(llmCall.mock.calls[1]).toEqual(llmCall.mock.calls[0])
  })

  it("批量和单人调用继续兼容只接收一个 prompt 参数的旧回调", async () => {
    const legacyCallback = async (prompt: string): Promise<string> => {
      expect(prompt).toContain(chapterSamples)
      expect(prompt).toContain("- Actor_A")
      return `\`\`\`json\n${JSON.stringify([{ name: character.name, ...profile }])}\n\`\`\``
    }
    const onProgress = vi.fn()
    const batch = await extractSimpleProfiles({
      candidates: [character], chapterSamples, llmConfig: stubLlmConfig,
      _llmCall: legacyCallback, onProgress,
    })
    const single = await extractSingleProfile({
      character, chapterSamples, llmConfig: stubLlmConfig, _llmCall: legacyCallback,
    })

    expect(batch.error).toBeUndefined()
    expect(single.error).toBeUndefined()
    expect(batch.profiles[0].profile).toEqual(single.profile)
    expect(single.profile).toEqual({ ...profile, quotes: profile.quotes.slice(0, 5) })
    expect(onProgress).toHaveBeenCalledWith(1, 1)
  })
})
