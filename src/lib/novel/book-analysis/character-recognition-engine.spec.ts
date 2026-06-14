import { describe, it, expect } from "vitest"
import { heuristicRecognizeCharacters, llmScoreCharacters, type HeuristicInput, type LlmScoringInput } from "./character-recognition-engine"
import { vi } from "vitest"

describe("heuristicRecognizeCharacters", () => {
  it("按出场章节数统计名字频次", () => {
    const input: HeuristicInput = {
      chapters: [
        { index: 0, content: "许七安走在街上，临安公主从后面追来。" },
        { index: 1, content: "许七安进入皇宫，许七安向皇帝行礼。" },
        { index: 2, content: "路人甲问路，许七安指路。" },
      ],
      minChapters: 2,
    }
    const result = heuristicRecognizeCharacters(input)
    expect(result.length).toBeGreaterThan(0)
    const xu = result.find((r) => r.name === "许七安")
    expect(xu).toBeDefined()
    expect(xu!.appearances).toBeGreaterThanOrEqual(3)  // 3 章都有
    expect(xu!.chapterIndices).toEqual([0, 1, 2])
  })

  it("次要角色低于 minChapters 阈值不出现", () => {
    const input: HeuristicInput = {
      chapters: [
        { index: 0, content: "许七安出门。" },
        { index: 1, content: "许七安回府，路人甲问路。" },
      ],
      minChapters: 2,
    }
    const result = heuristicRecognizeCharacters(input)
    expect(result.find((r) => r.name === "许七安")).toBeDefined()
    expect(result.find((r) => r.name === "路人甲")).toBeUndefined()
  })

  it("空章节返回空数组", () => {
    const input: HeuristicInput = { chapters: [], minChapters: 2 }
    expect(heuristicRecognizeCharacters(input)).toEqual([])
  })
})

describe("llmScoreCharacters", () => {
  it("调用 LLM 1 次并覆盖启发式分数", async () => {
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify([
      { name: "许七安", importanceScore: 95, category: "主角", aliases: ["许七"] },
      { name: "路人甲", importanceScore: 20, category: "次要", aliases: [] },
    ]))

    const input: LlmScoringInput = {
      candidates: [
        { id: "1", name: "许七安", aliases: [], appearances: 3, chapterIndices: [0, 1, 2], importanceScore: 30, category: "次要", sourceBook: "" },
        { id: "2", name: "路人甲", aliases: [], appearances: 2, chapterIndices: [1, 3], importanceScore: 20, category: "次要", sourceBook: "" },
      ],
      chapters: [{ index: 0, content: "..." }],
      llmConfig: { endpoint: "mock", model: "mock" },
      _llmCall: llmCall,
    }

    const result = await llmScoreCharacters(input)
    expect(llmCall).toHaveBeenCalledTimes(1)
    const xu = result.scored.find((r) => r.name === "许七安")
    expect(xu!.importanceScore).toBe(95)
    expect(xu!.category).toBe("主角")
  })

  it("LLM 失败时回退到启发式分数", async () => {
    const llmCall = vi.fn().mockRejectedValue(new Error("network error"))
    const result = await llmScoreCharacters({
      candidates: [
        { id: "1", name: "A", aliases: [], appearances: 5, chapterIndices: [0], importanceScore: 50, category: "配角", sourceBook: "" },
      ],
      chapters: [{ index: 0, content: "x" }],
      llmConfig: { endpoint: "mock", model: "mock" },
      _llmCall: llmCall,
    })
    expect(result.scored[0].importanceScore).toBe(50)  // 保持启发式分数
    expect(result.scored[0].category).toBe("配角")
  })
})
