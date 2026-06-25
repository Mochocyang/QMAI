import { beforeEach, describe, expect, it, vi } from "vitest"
import { importBookAnalysisSkillsAsAuras } from "./aura-adapter"
import type { BookAnalysisMetadata, CharacterSkill, ExtractedCharacter } from "./types"

const createCustomCharacterAuraFromGeneratedSkillMock = vi.fn()
const loadCharacterAuraStoreMock = vi.fn()

vi.mock("@/lib/novel/character-aura", () => ({
  loadCharacterAuraStore: (projectPath: string) => loadCharacterAuraStoreMock(projectPath),
  createCustomCharacterAuraFromGeneratedSkill: (projectPath: string, input: unknown) =>
    createCustomCharacterAuraFromGeneratedSkillMock(projectPath, input),
}))

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
  aliases: [],
  importance: 9,
  category: "protagonist",
  firstAppearance: 1,
  lastAppearance: 3,
  appearanceCount: 3,
  description: "旧城巡夜人。",
  personality: "克制，谨慎。",
  speechStyle: "短句。",
  relationships: [],
  keyEvents: [],
  corpus: "林烬压住怒气。",
}

const skill: CharacterSkill = {
  id: "skill-char-linjing",
  characterId: "char-linjing",
  characterName: "林烬",
  skillContent: "# 林烬 Skill",
  sourceBook: "长夜书",
  chapterRange: ["1", "3"],
  createdAt: 3,
}

describe("importBookAnalysisSkillsAsAuras dedupe", () => {
  beforeEach(() => {
    createCustomCharacterAuraFromGeneratedSkillMock.mockReset()
    loadCharacterAuraStoreMock.mockReset()
    loadCharacterAuraStoreMock.mockResolvedValue({ customAuras: [], bindings: [] })
    createCustomCharacterAuraFromGeneratedSkillMock.mockResolvedValue({
      id: "aura-created",
      builtIn: false,
      name: character.name,
      category: "拆书角色",
      sourceNote: `来自拆书作品《${metadata.title}》的角色分析。`,
      corpus: "",
      styleDescription: "",
      behaviorRules: "",
      boundaries: "",
      notes: "",
    })
  })

  it("已存在同一作品同一角色灵魂时不会重复创建", async () => {
    loadCharacterAuraStoreMock.mockResolvedValue({
      customAuras: [{
        id: "aura-existing-linjing",
        builtIn: false,
        name: character.name,
        category: "拆书角色",
        sourceNote: `来自拆书作品《${metadata.title}》的角色分析。`,
        corpus: "",
        styleDescription: "",
        behaviorRules: "",
        boundaries: "",
        notes: "",
      }],
      bindings: [],
    })

    const imported = await importBookAnalysisSkillsAsAuras(
      "E:/Novel/project-1",
      metadata,
      [character],
      [skill],
      [skill.id],
    )

    expect(imported).toEqual([])
    expect(createCustomCharacterAuraFromGeneratedSkillMock).not.toHaveBeenCalled()
  })
})
