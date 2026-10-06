import { describe, expect, it } from "vitest"
import { buildLegacyCharacterRevision } from "./legacy-character-revision"
import { renderPersonalitySkill } from "../portable-personality"
import type { BookAnalysisLibraryBook } from "./library-state"
import type { CharacterSkill, ExtractedCharacter, PersonalityProfile } from "./types"

const profile: PersonalityProfile = {
  personality: "克制、先核对再判断。", motivation: "查清账目。", speechStyle: "短句。",
  behaviorPatterns: "先取证。", quotes: ["账目不会说谎。"],
}
const persona = { version: 1 as const, summary: "先核对再判断", scope: "只覆盖前两章", rules: [{
  id: "P1", field: "mentalModel" as const, condition: "信息不足", tendency: "先核对", boundary: "例外未知",
  evidenceIds: ["E1"],
}], evidence: [{ id: "E1", chapterId: "1", quote: "账目不会说谎。" }] }

function character(over: Partial<ExtractedCharacter> = {}): ExtractedCharacter {
  return {
    id: "char-1", name: "林烬", aliases: [], importance: 9, category: "protagonist",
    firstAppearance: 1, lastAppearance: 3, appearanceCount: 3, description: "巡夜人。",
    personality: "散文字段：沉默。", speechStyle: "散文字段：短句。", relationships: [], keyEvents: [], corpus: "",
    ...over,
  }
}
function skill(over: Partial<CharacterSkill> = {}): CharacterSkill {
  return {
    id: "skill-char-1", characterId: "char-1", characterName: "林烬",
    skillContent: renderPersonalitySkill("林烬", "测试作品", persona),
    sourceBook: "测试作品", chapterRange: ["1", "3"], createdAt: 1, ...over,
  }
}
function book(characters: ExtractedCharacter[], skills: CharacterSkill[]): BookAnalysisLibraryBook {
  return {
    id: "book-1", path: "/project/book-analysis/book-1",
    metadata: { title: "测试作品", totalChapters: 3, totalWords: 3000, sourceType: "file", createdAt: 1, updatedAt: 2 },
    recognizedCharacters: [], characters, skills, styleStatus: "disabled",
    boundAurasCount: 0, addedAuraCharacterIds: [], evidence: [],
  }
}

describe("buildLegacyCharacterRevision", () => {
  it("情况 X：有人格块时规则按字段直映射", () => {
    const r = buildLegacyCharacterRevision(book([character()], [skill()]))!
    expect(r.skill).toBe("characters")
    expect(r.workbenchVersion).toBe(2)
    expect(r.origin).toBe("legacy")
    expect(r.items).toHaveLength(1)
    expect(r.items[0].subject).toBe("林烬")
    expect(r.items[0].summary).toBe("先核对再判断")
    expect(r.items[0].limitations).toBe("只覆盖前两章")
    // dimension 存人格字段名；WORKBENCH_DIMENSIONS 已有对应中文标签
    expect(r.items[0].rules[0]).toMatchObject({ id: "P1", dimension: "mentalModel", condition: "信息不足", action: "先核对", boundary: "例外未知" })
    // 旧版人格摘要没有逐条观察文本，不编造
    expect(r.items[0].rules[0].observation).toBe("")
    expect(r.items[0].rules[0].evidenceIds).toEqual([])
  })

  it("情况 Y：无人格块但有 personalityProfile 时保留条目、规则为空、摘要退回角色资料", () => {
    // 六维路径的 Skill 没有 portablePersonality 块
    const r = buildLegacyCharacterRevision(book(
      [character({ personalityProfile: profile })],
      [skill({ skillContent: "# 角色 Skill - 林烬\n\n手工写的六维内容，没有 frontmatter。" })],
    ))!
    expect(r.items).toHaveLength(1)
    expect(r.items[0].rules).toEqual([])
    expect(r.items[0].summary).toBe("克制、先核对再判断。")
  })

  it("情况 Z：只有散文字段时也保留条目并退回散文字段", () => {
    const r = buildLegacyCharacterRevision(book([character()], []))!
    expect(r.items).toHaveLength(1)
    expect(r.items[0].rules).toEqual([])
    expect(r.items[0].summary).toBe("散文字段：沉默。")
  })

  it("情况 W：完全没有资料时仍保留条目（按钮可用性由调用方按有无内容判断）", () => {
    const r = buildLegacyCharacterRevision(book([character({ personality: "" })], []))!
    expect(r.items).toHaveLength(1)
    expect(r.items[0].summary).toBe("")
  })

  it("没有旧版角色时返回 null（空则不显示）", () => {
    expect(buildLegacyCharacterRevision(book([], []))).toBeNull()
  })

  it("evidence/coverage/selectedChapterIds 全为空，避免触发证据偏移校验", () => {
    const r = buildLegacyCharacterRevision(book([character()], [skill()]))!
    // confirmWorkbenchRevision 会拿 evidence 逐条比对正文偏移；
    // 旧版人格来自 LLM 摘要、没有偏移，故留空数组（空数组时循环不执行，合法）。
    expect(r.evidence).toEqual([])
    expect(r.coverage).toEqual([])
    expect(r.selectedChapterIds).toEqual([])
  })

  it("id 确定性：同输入同 id；角色集合变化则 id 变化", () => {
    const a = buildLegacyCharacterRevision(book([character()], [skill()]))!
    const b = buildLegacyCharacterRevision(book([character()], [skill()]))!
    expect(a.id).toBe(b.id)
    const c = buildLegacyCharacterRevision(book(
      [character(), character({ id: "char-2", name: "许新年" })], [skill()],
    ))!
    expect(c.id).not.toBe(a.id)
  })

  it("Skill 按 characterId 或 characterName 匹配到对应角色", () => {
    const r = buildLegacyCharacterRevision(book(
      [character(), character({ id: "char-2", name: "许新年" })],
      [skill(), skill({ id: "skill-char-2", characterId: "char-2", characterName: "许新年",
        skillContent: renderPersonalitySkill("许新年", "测试作品", { ...persona, summary: "谨慎" }) })],
    ))!
    expect(r.items.map((i) => i.summary)).toEqual(["先核对再判断", "谨慎"])
  })

  it("人格块损坏时不抛错，按「没有」处理", () => {
    // readPersonalitySkill 在元数据损坏时会抛
    const r = buildLegacyCharacterRevision(book(
      [character({ personality: "散文字段：沉默。" })],
      [skill({ skillContent: "---\nportablePersonality: [坏掉的\n---\n" })],
    ))!
    expect(r.items).toHaveLength(1)
    expect(r.items[0].rules).toEqual([])
  })
})
