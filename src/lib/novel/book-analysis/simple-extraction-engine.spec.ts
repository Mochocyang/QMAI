import { describe, it, expect, vi } from "vitest"
import { extractSimpleProfiles, type SimpleExtractionInput } from "./simple-extraction-engine"
import type { RecognizedCharacter } from "./types"

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
      llmConfig: { endpoint: "mock", model: "mock" },
      // @ts-expect-error
      _llmCall: llmCall,
    } as SimpleExtractionInput)

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
      llmConfig: { endpoint: "mock", model: "mock" },
      // @ts-expect-error
      _llmCall: llmCall,
    } as SimpleExtractionInput)
    expect(result.error).toBeDefined()
    expect(result.profiles[0].profile).toEqual({
      personality: "", motivation: "", speechStyle: "", behaviorPatterns: "", quotes: [],
    })
  })
})
