import { describe, expect, it } from "vitest"
import { findCharacterForSkillFile } from "./skill-character-match"
import type { ExtractedCharacter } from "./types"

const character = (overrides: Partial<ExtractedCharacter>): ExtractedCharacter => ({
  id: `char-${overrides.name ?? "角色"}`,
  name: "角色",
  aliases: [],
  importance: 5,
  category: "minor",
  firstAppearance: 1,
  lastAppearance: 4,
  appearanceCount: 2,
  description: "",
  personality: "",
  speechStyle: "",
  relationships: [],
  keyEvents: [],
  ...overrides,
})

describe("findCharacterForSkillFile（Skill ↔ 角色确定性匹配）", () => {
  it("文件名与角色名精确匹配", () => {
    const hanli = character({ name: "韩立", id: "char-hanli" })
    const found = findCharacterForSkillFile("韩立-skill.md", "---\nname: 韩立\n---\n正文", [hanli])
    expect(found?.id).toBe("char-hanli")
  })

  it("短名角色不再抢走长名角色的 Skill（旧子串匹配回归）", () => {
    const han = character({ name: "韩", id: "char-han", appearanceCount: 3 })
    const hanli = character({ name: "韩立", id: "char-hanli", appearanceCount: 30 })
    // 旧逻辑：characters 中「韩」在前，file.name.includes("韩") 为真 → 「韩」抢走 Skill
    const found = findCharacterForSkillFile("韩立-skill.md", "---\nname: 韩立\n---\n正文", [han, hanli])
    expect(found?.id).toBe("char-hanli")

    // 「韩」自己的 Skill 才归「韩」
    const foundShort = findCharacterForSkillFile("韩-skill.md", "---\nname: 韩\n---\n正文", [han, hanli])
    expect(foundShort?.id).toBe("char-han")
  })

  it("safeFileName 匹配：名字含特殊字符时按替换规则命中", () => {
    const iron = character({ name: "铁·柱", id: "char-tiezhu" })
    const found = findCharacterForSkillFile("铁_柱-skill.md", "---\nname: 铁·柱\n---\n正文", [iron])
    expect(found?.id).toBe("char-tiezhu")
  })

  it("别名匹配：Skill 文件名使用角色别名时命中本人", () => {
    const hanli = character({ name: "韩立", aliases: ["小韩", "韩跑跑"], id: "char-hanli" })
    const found = findCharacterForSkillFile("韩跑跑-skill.md", "---\nname: 韩跑跑\n---\n正文", [hanli])
    expect(found?.id).toBe("char-hanli")
  })

  it("frontmatter name 兜底：文件名与角色名不一致时按 frontmatter 命中", () => {
    const hanli = character({ name: "韩立", id: "char-hanli" })
    const found = findCharacterForSkillFile("renamed-skill.md", "---\nname: 韩立\nsourceBook: 凡人修仙传\n---\n正文", [hanli])
    expect(found?.id).toBe("char-hanli")
  })

  it("完全无法匹配时返回 undefined", () => {
    const hanli = character({ name: "韩立", id: "char-hanli" })
    expect(findCharacterForSkillFile("张三-skill.md", "---\nname: 张三\n---\n正文", [hanli])).toBeUndefined()
    expect(findCharacterForSkillFile("张三-skill.md", "无 frontmatter 正文", [hanli])).toBeUndefined()
  })
})
