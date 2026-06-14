/**
 * 拆书 Skill → 自定义灵魂 端到端测试
 * 验证 importBookAnalysisSkillsAsAuras 的"选中 → 创建 aura"链路是否完整
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const createCustomCharacterAuraFromGeneratedSkill = vi.fn()
const buildGeneratedAuraInputFromBookCharacterMock = vi.fn()

vi.mock("@/lib/novel/character-aura", async () => {
  const actual = await vi.importActual<typeof import("@/lib/novel/character-aura")>(
    "@/lib/novel/character-aura",
  )
  return {
    ...actual,
    createCustomCharacterAuraFromGeneratedSkill: (projectPath: string, input: unknown) =>
      createCustomCharacterAuraFromGeneratedSkill(projectPath, input),
  }
})

// 复用原函数的字段映射实现，但允许测试拦截
vi.mock("./aura-adapter", async () => {
  const actual = await vi.importActual<typeof import("./aura-adapter")>("./aura-adapter")
  return {
    ...actual,
    buildGeneratedAuraInputFromBookCharacter: (
      character: unknown,
      skill: unknown,
      metadata: unknown,
    ) => {
      const result = actual.buildGeneratedAuraInputFromBookCharacter(
        character as never,
        skill as never,
        metadata as never,
      )
      buildGeneratedAuraInputFromBookCharacterMock(character, skill, metadata, result)
      return result
    },
  }
})

import { importBookAnalysisSkillsAsAuras } from "./aura-adapter"
import type {
  BookAnalysisMetadata,
  CharacterSkill,
  ExtractedCharacter,
} from "./types"

const metadata: BookAnalysisMetadata = {
  title: "长夜书",
  totalChapters: 3,
  totalWords: 12000,
  sourceType: "file",
  createdAt: 1,
  updatedAt: 2,
}

const linJing: ExtractedCharacter = {
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

const shenWei: ExtractedCharacter = {
  ...linJing,
  id: "char-shenwei",
  name: "沈微",
  description: "外城军医。",
  personality: "理性、克制，冷静到近乎疏离。",
  speechStyle: "诊断式的短句，几乎不流露情绪。",
  keyEvents: [],
  relationships: [],
}

const linJingSkill: CharacterSkill = {
  id: "skill-char-linjing",
  characterId: "char-linjing",
  characterName: "林烬",
  skillContent: "# 林烬 Skill",
  sourceBook: "长夜书",
  chapterRange: ["1", "3"],
  createdAt: 3,
  filePath: "E:/Novel/book-analysis/book-1/skills/林烬-skill.md",
}

const shenWeiSkill: CharacterSkill = {
  id: "skill-char-shenwei",
  characterId: "char-shenwei",
  characterName: "沈微",
  skillContent: "# 沈微 Skill",
  sourceBook: "长夜书",
  chapterRange: ["2", "3"],
  createdAt: 4,
  filePath: "E:/Novel/book-analysis/book-1/skills/沈微-skill.md",
}

describe("importBookAnalysisSkillsAsAuras", () => {
  beforeEach(() => {
    createCustomCharacterAuraFromGeneratedSkill.mockReset()
    buildGeneratedAuraInputFromBookCharacterMock.mockReset()
    createCustomCharacterAuraFromGeneratedSkill.mockImplementation(async (_path, input) => ({
      id: "aura-from-mock",
      builtIn: false,
      name: (input as { name: string }).name,
      category: (input as { category: string }).category,
      skillFolder: "/mock/skill-folder",
      createdAt: 1,
      updatedAt: 1,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("为每一个被选中的 skill 创建一个自定义灵魂", async () => {
    const imported = await importBookAnalysisSkillsAsAuras(
      "E:/Novel/project-1",
      metadata,
      [linJing, shenWei],
      [linJingSkill, shenWeiSkill],
      [linJingSkill.id, shenWeiSkill.id],
    )

    expect(imported).toHaveLength(2)
    expect(new Set(imported.map((item) => item.characterName))).toEqual(
      new Set(["沈微", "林烬"]),
    )
    expect(createCustomCharacterAuraFromGeneratedSkill).toHaveBeenCalledTimes(2)
  })

  it("未选中的 skill 不会触发灵魂创建", async () => {
    const imported = await importBookAnalysisSkillsAsAuras(
      "E:/Novel/project-1",
      metadata,
      [linJing, shenWei],
      [linJingSkill, shenWeiSkill],
      [linJingSkill.id],
    )

    expect(imported).toHaveLength(1)
    expect(imported[0].characterName).toBe("林烬")
    expect(createCustomCharacterAuraFromGeneratedSkill).toHaveBeenCalledTimes(1)
  })

  it("skill 找不到对应角色时会被跳过,不会创建空灵魂", async () => {
    const orphanSkill: CharacterSkill = {
      ...linJingSkill,
      id: "skill-orphan",
      characterId: "char-missing",
      characterName: "???",
    }
    const imported = await importBookAnalysisSkillsAsAuras(
      "E:/Novel/project-1",
      metadata,
      [linJing],
      [linJingSkill, orphanSkill],
      [linJingSkill.id, orphanSkill.id],
    )

    expect(imported).toHaveLength(1)
    expect(imported[0].characterName).toBe("林烬")
    expect(createCustomCharacterAuraFromGeneratedSkill).toHaveBeenCalledTimes(1)
  })

  it("传给 createCustomCharacterAuraFromGeneratedSkill 的输入必须带拆书标签和原作品来源", async () => {
    await importBookAnalysisSkillsAsAuras(
      "E:/Novel/project-1",
      metadata,
      [linJing],
      [linJingSkill],
      [linJingSkill.id],
    )

    expect(createCustomCharacterAuraFromGeneratedSkill).toHaveBeenCalledWith(
      "E:/Novel/project-1",
      expect.objectContaining({
        name: "林烬",
        category: "拆书角色",
        sourceBook: "长夜书",
        skillContent: "# 林烬 Skill",
        generationPrompt: expect.stringContaining("长夜书"),
      }),
    )
  })
})
