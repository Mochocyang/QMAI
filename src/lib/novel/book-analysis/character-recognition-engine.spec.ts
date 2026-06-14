import { describe, it, expect } from "vitest"
import { heuristicRecognizeCharacters, type HeuristicInput } from "./character-recognition-engine"

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
