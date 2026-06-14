import { describe, expect, it } from "vitest"
import { buildGeneratedAuraInputFromBookCharacter } from "./aura-adapter"
import type { BookAnalysisMetadata, CharacterSkill, ExtractedCharacter } from "./types"

describe("buildGeneratedAuraInputFromBookCharacter", () => {
  it("maps extracted character data into custom soul fields", () => {
    const metadata: BookAnalysisMetadata = {
      title: "长夜书",
      totalChapters: 3,
      totalWords: 12000,
      sourceType: "file",
      createdAt: 1,
      updatedAt: 2,
    }
    const character: ExtractedCharacter = {
      id: "char-linjing",
      name: "林烬",
      aliases: ["林少"],
      importance: 9,
      category: "protagonist",
      firstAppearance: 1,
      lastAppearance: 3,
      appearanceCount: 3,
      description: "旧城巡夜人。",
      personality: "克制，谨慎，不轻易信任。",
      speechStyle: "短句，低声，压力越大越慢。",
      relationships: [{ target: "沈微", relation: "同盟", description: "彼此试探" }],
      keyEvents: [{ chapterId: "ch-0002", description: "救下沈微但隐藏伤势" }],
      corpus: "林烬压住怒气，先看门缝里的灰。",
    }
    const skill: CharacterSkill = {
      id: "skill-char-linjing",
      characterId: "char-linjing",
      characterName: "林烬",
      skillContent: "---\nname: 林烬\n---\n# 林烬\n",
      sourceBook: "长夜书",
      chapterRange: ["1", "3"],
      createdAt: 3,
      filePath: "E:/Novel/book-analysis/book-1/skills/林烬-skill.md",
    }

    const input = buildGeneratedAuraInputFromBookCharacter(character, skill, metadata)

    expect(input.name).toBe("林烬")
    expect(input.category).toBe("拆书角色")
    expect(input.sourceBook).toBe("长夜书")
    expect(input.skillContent).toContain("# 林烬")
    expect(input.expressionDna).toContain("短句")
    expect(input.mentalModel).toContain("克制")
    expect(input.decisionHeuristics).toContain("救下沈微")
    expect(input.researchFiles?.["02-conversations.md"]).toContain("压力越大越慢")
    expect(input.researchFiles?.["06-timeline.md"]).toContain("第 1 章")
  })
})
